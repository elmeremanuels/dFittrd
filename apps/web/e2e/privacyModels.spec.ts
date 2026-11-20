import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * D3 with the REAL MediaPipe models (the third wall). `privacy.spec.ts` runs without the models (CI has
 * none), so the scan worker falls back before any MediaPipe task exists and the usage logger that
 * POSTs to odml.pa.googleapis.com (face-on-head spike report, "MediaPipe phones home") is never
 * created. This spec runs the whole capture step with the models loaded:
 *   face   "Choose a photo" with a synthetic face (the mannequin's own head, painted; nobody's photo)
 *          → FaceLandmarker + the multiclass segmenter run in the scan worker;
 *   body   the 8-second scan, the fake camera playing the repo's own mannequin render (front, then side)
 *          → PoseLandmarker in VIDEO mode on every frame, then the segmenter on the chosen frames;
 *   then   manual → fusion → done, and the session is disposed (MediaPipe flushes its log on close).
 * The worker is kept alive past MediaPipe's 60-second log interval, so the logger has fired at least
 * once whatever the walls do. It fails on:
 *   - any request, from the page or any worker, to an origin other than the app (the api is mocked on
 *     the same origin here, as in privacy.spec.ts);
 *   - any CSP violation: the preview reports them to /__csp-report (vite.config.ts), workers included;
 *     a request the CSP refuses never reaches the network, so the report is the only place it shows;
 *   - any "Content Security Policy" console message, page or worker.
 * And it checks that the report channel itself works (last, with a canary request it must catch).
 *
 * Skipped with a note when the models are not fetched (`pnpm --filter @curtain/web models`).
 * Run:  pnpm --filter @curtain/web models && pnpm --filter @curtain/web e2e -- --trace off privacyModels
 *       (PRIVACY_SHOTS=<dir> keeps the two screenshots)
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const MODELS = ['face_landmarker.task', 'pose_landmarker_full.task', 'pose_landmarker_lite.task', 'selfie_multiclass_256x256.tflite', 'wasm/vision_wasm_module_internal.wasm'].map((f) => join(WEB, 'public', 'models', f));
const HAVE_MODELS = MODELS.every((f) => existsSync(f));
const FACE = join(WEB, 'e2e', 'fixtures', 'synthetic-faces', 'person-b.jpg');
const MANNEQUIN = join(WEB, 'e2e', 'fixtures', 'mannequin-camera');
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
/**
 * `CURTAIN_PREVIEW_CSP=off` (preview only, for the negative control in docs/reports/claude/privacy-wall.md):
 * the preview sends no CSP, so only the network check stands. The policy and canary checks are skipped then.
 */
const CSP_ON = process.env.CURTAIN_PREVIEW_CSP !== 'off';
/** PRIVACY_SHOTS: a folder for the two screenshots (the report's); otherwise they go with the test output. */
const shot = (name: string): string => (process.env.PRIVACY_SHOTS ? join(process.env.PRIVACY_SHOTS, name) : test.info().outputPath(name));
/** MediaPipe's usage logger flushes every 60 s; keep the worker alive past that. */
const LOG_INTERVAL_MS = 60_000;

/** Binary PGM (P5, 8-bit) → { w, h, luma }. */
function readPgm(file: string): { w: number; h: number; luma: Buffer } {
  const buf = gunzipSync(readFileSync(file));
  const head = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 32).toString('latin1'));
  if (!head) throw new Error(`not a P5 PGM: ${file}`);
  return { w: Number(head[1]), h: Number(head[2]), luma: buf.subarray(head[0].length) };
}

/**
 * The fake camera: a Y4M file (Chromium's --use-file-for-fake-video-capture, played in a loop), 3 s of
 * the mannequin's front view then 3 s of its side view at 10 fps. Grey images: chroma is flat 128.
 */
function mannequinY4m(): string {
  const front = readPgm(join(MANNEQUIN, 'front.pgm.gz'));
  const side = readPgm(join(MANNEQUIN, 'side.pgm.gz'));
  const { w, h } = front;
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128);
  const fps = 10;
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${w} H${h} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < 6 * fps; i++) parts.push(Buffer.from('FRAME\n'), i < 3 * fps ? front.luma : side.luma, chroma);
  const dir = join(tmpdir(), 'curtain-e2e');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'mannequin.y4m');
  writeFileSync(out, Buffer.concat(parts));
  return out;
}

/**
 * `CURTAIN_REQUIRE_MODELS=1` (set by `pnpm check:launch`, OI-69): the models must be there. Without it a
 * checkout that never fetched them skips this spec; with it the run fails instead of passing on nothing.
 */
if (!HAVE_MODELS && process.env.CURTAIN_REQUIRE_MODELS === '1') throw new Error('MediaPipe models not fetched and CURTAIN_REQUIRE_MODELS=1: run `pnpm --filter @curtain/web models` first');
test.skip(!HAVE_MODELS, 'MediaPipe models not fetched: run `pnpm --filter @curtain/web models` first');

test.use({
  launchOptions: {
    args: HAVE_MODELS
      ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${mannequinY4m()}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [],
  },
});

interface Seen {
  url: string;
  method: string;
  bodyBytes: number;
  contentType: string;
}

async function instrument(page: Page, origin: string): Promise<{ seen: Seen[]; csp: string[] }> {
  const seen: Seen[] = [];
  const csp: string[] = [];
  const ctx = page.context();
  // Every request the browser makes for this context, the page's and the workers' (request events
  // see dedicated-worker traffic, which is how the spike caught the odml request).
  ctx.on('request', (req: Request) => {
    // the browser's own CSP reports: read through cspReports(), not counted as app traffic
    if (new URL(req.url()).pathname === '/__csp-report') return;
    const buf = req.postDataBuffer();
    seen.push({ url: req.url(), method: req.method(), bodyBytes: buf ? buf.byteLength : 0, contentType: req.headers()['content-type'] ?? '' });
  });
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/v1/devices') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(DEVICE) });
      if (url.pathname === '/v1/me/signature') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString(), ledgerEntryId: '22222222-2222-4222-8222-222222222222' }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'mock' } }) });
    }
    return route.continue();
  });
  const onConsole = (where: string) => (m: ConsoleMessage) => {
    if (/Content Security Policy|Content-Security-Policy|violates the following/i.test(m.text())) csp.push(`${where}: ${m.text()}`);
  };
  page.on('console', onConsole('page'));
  page.on('worker', (w) => w.on('console', onConsole(`worker ${w.url()}`)));
  return { seen, csp };
}

async function cspReports(page: Page): Promise<{ blocked: string; directive: string; document: string }[]> {
  const res = await page.request.get('/__csp-report');
  const list = (await res.json()) as { 'csp-report'?: Record<string, string> }[];
  return list.map((r) => ({ blocked: r['csp-report']?.['blocked-uri'] ?? '?', directive: r['csp-report']?.['violated-directive'] ?? r['csp-report']?.['effective-directive'] ?? '?', document: r['csp-report']?.['document-uri'] ?? '?' }));
}

test('the whole capture step with the real models talks to the app origin only and breaks no CSP rule', async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const origin = new URL(baseURL!).origin;
  await cspReports(page); // clear what earlier specs left
  const { seen, csp } = await instrument(page, origin);

  const res = await page.goto('/onboarding');
  const policy = res?.headers()['content-security-policy'] ?? '';
  if (CSP_ON) {
    expect(policy, 'the preview sends the production policy').toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    // OI-66: as in production the app is cross-origin isolated (COOP + COEP require-corp), so the capture
    // step below runs in the state production runs in. A resource without CORP or CORS would fail to load here.
    expect(res?.headers()['cross-origin-embedder-policy']).toBe('require-corp');
    expect(await page.evaluate(() => self.crossOriginIsolated), 'the page is cross-origin isolated').toBe(true);
  }

  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('spinbutton', { name: /^Height/ }).fill('168');
  await page.getByRole('spinbutton', { name: /^Bust/ }).fill('88');
  await page.getByRole('spinbutton', { name: /^Waist/ }).fill('70');
  await page.getByRole('spinbutton', { name: /^Hip/ }).fill('96');
  await page.getByRole('radio', { name: /tape/i }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: 'Minimal' }).click();
  await page.getByRole('button', { name: /Next/ }).click();

  // ---- capture: the models must load (this spec is pointless on the fallback path) ----
  const start = page.getByRole('button', { name: 'Start with a photo' });
  await expect(start).toBeEnabled({ timeout: 60_000 });
  const tasksAt = Date.now();
  await start.click();

  // face: a synthetic face through "Choose a photo"; the face landmarker must find it
  await expect(page.getByText('Centre your face in the oval, neutral expression.')).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="file"]').setInputFiles(FACE);
  await expect(page.getByRole('button', { name: /Looks right/ })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: shot('01-face-found-real-models.png') });
  await page.getByRole('button', { name: /Looks right/ }).click();

  // body: the 8-second scan on the mannequin video
  const scan = page.getByRole('button', { name: /Start 8-second scan/ });
  await expect(scan).toBeEnabled({ timeout: 60_000 });
  await scan.click();
  const manual = page.getByRole('heading', { name: /Your measurements/ });
  const failed = page.getByRole('button', { name: /Enter measurements manually instead/ });
  // The fake camera loops 3 s of front view and 3 s of side view, and the scan starts wherever the loop
  // happens to be; on a busy machine (SwiftShader) too few front frames can fall inside one 8-second scan
  // ("no usable front frame"). "Try again" is what a shopper presses; the scan must succeed within three goes.
  let scanned = false;
  let attempts = 0;
  const refusals: string[] = [];
  while (!scanned && attempts < 3) {
    attempts++;
    await expect(manual.or(failed)).toBeVisible({ timeout: 90_000 });
    scanned = await manual.isVisible();
    if (scanned) break;
    refusals.push((await page.getByRole('status').first().textContent()) ?? '');
    if (attempts < 3) {
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(scan).toBeEnabled({ timeout: 60_000 });
      await scan.click();
    }
  }
  test.info().annotations.push({ type: 'body scan', description: scanned ? `measured the mannequin (attempt ${attempts}${refusals.length ? `; before: ${refusals.join(' | ')}` : ''})` : `failed ${attempts} times: ${refusals.join(' | ')}` });
  await page.screenshot({ path: shot('02-after-body-scan-of-mannequin.png') });
  expect(scanned, 'the body scan measured the mannequin (pose landmarker and segmenter ran)').toBe(true);

  // keep the worker (and its MediaPipe tasks) alive past the logger's interval, then finish: the
  // capture step disposes the session, and MediaPipe flushes its log when a task closes
  const wait = LOG_INTERVAL_MS + 5_000 - (Date.now() - tasksAt);
  if (wait > 0) await page.waitForTimeout(wait);
  await expect(manual).toBeVisible();
  await page.getByRole('button', { name: /Combine with the scan/ }).click();
  await page.getByRole('button', { name: /Use these measurements/ }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'done');
  await page.waitForTimeout(3_000);

  // ---- assertions ----
  const fetchedModels = seen.filter((r) => new URL(r.url).pathname.startsWith('/models/')).map((r) => new URL(r.url).pathname);
  for (const m of ['/models/face_landmarker.task', '/models/selfie_multiclass_256x256.tflite', '/models/wasm/vision_wasm_module_internal.wasm']) expect(fetchedModels, `real model ${m} loaded`).toContain(m);
  expect(fetchedModels.some((p) => /pose_landmarker_(full|lite)\.task$/.test(p)), 'a pose model loaded').toBe(true);

  const origins = [...new Set(seen.map((r) => new URL(r.url).origin))];
  test.info().annotations.push({ type: 'origins seen', description: origins.join(', ') });
  test.info().annotations.push({ type: 'requests', description: `${seen.length}, ${fetchedModels.length} of them model files fetched by the scan worker` });
  const thirdParty = seen.filter((r) => new URL(r.url).origin !== origin);
  expect(thirdParty.map((r) => `${r.method} ${r.url}`), 'requests to another origin').toEqual([]);
  for (const r of seen) {
    const path = new URL(r.url).pathname;
    if (!path.startsWith('/v1/')) expect(r.bodyBytes, `non-API request with a body: ${r.method} ${r.url}`).toBe(0);
    expect(r.contentType, `image MIME on ${r.url}`).not.toMatch(/image\/|multipart\/|x-protobuf/);
  }
  expect(await cspReports(page), 'CSP violations (page and workers)').toEqual([]);
  expect(csp, 'CSP console messages').toEqual([]);

  if (!CSP_ON) return;
  // ---- the report channel works: a canary to the MediaPipe log host must be refused and reported ----
  const canary = await page.evaluate(() =>
    fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'canary' }).then(
      () => 'sent',
      () => 'refused',
    ),
  );
  expect(canary).toBe('refused');
  await expect.poll(async () => (await cspReports(page)).map((r) => r.blocked), { timeout: 10_000 }).toContain('https://odml.pa.googleapis.com/v1/log');
});

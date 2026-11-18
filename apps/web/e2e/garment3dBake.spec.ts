import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

/**
 * A server drape bake in the real embed (docs/research/step3-serverdrape-spike.md §10): the production build, a mocked
 * api and a bundle folder whose anchors.json names a `drapeBake` (the POM v2 skirt, git-ignored; the test is skipped
 * with a note when it is absent).
 *   - every size at phone size (360 x 740 at 2x), front and side, with the estimate label, the plain-colour note and
 *     the size's provenance (measured on the shop's tape / interpolated / extrapolated) on screen;
 *   - load-to-settled and size-switch times in the throttled phone page of the step-3 spike (412 x 915 at 2x, DevTools
 *     CPU throttle, default 4x), for this bundle and, with BAKE_COMPARE_BUNDLE, for another one (the photo bundle,
 *     draped on the device).
 * Not part of `pnpm check`. EMULATED, not a phone: headless Chromium, WebGL on SwiftShader.
 *
 * Env: E2E_SKIRT_BUNDLE      the bake bundle folder (default spikes/garment-engine/out/pom2-bundle/crimson-wildflower-maxi-skirt)
 *      BAKE_COMPARE_BUNDLE   a second bundle to time the same way (optional)
 *      BAKE_SHOTS            folder for the screenshots and timing.json
 *      BAKE_BODY             bust,waist,hip typed into "I know my measurements" (default 91,73.5,100: the held-out body)
 *      BAKE_THROTTLE         CPU throttle of the timing runs (default 4)
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUNDLE = resolve(process.env.E2E_SKIRT_BUNDLE ?? join(ROOT, 'spikes', 'garment-engine', 'out', 'pom2-bundle', 'crimson-wildflower-maxi-skirt'));
const COMPARE = process.env.BAKE_COMPARE_BUNDLE ? resolve(process.env.BAKE_COMPARE_BUNDLE) : null;
const SHOTS = process.env.BAKE_SHOTS ?? null;
const [BUST, WAIST, HIP] = (process.env.BAKE_BODY ?? '91,73.5,100').split(',');
const THROTTLE = Number(process.env.BAKE_THROTTLE ?? 4);
const ASSET_PATH = `/assets/${SHOP_ID}/skirt/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
const isBake = (dir: string): boolean => existsSync(join(dir, 'anchors.json')) && (JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8')) as { drapeBake?: string }).drapeBake === 'base.glb';

async function instrument(page: Page, origin: string, bundle: string): Promise<Request[]> {
  const seen: Request[] = [];
  const garment = JSON.parse(readFileSync(join(bundle, 'payload.json'), 'utf8')) as { productPhotos?: string[] };
  const grading = JSON.parse(readFileSync(join(bundle, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] };
  garment.productPhotos = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.push(req);
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith(`${ASSET_PATH}/`)) {
      const file = url.pathname.slice(ASSET_PATH.length + 1);
      if (req.method() !== 'GET' || !BUNDLE_FILES.includes(file)) return route.fulfill({ status: 404, body: 'not a bundle file' });
      return route.fulfill({ status: 200, contentType: file.endsWith('.glb') ? 'model/gltf-binary' : 'application/json', body: readFileSync(join(bundle, file)) });
    }
    if (url.pathname.startsWith('/v1/')) {
      const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/v1/devices') return json(201, DEVICE);
      if (url.pathname === `/v1/try/${TOKEN}` && req.method() === 'GET')
        return json(200, {
          shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'shopify', paused: false, brandColor: '#2F4F3A' },
          garment,
          trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'e2e-intent-token-0123456789' },
          pairing: { created: true, pairedAt: new Date().toISOString() },
          embed: { allowedOrigins: [] },
          asset: { version: '0123456789abcdef', baseUrl: `${origin}${ASSET_PATH}`, baseSize: grading.baseSize, sizes: grading.sizes.map((s) => s.size), label: 'estimate' },
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
  return seen;
}

/** To the result screen with the typed girths. */
async function toResult(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByText('I know my measurements').click();
  // A bottom asks no bust: the embed estimates it from height and weight.
  await expect(page.getByLabel(/^Hip/)).toBeVisible();
  if (await page.getByLabel(/^Bust/).count()) await page.getByLabel(/^Bust/).fill(BUST!);
  await page.getByLabel(/^Waist/).fill(WAIST!);
  await page.getByLabel(/^Hip/).fill(HIP!);
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
}

/** A screenshot once two in a row are the same. */
async function still(page: Page, locator: Locator, name?: string): Promise<Buffer> {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  let last = await locator.screenshot();
  const until = Date.now() + 20_000;
  for (;;) {
    await page.waitForTimeout(300);
    const next = await locator.screenshot();
    if (next.equals(last) || Date.now() > until) break;
    last = next;
  }
  if (SHOTS && name) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, name), last);
  }
  return last;
}

/** Turn the view about the vertical axis by `deg` (OrbitControls: a drag of clientHeight / 4 turns 90 degrees). */
async function turn(page: Page, canvas: Locator, deg: number): Promise<void> {
  const box = (await canvas.boundingBox())!;
  const dx = (box.height / 4) * (deg / 90);
  const y = box.y + box.height * 0.5;
  const x0 = box.x + box.width / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(x0 + (dx * k) / 10, y);
  await page.mouse.up();
}

test('a drape bake in the embed: every size front and side, labelled an estimate, plain colour and provenance', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(BUNDLE, 'base.glb')) || !isBake(BUNDLE), `no drape bake bundle at ${BUNDLE} (git-ignored; set E2E_SKIRT_BUNDLE)`);
  test.setTimeout(3_600_000); // ten pictures of a WebGL canvas on SwiftShader: minutes each on a busy machine
  const origin = new URL(baseURL!).origin;
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const seen = await instrument(page, origin, BUNDLE);
  await toResult(page, baseURL!);
  await page.getByTestId('garment3d-open').click();
  const canvas = page.getByTestId('garment3d-canvas');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });
  // The only bundle traffic: GETs of the five files.
  const files = seen.filter((r) => new URL(r.url()).pathname.startsWith(ASSET_PATH));
  expect(files.every((r) => r.method() === 'GET')).toBe(true);
  expect([...new Set(files.map((r) => new URL(r.url()).pathname.split('/').pop()))].sort()).toEqual([...BUNDLE_FILES].sort());
  const view = page.getByTestId('garment3d');
  const sizes = (JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { sizes: { size: string; provenance?: string }[] }).sizes;
  const notes: Record<string, string> = {};
  for (const s of sizes) {
    await view.getByRole('radio', { name: s.size, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-size', s.size);
    await expect(canvas).toHaveAttribute('data-state', 'settled');
    await expect(view.getByText('Estimate · not measured')).toBeVisible();
    await expect(page.getByTestId('garment3d-label')).toContainText('estimate');
    const note = page.getByTestId('garment3d-bake-note');
    await expect(note).toContainText('one plain colour');
    await expect(note).toContainText(s.provenance === 'measured' ? `Size ${s.size} is built from the shop’s tape measurements.` : `it is ${String(s.provenance)} from the sizes that were`);
    notes[s.size] = await note.innerText();
    await still(page, view, `size-${s.size}-front.png`);
    await turn(page, canvas, 90);
    await still(page, view, `size-${s.size}-side.png`);
    await turn(page, canvas, -90);
    await still(page, view);
  }
  if (SHOTS) writeFileSync(join(SHOTS, 'notes.json'), `${JSON.stringify({ body: { bust: BUST, waist: WAIST, hip: HIP }, notes }, null, 2)}\n`);
  expect(errors).toEqual([]);
  await context.close();
});

test('load and settle time in the throttled phone page', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(BUNDLE, 'base.glb')), `no bundle at ${BUNDLE}`);
  test.setTimeout(3_600_000);
  const origin = new URL(baseURL!).origin;
  const runs: Record<string, unknown>[] = [];
  for (const [name, dir] of [['bake', BUNDLE], ...(COMPARE ? [['compare', COMPARE]] : [])] as [string, string][]) {
    for (const throttle of [1, THROTTLE]) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      await instrument(page, origin, dir);
      await toResult(page, baseURL!);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const t0 = Date.now();
      await page.getByTestId('garment3d-open').click();
      const canvas = page.getByTestId('garment3d-canvas');
      await expect(canvas).toHaveAttribute('data-state', /draping|settled/, { timeout: 300_000 });
      const tShown = Date.now() - t0;
      await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 600_000 });
      const tSettled = Date.now() - t0;
      const first = await canvas.getAttribute('data-size');
      // A size two steps away (not pre-draped as a neighbour by the on-device path).
      const grading = JSON.parse(readFileSync(join(dir, 'grading.json'), 'utf8')) as { sizes: { size: string }[] };
      const labels = grading.sizes.map((s) => s.size);
      const other = labels[(labels.indexOf(first!) + 2) % labels.length]!;
      const t1 = Date.now();
      await page.getByTestId('garment3d').getByRole('radio', { name: other, exact: true }).click();
      await expect(canvas).toHaveAttribute('data-size', other);
      await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 600_000 });
      const tSwitch = Date.now() - t1;
      runs.push({ bundle: name, dir, throttle, viewport: '412x915@2x', openToFirstStateMs: tShown, openToSettledMs: tSettled, sizeSwitch: `${first} -> ${other}`, switchToSettledMs: tSwitch });
      await context.close();
    }
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 'timing.json'), `${JSON.stringify({ emulated: 'headless Chromium, SwiftShader, DevTools CPU throttle; not a phone', runs }, null, 2)}\n`);
  }
  console.log(JSON.stringify(runs, null, 1));
});

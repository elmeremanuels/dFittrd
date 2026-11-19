import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PILOT_PULL_ON_SKIRT } from '@curtain/schema';
import type * as TryonProviders from '../../../packages/tryon-providers/dist/index.js';

/**
 * The AI realism layer (D22) in the real embed: the production build, a mocked api and the POM v2 rest fixture
 * (`packages/garment-viewer/fixtures/pom-v2-rest`, a drape bake of a pull-on skirt, rest geometry). The 3D view's
 * real `exportPasses` (WebGL) makes the passes; the mocked `/v1/renders/realism` answers with the server's own
 * pipeline (decode, passes guard, fake provider, fidelity checks from `@curtain/tryon-providers` dist), so the passes
 * a real browser exports are checked by the real code. With the flag off there is no panel.
 * Not part of `pnpm check`. EMULATED, not a phone: headless Chromium, WebGL on SwiftShader.
 * Env: REALISM_SHOTS  folder for screenshots, the exported passes and checks.json.
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUNDLE = join(ROOT, 'packages', 'garment-viewer', 'fixtures', 'pom-v2-rest');
const SHOTS = process.env.REALISM_SHOTS ?? null;
const ASSET_PATH = `/assets/${SHOP_ID}/skirt/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
type Tp = typeof TryonProviders;

const save = (name: string, data: Buffer | string): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), data);
};

async function instrument(page: Page, origin: string, opts: { aiRealism: boolean; mode: { value: 'faithful' | 'move-hem' | 'recolour' } }, log: unknown[]): Promise<void> {
  const tp: Tp = await import('../../../packages/tryon-providers/dist/index.js');
  const anchors = JSON.parse(readFileSync(join(BUNDLE, 'anchors.json'), 'utf8')) as { productId: string };
  const grading = JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] };
  const garment = { ...PILOT_PULL_ON_SKIRT, id: anchors.productId, productPhotos: [] };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith(`${ASSET_PATH}/`)) {
      const file = url.pathname.slice(ASSET_PATH.length + 1);
      if (req.method() !== 'GET' || !BUNDLE_FILES.includes(file)) return route.fulfill({ status: 404, body: 'not a bundle file' });
      return route.fulfill({ status: 200, contentType: file.endsWith('.glb') ? 'model/gltf-binary' : 'application/json', body: readFileSync(join(BUNDLE, file)) });
    }
    if (!url.pathname.startsWith('/v1/')) return route.continue();
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
        ...(opts.aiRealism ? { aiRealism: true } : {}),
      });
    if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
    if (url.pathname === '/v1/renders/realism' && req.method() === 'POST') {
      // The server's pipeline, in this process: decode → passes guard → provider (fake) → fidelity checks.
      const body = req.postDataJSON() as { size: string; passes: Record<string, string> & { width: number; height: number; neighbour?: { size: string; garmentMaskPng: string }; meta: { statureCm: number; waistRow: number; hipRow: number; backdropHex: string; garmentHex: string } } };
      const p = body.passes;
      const b = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
      const keys = Object.keys(body).sort();
      const passes = await tp.decodePasses(
        { colour: b(p.colourPng!), depth: b(p.depthPng!), normal: b(p.normalPng!), garmentMask: b(p.garmentMaskPng!), figureMask: b(p.figureMaskPng!), ...(p.neighbour ? { neighbour: { size: p.neighbour.size, garmentMask: b(p.neighbour.garmentMaskPng) } } : {}) },
        { ...p.meta, size: body.size, category: 'bottom' },
      );
      const issues = tp.checkRenderPasses(passes);
      const out = await tp.runRealism({ passes, provider: new tp.FakeRealismProvider({ mode: opts.mode.value }), prompt: tp.realismPrompt({ category: 'bottom' }) });
      const entry = { mode: opts.mode.value, size: body.size, keys, passKeys: Object.keys(p).sort(), meta: p.meta, neighbour: p.neighbour?.size ?? null, issues, status: out.status, ...(out.status === 'ok' || (out.status === 'refused' && out.stage === 'checks') ? { report: { reasons: out.report.reasons, metrics: out.report.metrics, sizeSeparation: out.report.sizeSeparation } } : {}) };
      log.push(entry);
      if (opts.mode.value === 'faithful') {
        for (const k of ['colourPng', 'depthPng', 'normalPng', 'garmentMaskPng', 'figureMaskPng'] as const) save(`pass-${body.size}-${k.replace('Png', '')}.png`, Buffer.from(p[k]!, 'base64'));
        if (p.neighbour) save(`pass-${body.size}-neighbour-${p.neighbour.size}-garmentMask.png`, Buffer.from(p.neighbour.garmentMaskPng, 'base64'));
      }
      const base = { label: 'ai-enhanced-estimate', disclaimer: 'Estimate — generated from your measurements and the shop’s garment data, not a photo of you.' };
      const metrics = (r: { metrics: Record<string, number> | null; sizeSeparation: { neighbour: string; visible: boolean; ok: boolean } | null }) =>
        r.metrics ? { silhouetteIoU: r.metrics.silhouetteIoU, garmentIoU: r.metrics.garmentIoU, colourDeltaE00: r.metrics.colourDeltaE00, hemShiftCm: r.metrics.hemShiftCm, waistShiftCm: r.metrics.waistShiftCm, waistWidthDeltaCm: r.metrics.waistWidthDeltaCm, hipWidthDeltaCm: r.metrics.hipWidthDeltaCm, sizeSeparation: r.sizeSeparation ? { neighbour: r.sizeSeparation.neighbour, visible: r.sizeSeparation.visible, ok: r.sizeSeparation.ok } : null } : null;
      if (out.status === 'ok') return json(200, { status: 'ok', mimeType: 'image/png', imageBase64: Buffer.from(out.png).toString('base64'), width: out.image.width, height: out.image.height, provider: out.provider, model: out.model, metrics: metrics(out.report as never), ...base });
      if (out.stage === 'passes') return json(422, { error: { code: 'not_a_render', message: 'only render passes', details: { issues: out.issues } } });
      return json(200, { status: 'refused', reasons: out.report.reasons, metrics: metrics(out.report as never), ...base });
    }
    return json(404, { error: { code: 'not_found', message: 'mock' } });
  });
}

async function toResult(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByText('I know my measurements').click();
  await expect(page.getByLabel(/^Hip/)).toBeVisible();
  if (await page.getByLabel(/^Bust/).count()) await page.getByLabel(/^Bust/).fill('91');
  await page.getByLabel(/^Waist/).fill('73.5');
  await page.getByLabel(/^Hip/).fill('100');
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
}

async function still(page: Page, locator: Locator, name: string): Promise<void> {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  let last = await locator.screenshot();
  const until = Date.now() + 20_000;
  for (;;) {
    await page.waitForTimeout(300);
    const next = await locator.screenshot();
    if (next.equals(last) || Date.now() > until) break;
    last = next;
  }
  save(name, last);
}

test('flag on: the 3D view exports its passes, the checks pass a faithful image and refuse a moved hem, always labelled', async ({ browser, baseURL }) => {
  test.setTimeout(1_800_000);
  const origin = new URL(baseURL!).origin;
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const log: unknown[] = [];
  const mode = { value: 'faithful' as 'faithful' | 'move-hem' | 'recolour' };
  await instrument(page, origin, { aiRealism: true, mode }, log);
  await toResult(page, baseURL!);
  await page.getByTestId('garment3d-open').click();
  const canvas = page.getByTestId('garment3d-canvas');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
  const view = page.getByTestId('garment3d');
  const panel = page.getByTestId('ai-realism');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('ai-estimate-label')).toHaveText(/AI-enhanced estimate/);
  await still(page, view, 'flag-on-before.png');
  const size = (await canvas.getAttribute('data-size'))!;

  await panel.getByTestId('ai-realism-consent').check();
  await panel.getByTestId('ai-realism-start').click();
  await expect(page.getByTestId('ai-realism-image')).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByTestId('ai-estimate-label')).toHaveCount(2);
  await still(page, view, `flag-on-faithful-size-${size}.png`);

  // Another size, and a provider that moves the hem: refused, labelled, no picture.
  const other = (await view.getByRole('radio').allInnerTexts()).find((s) => s.trim() !== size)!.trim();
  await view.getByRole('radio', { name: other, exact: true }).click();
  await expect(canvas).toHaveAttribute('data-size', other);
  mode.value = 'move-hem';
  await panel.getByTestId('ai-realism-consent').check();
  await panel.getByTestId('ai-realism-start').click();
  await expect(page.getByTestId('ai-realism-refused')).toContainText('The length moved.', { timeout: 120_000 });
  await expect(page.getByTestId('ai-realism-image')).toHaveCount(0);
  await expect(panel.getByTestId('ai-estimate-label')).toBeVisible();
  await still(page, view, `flag-on-refused-hem-size-${other}.png`);

  // The view on screen is back as it was after the export (front camera, the shopper's size).
  await expect(canvas).toHaveAttribute('data-state', 'settled');
  save('checks.json', `${JSON.stringify(log, null, 2)}\n`);
  const first = log[0] as { status: string; issues: string[]; keys: string[]; passKeys: string[]; neighbour: string | null };
  expect(first.issues).toEqual([]);
  expect(first.status).toBe('ok');
  expect(first.keys).toEqual(['consent', 'passes', 'productId', 'shopId', 'size']);
  expect(first.passKeys.join(',')).not.toMatch(/photo|face|person/i);
  expect((log[1] as { status: string }).status).toBe('refused');
  expect(errors).toEqual([]);
  await context.close();
});

test('flag off: no AI panel next to the 3D view', async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  const origin = new URL(baseURL!).origin;
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await instrument(page, origin, { aiRealism: false, mode: { value: 'faithful' } }, []);
  await toResult(page, baseURL!);
  await page.getByTestId('garment3d-open').click();
  await expect(page.getByTestId('garment3d-canvas')).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
  await expect(page.getByTestId('ai-realism')).toHaveCount(0);
  await still(page, page.getByTestId('garment3d'), 'flag-off.png');
  await context.close();
});

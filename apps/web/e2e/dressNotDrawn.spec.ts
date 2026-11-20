import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { computeFit, wearBlock } from '@curtain/fit-engine';
import { PILOT_PULL_ON_SKIRT, type GarmentPayload } from '@curtain/schema';

/**
 * The one not-drawn rule in the real embed (docs/reports/claude/dress-not-drawn.md): the production build, a mocked api
 * and the SYNTHETIC tape-built babydoll dress (not a product; `spikes/garment-engine` `pomDress.ts`), draped on the
 * device. The shopper types the AU 16 chart body (bust 105, waist 87.5, hip 114).
 *   - AU 16, her own size: draped and drawn, no not-drawn sentence, in 3D and on the 2D figure.
 *   - AU 14, one size down: the size advice says tight, with 2 cm of the dress left over the bust. It closes: drawn.
 *   - AU 12, two sizes down: the bust is 3 cm larger than the dress, more than woven viscose gives. Not draped, not drawn:
 *     the 3D view shows the body alone (no pixel of the dress's colour) and one sentence names the bust and the size
 *     advice; the 2D figure shows the body alone with the same sentence, and the size rings stay.
 *   - AU 8 and AU 10: the same, 13 and 8 cm.
 * What the embed shows is checked against the fit engine's own answer for that body (`wearBlock`), never a copy of it.
 * The bundle is git-ignored; when it is absent the test builds it (TypeScript only, a few seconds).
 * Not part of `pnpm check`. EMULATED, not a phone: headless Chromium, WebGL on SwiftShader.
 *
 * Env: E2E_DRESS_BUNDLE   the bundle folder (default spikes/garment-engine/out/synthetic-tape-babydoll-dress)
 *      NOT_DRAWN_SHOTS    folder for the screenshots (390 x 760 at 2x)
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUNDLE = resolve(process.env.E2E_DRESS_BUNDLE ?? join(ROOT, 'spikes', 'garment-engine', 'out', 'synthetic-tape-babydoll-dress'));
const SHOTS = process.env.NOT_DRAWN_SHOTS ?? null;
const ASSET_PATH = `/assets/${SHOP_ID}/dress/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
/** The AU 16 chart body: two sizes larger than AU 12. */
const BODY = { bust: 105, waist: 87.5, hip: 114 };

test.beforeAll(() => {
  if (existsSync(join(BUNDLE, 'base.glb')) || process.env.E2E_DRESS_BUNDLE) return;
  const r = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@curtain/garment-spike', 'exec', 'tsx', 'scripts/build-dress-bundle.ts'], { cwd: ROOT, stdio: 'ignore' });
  if (r.status !== 0) throw new Error('could not build the dress bundle (pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts)');
});

async function instrument(page: Page, origin: string, garment: GarmentPayload, withAsset = true): Promise<void> {
  const grading = withAsset ? (JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] }) : null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith(`${ASSET_PATH}/`)) {
      const file = url.pathname.slice(ASSET_PATH.length + 1);
      if (req.method() !== 'GET' || !BUNDLE_FILES.includes(file)) return route.fulfill({ status: 404, body: 'not a bundle file' });
      return route.fulfill({ status: 200, contentType: file.endsWith('.glb') ? 'model/gltf-binary' : 'application/json', body: readFileSync(join(BUNDLE, file)) });
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
          ...(grading ? { asset: { version: '0123456789abcdef', baseUrl: `${origin}${ASSET_PATH}`, baseSize: grading.baseSize, sizes: grading.sizes.map((s) => s.size), label: 'estimate' } } : {}),
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
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

/** The phone screen with the 2D figure in view (the whole result is several screens long). */
async function figureShot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.getByTestId('avatar-open').or(page.getByTestId('mirror').first()).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
}

/** Pixels of a screenshot in the dress's teal (#2F7F86 lit and shaded: green and blue well over red), counted in the page (no PNG decoder in Node). */
async function tealPixels(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1]! > d[i]! + 25 && d[i + 2]! > d[i]! + 25) n++;
    return n;
  }, png.toString('base64'));
}

test('a dress too small for the shopper is not drawn, in 3D and in 2D; a size that is only tight, or fits, is', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(BUNDLE, 'base.glb')), `no dress bundle at ${BUNDLE}`);
  test.setTimeout(900_000);
  const origin = new URL(baseURL!).origin;
  const garment = JSON.parse(readFileSync(join(BUNDLE, 'payload.json'), 'utf8')) as GarmentPayload & { productPhotos?: string[] };
  garment.productPhotos = [];
  // The fit engine's own answer for this body: what the embed must show.
  const fit = computeFit(garment, { measurements: BODY });
  expect(fit.recommendedSize).toBe('16');
  expect(wearBlock(fit, '12')).toEqual({ reason: 'tight', point: 'bust', anchor: 'chest', label: 'bust', shortCm: 3 });
  expect(wearBlock(fit, '14')).toBeNull();
  expect(wearBlock(fit, '16')).toBeNull();

  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await instrument(page, origin, garment);
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('82');
  await page.getByText('I know my measurements').click();
  await page.getByLabel(/^Bust/).fill(String(BODY.bust));
  await page.getByLabel(/^Waist/).fill(String(BODY.waist));
  await page.getByLabel(/^Hip/).fill(String(BODY.hip));
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
  await expect(page.getByTestId('recommended-size')).toContainText('16');

  // The 2D figure in her own size: the dress is drawn, nothing is said.
  const figure = page.getByTestId('mirror').first();
  await expect(figure.getByTestId('garment-layer')).toBeVisible();
  await expect(page.getByTestId('figure-not-drawn')).toHaveCount(0);
  await figureShot(page, 'dress-2d-body-AU16--size-16-drawn.png');

  await page.getByTestId('garment3d-open').click();
  const view = page.getByTestId('garment3d');
  const canvas = page.getByTestId('garment3d-canvas');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
  const teal: Record<string, number> = {};
  for (const size of ['16', '14', '12', '10', '8']) {
    await view.getByRole('radio', { name: size, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-size', size);
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
    const block = wearBlock(fit, size);
    await expect(canvas).toHaveAttribute('data-garment', block ? 'not-drawn' : 'drawn');
    await expect(view.getByText('Estimate · not measured')).toBeVisible();
    const note = page.getByTestId('garment3d-not-drawn');
    const figureNote = page.getByTestId('figure-not-drawn');
    if (block) {
      const sentence = `Size ${size} is not drawn: the size advice says it does not close at the bust, where your body is ${block.shortCm.toFixed(1)} cm larger than the garment, more than its fabric gives, so the body is shown without it.`;
      await expect(note).toHaveText(sentence);
      await expect(note).toHaveAttribute('data-anchor', 'chest');
      // The 2D figure above the view: the same size, the same sentence, the body alone, the rings still there.
      await expect(figureNote).toHaveText(sentence);
      await expect(figure.getByTestId('garment-layer')).toHaveCount(0);
      await expect(figure.locator('svg[role="img"]')).toHaveAttribute('data-garment', 'not-drawn');
      await expect(page.getByTestId('size-rings-legend')).toBeVisible();
    } else {
      await expect(note).toHaveCount(0);
      await expect(figureNote).toHaveCount(0);
      await expect(figure.getByTestId('garment-layer')).toBeVisible();
    }
    teal[size] = await tealPixels(page, await still(page, canvas));
    await still(page, view, `dress-3d-body-AU16--size-${size}-${block ? 'not-drawn' : 'drawn'}.png`);
    if (size === '12') await figureShot(page, 'dress-2d-body-AU16--size-12-not-drawn.png');
  }
  // The picture itself: a drawn dress covers tens of thousands of pixels in its colour, a size that is not drawn none.
  expect(teal['16']).toBeGreaterThan(20_000);
  expect(teal['14']).toBeGreaterThan(20_000);
  for (const size of ['12', '10', '8']) expect(teal[size], `size ${size}`).toBe(0);
  if (SHOTS) writeFileSync(join(SHOTS, 'dress-teal-pixels.json'), `${JSON.stringify({ body: BODY, tealPixelsOfTheCanvas: teal }, null, 2)}\n`);
  expect(errors).toEqual([]);
  await context.close();
});

test('a pull-on skirt whose waistband does not pass the hips is not drawn on the 2D figure either; the next size up is', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const origin = new URL(baseURL!).origin;
  // The pilot skirt with the shop's tape, on the chart line between AU 8 and AU 10 (hip 98): AU 8's band stretches to 94 cm.
  const body = { bust: 89, waist: 71.5, hip: 98 };
  const garment = { ...PILOT_PULL_ON_SKIRT, productPhotos: [] } as GarmentPayload;
  const fit = computeFit(garment, { measurements: body });
  expect(wearBlock(fit, '8')).toMatchObject({ reason: 'pull-on', point: 'hip', shortCm: 4 });
  expect(wearBlock(fit, '10')).toBeNull();
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await instrument(page, origin, garment, false);
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByText('I know my measurements').click();
  await expect(page.getByLabel(/^Hip/)).toBeVisible();
  if (await page.getByLabel(/^Bust/).count()) await page.getByLabel(/^Bust/).fill(String(body.bust));
  await page.getByLabel(/^Waist/).fill(String(body.waist));
  await page.getByLabel(/^Hip/).fill(String(body.hip));
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
  const figure = page.getByTestId('mirror').first();
  await expect(figure.getByTestId('garment-layer')).toBeVisible();
  await expect(page.getByTestId('figure-not-drawn')).toHaveCount(0);
  await page.getByRole('radiogroup', { name: /compare sizes/i }).getByRole('radio', { name: /^8/ }).click();
  await expect(page.getByTestId('figure-not-drawn')).toHaveText('Size 8 is not drawn: the size advice says its waistband does not stretch over your hips, which are 4.0 cm larger than the band at full stretch, so the body is shown without it.');
  await expect(page.getByTestId('figure-not-drawn')).toHaveAttribute('data-reason', 'pull-on');
  await expect(figure.getByTestId('garment-layer')).toHaveCount(0);
  await expect(page.getByTestId('size-rings-legend')).toBeVisible();
  await figureShot(page, 'skirt-2d-hip-98--size-8-not-drawn.png');
  await context.close();
});

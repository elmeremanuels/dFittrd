import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The look review of 18 Nov 2026 in the real embed: the production build at phone size (360 x 740,
 * 2x), the avatar prompt and the 3D view, for the azure dress, the crimson POM skirt (a drape bake)
 * and the photo skirt (git-ignored bundles; a product whose bundle is absent is skipped). Per
 * product: the result with the 3D view for Monk 1, 3, 6, 9 and 10 picked in the prompt, a close-up
 * of the canvas, and the whole page once. The build decides the lighting and the head
 * (`VITE_VIEWER_LIGHTING`, `VITE_VIEWER_HEAD`); `LOOK_LABEL` names the build in the file names.
 * Writes nothing without LOOK_SHOTS, and asserts only what the shopper must always see (the
 * estimate label, a settled view). Not part of `pnpm check`. EMULATED, not a phone: headless
 * Chromium, WebGL on SwiftShader.
 *
 * Env: LOOK_SHOTS  folder for the screenshots
 *      LOOK_LABEL  the build's name in the file names (default `build`)
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = join(ROOT, 'spikes', 'garment-engine', 'out');
const SHOTS = process.env.LOOK_SHOTS ?? null;
const LABEL = process.env.LOOK_LABEL ?? 'build';
const ASSET_PATH = `/assets/${SHOP_ID}/look/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
const PRODUCTS = [
  { id: 'azure-dress', dir: resolve(OUT, 'eval', 'azure-palm-baby-doll-dress'), body: { bust: '91', waist: '73.5', hip: '100' } },
  { id: 'pom-skirt', dir: resolve(OUT, 'pom2-bundle', 'crimson-wildflower-maxi-skirt'), body: { bust: '91', waist: '73.5', hip: '100' } },
  { id: 'photo-skirt', dir: resolve(OUT, 'eval', 'crimson-wildflower-maxi-skirt'), body: { bust: '91', waist: '73.5', hip: '100' } },
];
const TONES = [1, 3, 6, 9, 10];

async function instrument(page: Page, origin: string, bundle: string): Promise<void> {
  const garment = JSON.parse(readFileSync(join(bundle, 'payload.json'), 'utf8')) as { productPhotos?: string[] };
  const grading = JSON.parse(readFileSync(join(bundle, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] };
  // The product photos are on a third-party CDN; this test stays on its own origin.
  garment.productPhotos = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
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
}

async function save(name: string, png: Buffer): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), png);
}

/** A screenshot of an element once two in a row are the same. */
async function still(page: Page, locator: Locator): Promise<Buffer> {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  let last = await locator.screenshot();
  const until = Date.now() + 20_000;
  for (;;) {
    await page.waitForTimeout(300);
    const next = await locator.screenshot();
    if (next.equals(last) || Date.now() > until) break;
    last = next;
  }
  return last;
}

for (const product of PRODUCTS) {
  test(`the look in the embed: ${product.id}, Monk ${TONES.join(', ')}`, async ({ browser, baseURL }) => {
    test.skip(!existsSync(join(product.dir, 'base.glb')) || !existsSync(join(product.dir, 'payload.json')), `no bundle at ${product.dir} (git-ignored)`);
    test.setTimeout(3_600_000);
    const origin = new URL(baseURL!).origin;
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await instrument(page, origin, product.dir);
    await page.goto(`${baseURL}/embed/${TOKEN}`);
    await page.getByLabel(/^Height/).fill('168');
    await page.getByLabel(/^Weight/).fill('62');
    await page.getByText('I know my measurements').click();
    await expect(page.getByLabel(/^Hip/)).toBeVisible();
    if (await page.getByLabel(/^Bust/).count()) await page.getByLabel(/^Bust/).fill(product.body.bust);
    await page.getByLabel(/^Waist/).fill(product.body.waist);
    await page.getByLabel(/^Hip/).fill(product.body.hip);
    await page.getByTestId('see-my-size').click();
    await expect(page.getByTestId('embed-result')).toBeVisible();
    await page.getByTestId('garment3d-open').click();
    const canvas = page.getByTestId('garment3d-canvas');
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 600_000 });
    const view = page.getByTestId('garment3d');
    for (const monk of TONES) {
      await page.getByTestId('avatar-open').click();
      const dialog = page.getByRole('dialog', { name: 'Make the avatar look like you' });
      await expect(dialog).toBeVisible();
      const sw = dialog.getByRole('switch', { name: 'Match my skin tone' });
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      await dialog.getByTestId(`skin-swatch-${monk}`).check({ force: true });
      await dialog.getByTestId('avatar-prompt-done').click();
      await expect(dialog).toHaveCount(0);
      await expect(canvas).toHaveAttribute('data-state', 'settled');
      await expect(view.getByText('Estimate · not measured')).toBeVisible();
      await save(`embed--${LABEL}--${product.id}--monk${monk}.png`, await still(page, view));
      // The canvas alone, and the head and shoulders cut out of it (the canvas is 3:4; the head is in its top fifth).
      const box = (await canvas.boundingBox())!;
      await save(`embed--${LABEL}--${product.id}--monk${monk}--head.png`, await page.screenshot({ clip: { x: box.x + box.width * 0.3, y: box.y + box.height * 0.08, width: box.width * 0.4, height: box.height * 0.22 } }));
      if (monk === 1) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await save(`embed--${LABEL}--${product.id}--page-top.png`, await page.screenshot());
      }
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

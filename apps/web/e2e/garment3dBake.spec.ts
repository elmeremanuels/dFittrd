import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { pullOnCheck } from '@curtain/fit-engine';
import { checkGarmentTapeInput, PILOT_SKIRT_TAPE_MEASURED, type GarmentPayload } from '@curtain/schema';

/**
 * A server drape bake in the real embed (docs/research/step3-serverdrape-spike.md §10): the production build, a mocked
 * api and a bundle folder whose anchors.json names a `drapeBake` (the POM v2 skirt, git-ignored; the test is skipped
 * with a note when it is absent).
 *   - every size at phone size (360 x 740 at 2x), front and side, with the estimate label, the plain-colour note and
 *     the size's provenance (on the shop's tape / interpolated / extrapolated) on screen, drawn or not drawn where the
 *     bake says (a size is not draped on a drawn body its band cannot be pulled over, §10.9) and where the size advice
 *     says (a size whose band does not go over the shopper's hips is not drawn, wherever it lies against the bodies);
 *   - shoppers past the draped bodies (hip 98, 101, 112, 114 and 118 on the chart line): a size shown on its nearest
 *     body says so and why the next body out was not draped (its band), a size not draped on a body with hips like the
 *     shopper's is not drawn, and a size the advice blocks is not drawn either;
 *   - load-to-settled and size-switch times in the throttled phone page of the step-3 spike (412 x 915 at 2x, DevTools
 *     CPU throttle, default 4x), for this bundle and, with BAKE_COMPARE_BUNDLE, for another one (the photo bundle,
 *     draped on the device).
 * The product is served as the demo seeds it (apps/api/src/demo.ts): the pilot skirt's payload with the shop's tape and
 * the pull-on closure through the merchant form's check, so the embed's size advice runs its pull-on check.
 * Not part of `pnpm check`. EMULATED, not a phone: headless Chromium, WebGL on SwiftShader.
 *
 * Env: E2E_SKIRT_BUNDLE      the bake bundle folder (default spikes/garment-engine/out/pom2-bundle/crimson-wildflower-maxi-skirt)
 *      BAKE_COMPARE_BUNDLE   a second bundle to time the same way (optional)
 *      BAKE_SHOTS            folder for the screenshots and timing.json
 *      BAKE_BODY             bust,waist,hip typed into "I know my measurements" (default 91,73.5,100: the held-out body)
 *      BAKE_THROTTLE         CPU throttle of the timing runs (default 4)
 *      BAKE_SIZES            comma-separated sizes for "every size" (default: every graded size)
 *      BAKE_SIDE             0: front views only in "every size" (default 1: front and side)
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
const ONLY_SIZES = process.env.BAKE_SIZES ? process.env.BAKE_SIZES.split(',') : null;
const SIDE = process.env.BAKE_SIDE !== '0';
const ASSET_PATH = `/assets/${SHOP_ID}/skirt/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
/** Where the shopper's hip lies for one size of the bake (drapeBake.ts `bakePlace`, on the bake's hip axis). */
function placeOf(dir: string, size: string, hipCm: number): string {
  const meta = JSON.parse(readFileSync(join(dir, 'qa.json'), 'utf8')) as { sizes: { size: string; baseT: number; targetT: number[]; notDraped?: { t: number }[] }[] };
  const s = meta.sizes.find((x) => x.size === size)!;
  const t = (hipCm - 104) / 10;
  const nodes = [s.baseT, ...s.targetT];
  const lo = Math.min(...nodes), hi = Math.max(...nodes);
  if (t >= lo - 1e-9 && t <= hi + 1e-9) return 'within';
  const out = (s.notDraped ?? []).map((n) => n.t).filter((nt) => (t > hi ? nt > hi : nt < lo));
  if (out.length === 0) return 'held';
  const nearest = t > hi ? Math.min(...out) : Math.max(...out);
  return (t > hi ? t >= nearest - 1e-9 : t <= nearest + 1e-9) ? 'refused' : 'between';
}
/** The size advice's pull-on verdict at the shopper's hip (the fit engine's own check, on the band the bake states). */
function adviceBlocked(dir: string, size: string, hipCm: number): boolean {
  const tape = (JSON.parse(readFileSync(join(dir, 'qa.json'), 'utf8')) as { tape: { sizes: { size: string; tape: { stretchedGirthCm: { cm: number; source: 'measured' | 'interpolated' | 'extrapolated' } } }[] } }).tape;
  const band = tape.sizes.find((x) => x.size === size)!.tape.stretchedGirthCm;
  return pullOnCheck({ cm: band.cm, provenance: band.source }, hipCm).status === 'blocked';
}
const isBake = (dir: string): boolean => existsSync(join(dir, 'anchors.json')) && (JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8')) as { drapeBake?: string }).drapeBake === 'base.glb';

async function instrument(page: Page, origin: string, bundle: string): Promise<Request[]> {
  const seen: Request[] = [];
  const garment = JSON.parse(readFileSync(join(bundle, 'payload.json'), 'utf8')) as GarmentPayload & { productPhotos?: string[] };
  const productId = (JSON.parse(readFileSync(join(bundle, 'anchors.json'), 'utf8')) as { productId?: string }).productId;
  if (productId === 'crimson-wildflower-maxi-skirt' && !garment.garmentTape) {
    // As the demo seeds it (demoSeed.ts `demoTapeFields`): the shop's tape and the pull-on closure.
    const check = checkGarmentTapeInput({ category: garment.category, chart: garment.sizeChart, closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED });
    if (!check.ok) throw new Error(`the pilot skirt's tape is refused: ${check.errors.map((e) => e.message).join(' ')}`);
    if (check.closure) garment.closure = check.closure;
    if (check.garmentTape) garment.garmentTape = check.garmentTape;
  }
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
async function toResult(page: Page, baseURL: string, body: { bust: string; waist: string; hip: string } = { bust: BUST!, waist: WAIST!, hip: HIP! }): Promise<void> {
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByText('I know my measurements').click();
  // A bottom asks no bust: the embed estimates it from height and weight.
  await expect(page.getByLabel(/^Hip/)).toBeVisible();
  if (await page.getByLabel(/^Bust/).count()) await page.getByLabel(/^Bust/).fill(body.bust);
  await page.getByLabel(/^Waist/).fill(body.waist);
  await page.getByLabel(/^Hip/).fill(body.hip);
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
  const sizes = (JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { sizes: { size: string; provenance?: string }[] }).sizes.filter((s) => !ONLY_SIZES || ONLY_SIZES.includes(s.size));
  const notes: Record<string, string> = {};
  for (const s of sizes) {
    await view.getByRole('radio', { name: s.size, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-size', s.size);
    await expect(canvas).toHaveAttribute('data-state', 'settled');
    await expect(view.getByText('Estimate · not measured')).toBeVisible();
    await expect(page.getByTestId('garment3d-label')).toContainText('estimate');
    const note = page.getByTestId('garment3d-bake-note');
    await expect(note).toContainText('one plain colour');
    await expect(note).toContainText(s.provenance === 'measured' ? `Size ${s.size} is built from the shop’s tape.` : `it is ${String(s.provenance)} from the sizes that are`);
    const place = placeOf(BUNDLE, s.size, Number(HIP));
    const blocked = adviceBlocked(BUNDLE, s.size, Number(HIP));
    await expect(note).toHaveAttribute('data-place', place);
    if (blocked) await expect(note).toHaveAttribute('data-advice-blocked', 'true');
    else await expect(note).not.toHaveAttribute('data-advice-blocked');
    await expect(canvas).toHaveAttribute('data-garment', place === 'refused' || blocked ? 'not-drawn' : 'drawn');
    await expect(note).not.toContainText('simulation');
    notes[s.size] = await note.innerText();
    await still(page, view, `size-${s.size}-front.png`);
    if (!SIDE) continue;
    await turn(page, canvas, 90);
    await still(page, view, `size-${s.size}-side.png`);
    await turn(page, canvas, -90);
    await still(page, view);
  }
  if (SHOTS) writeFileSync(join(SHOTS, 'notes.json'), `${JSON.stringify({ body: { bust: BUST, waist: WAIST, hip: HIP }, notes }, null, 2)}\n`);
  expect(errors).toEqual([]);
  await context.close();
});

test('past the draped bodies: shown on the nearest one with the reason, or not drawn where the band does not go on', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(BUNDLE, 'base.glb')) || !isBake(BUNDLE), `no drape bake bundle at ${BUNDLE} (git-ignored; set E2E_SKIRT_BUNDLE)`);
  test.setTimeout(1_800_000);
  const origin = new URL(baseURL!).origin;
  const sizes = (JSON.parse(readFileSync(join(BUNDLE, 'qa.json'), 'utf8')) as { sizes: { size: string; baseT: number; targetT: number[]; notDraped?: { t: number; rule?: string }[] }[] }).sizes;
  const s16 = sizes.find((s) => s.size === '16');
  test.skip(!s16?.notDraped?.some((n) => n.t === 1 && n.rule === 'pull-on'), 'this bake drapes AU 16 on the AU 16 body (an older bake: re-run bake-pom.ts)');
  // The chart line of the bake's axis (bust 95 + 10 t, waist 77.5 + 10 t, hip 104 + 10 t): t = -0.6, -0.3, 0.8, 1 and 1.4.
  // The bake: AU 8 on the 94 cm body only, AU 10 up to 99, AU 12 up to 104, AU 14 and AU 16 up to 109 (the drawn bodies'
  // widest girths below the waist are 96.5 / 101.6 / 106.8 / 111.9 / 117). The size advice blocks AU 8 over 96.5 cm hips,
  // AU 10 over 102.5, AU 12 over 107.5, AU 14 over 112.5 and AU 16 (extrapolated band, no allowance) over 115.
  const ADVICE = 'the size advice says its waistband does not stretch over your hips';
  const band = (size: string, hip: string): string => `its band does not stretch over the model with ${hip} cm hips, so size ${size} was not draped on it`;
  const cases = [
    // AU 8 lies between its 94 cm body and the refused 99 cm one; the advice blocks it at 98 cm hips: not drawn.
    { hip: '98', bust: '89', waist: '71.5', checks: [{ size: '8', place: 'between', blocked: true, text: ADVICE, garment: 'not-drawn' }, { size: '10', place: 'within', blocked: false, text: '', garment: 'drawn' }] },
    { hip: '101', bust: '92', waist: '74.5', checks: [{ size: '8', place: 'refused', blocked: true, text: ADVICE, garment: 'not-drawn' }, { size: '10', place: 'between', blocked: false, text: band('10', '104.0'), garment: 'drawn' }, { size: '12', place: 'within', blocked: false, text: '', garment: 'drawn' }] },
    { hip: '112', bust: '103', waist: '85.5', checks: [{ size: '12', place: 'refused', blocked: true, text: ADVICE, garment: 'not-drawn' }, { size: '14', place: 'between', blocked: false, text: band('14', '114.0'), garment: 'drawn' }, { size: '16', place: 'between', blocked: false, text: band('16', '114.0'), garment: 'drawn' }] },
    // On the 114 cm body itself the advice lets AU 16 on (115 against 114), the drawn body is 117 cm at its widest: not drawn.
    { hip: '114', bust: '105', waist: '87.5', checks: [{ size: '16', place: 'refused', blocked: false, text: 'Size 16 is not drawn: its band does not stretch over the model with 114.0 cm hips, and yours are at least that.', garment: 'not-drawn' }] },
    { hip: '118', bust: '109', waist: '91.5', checks: [{ size: '14', place: 'refused', blocked: true, text: ADVICE, garment: 'not-drawn' }, { size: '16', place: 'refused', blocked: true, text: ADVICE, garment: 'not-drawn' }] },
  ];
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await instrument(page, origin, BUNDLE);
    await toResult(page, baseURL!, c);
    await page.getByTestId('garment3d-open').click();
    const canvas = page.getByTestId('garment3d-canvas');
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });
    const view = page.getByTestId('garment3d');
    for (const k of c.checks) {
      await view.getByRole('radio', { name: k.size, exact: true }).click();
      await expect(canvas).toHaveAttribute('data-size', k.size);
      await expect(canvas).toHaveAttribute('data-garment', k.garment);
      const note = page.getByTestId('garment3d-bake-note');
      await expect(note).toHaveAttribute('data-place', k.place);
      if (k.blocked) await expect(note).toHaveAttribute('data-advice-blocked', 'true');
      else await expect(note).not.toHaveAttribute('data-advice-blocked');
      if (k.text) await expect(note).toContainText(k.text);
      await expect(note).not.toContainText('simulation');
      await expect(view.getByText('Estimate · not measured')).toBeVisible();
      await still(page, view, `hip-${c.hip}-size-${k.size}-front.png`);
    }
    expect(errors).toEqual([]);
    await context.close();
  }
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

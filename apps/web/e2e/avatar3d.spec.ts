import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { deltaE2000, deltaEHex, diffShots, hexToRgb, labOf, rgbToHex, type Rgb, type ShotDiff } from './colour';

/**
 * The avatar prompt and the 3D view together (D19, photo-avatar-plan slice 1), on the production
 * build at phone size (360 x 740, 2x), with a real approved bundle (the demo's crimson maxi skirt,
 * as `pnpm demo:e2e` uses it; git-ignored, so the test is skipped with a note when it is absent):
 *   - a colour picked in the prompt is on the 3D mannequin: same canvas, same mounted view (its
 *     state never leaves `settled`), and the page makes NO request for it;
 *   - it is the body that changes colour, the same area for every tone;
 *   - switching "Match my skin tone" off returns the mannequin to its standard colour;
 *   - a lost and restored WebGL context brings the same picture back (the settled view is idle):
 *     with a picked colour, in the standard colour, and after a size switch;
 *   - a view opened after the colour was picked starts in that colour;
 *   - the 3D view keeps its estimate label throughout (rule 3).
 * It also measures, without asserting a limit, how far the 2D figure and the 3D body (lighting
 * `classic`) are from the picked swatch, and writes the table to AVATAR_SHOTS when that is set.
 *
 * Env: E2E_SKIRT_BUNDLE (or DEMO_SKIRT_BUNDLE)  the bundle folder
 *      AVATAR_SHOTS                             folder for the screenshots and colour-report.json
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const SHOTS = process.env.AVATAR_SHOTS ?? null;
const VIEWPORT = { width: 360, height: 740 };
const BUNDLE = resolve(process.env.E2E_SKIRT_BUNDLE ?? process.env.DEMO_SKIRT_BUNDLE ?? fileURLToPath(new URL('../../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt', import.meta.url)));
const ASSET_PATH = `/assets/${SHOP_ID}/skirt/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
/** The swatches of Monk 2, 6 and 9 (light, medium, deep), as the prompt offers them. */
const TONES: { monk: number; hex: string }[] = [
  { monk: 2, hex: '#F3E7DB' },
  { monk: 6, hex: '#A07E56' },
  { monk: 9, hex: '#3A312A' },
];
/** The 2D figure's standard colour and the 3D mannequin's (the viewer's mid-grey). */
const STANDARD_2D = '#DFC3A8';
const STANDARD_3D = '#8C8C8C';

interface Seen {
  url: string;
  method: string;
}

async function instrument(page: Page, origin: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  const garment = JSON.parse(readFileSync(join(BUNDLE, 'payload.json'), 'utf8')) as { productPhotos?: string[] };
  const grading = JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] };
  // The product photos are on a third-party CDN; this test stays on its own origin.
  garment.productPhotos = [];
  await page.route('**/*', async (route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    seen.push({ url: req.url(), method: req.method() });
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
          asset: { version: '0123456789abcdef', baseUrl: `${origin}${ASSET_PATH}`, baseSize: grading.baseSize, sizes: grading.sizes.map((s) => s.size), label: 'estimate' },
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
  return seen;
}

/**
 * Screenshot of an element once it is still: two pictures in a row are the same (the garment layer
 * fades in, the sheet slides, the viewer draws a new colour on its next frames, and a busy machine
 * takes its time). With `not`, the still picture must also differ from that one: the change has landed.
 */
async function still(page: Page, locator: Locator, name?: string, not?: Buffer): Promise<Buffer> {
  // To the top of the window: the sticky "Choose size" bar then covers nothing of it.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  let last = await locator.screenshot();
  const until = Date.now() + 20_000;
  for (;;) {
    await page.waitForTimeout(300);
    const next = await locator.screenshot();
    if (next.equals(last) && !(not && next.equals(not))) break;
    if (Date.now() > until) break; // the assertions on the picture say what is wrong with it
    last = next;
  }
  if (SHOTS && name) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, name), last);
  }
  return last;
}

async function pageShot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, name) });
}

/** Open the prompt from the 2D figure, do something in it, close it with "Done". */
async function inPrompt(page: Page, act: (dialog: Locator) => Promise<void>): Promise<void> {
  await page.getByTestId('avatar-open').click();
  const dialog = page.getByRole('dialog', { name: 'Make the avatar look like you' });
  await expect(dialog).toBeVisible();
  await act(dialog);
  await dialog.getByTestId('avatar-prompt-done').click();
  await expect(dialog).toHaveCount(0);
}

const row = (label: string, asked: string, d: ShotDiff): Record<string, unknown> => {
  const lab = (rgb: Rgb | null): number[] | null => (rgb ? labOf(rgb).map((v) => Math.round(v * 10) / 10) : null);
  const want = labOf(hexToRgb(asked));
  const dE = (rgb: Rgb | null): number | null => (rgb ? Math.round(deltaE2000(want, labOf(rgb)) * 10) / 10 : null);
  return {
    where: label,
    asked,
    askedLab: want.map((v) => Math.round(v * 10) / 10),
    median: d.medianB ? rgbToHex(d.medianB) : null,
    medianLab: lab(d.medianB),
    dE2000: dE(d.medianB),
    dL: d.medianB ? Math.round((labOf(d.medianB)[0] - want[0]) * 10) / 10 : null,
    darkest10pct: d.p10B ? rgbToHex(d.p10B) : null,
    dE2000Darkest10pct: dE(d.p10B),
    lightest10pct: d.p90B ? rgbToHex(d.p90B) : null,
    dE2000Lightest10pct: dE(d.p90B),
    pixels: d.changed,
  };
};

test('a skin colour picked in the avatar prompt is on the 3D mannequin: no remount, no request, and off returns the standard colour', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(BUNDLE, 'base.glb')), `no skirt bundle at ${BUNDLE} (git-ignored; set E2E_SKIRT_BUNDLE)`);
  test.setTimeout(480_000);
  const origin = new URL(baseURL!).origin;
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const decoder = await context.newPage();
  const errors: string[] = [];
  let contextLosses = 0;
  page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    // A software GPU under load can lose its contexts by itself; the test then says so.
    if (/Context Lost/.test(m.text())) contextLosses += 1;
  });
  const seen = await instrument(page, origin);
  await page.bringToFront();
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
  await page.waitForLoadState('networkidle');

  const figure = page.locator('[data-testid="embed-result"] [data-testid="mirror"]').first();
  const figureSkin = (): Promise<string | null> => page.locator('[data-testid="embed-result"] svg[data-skin]').first().getAttribute('data-skin');
  expect(await figureSkin()).toBe(STANDARD_2D);
  const figureStandard = await still(page, figure);

  // ---- open the 3D view in the standard colour ---------------------------------------------------
  await page.getByTestId('garment3d-open').click();
  const canvas = page.getByTestId('garment3d-canvas');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });
  const files = seen.filter((r) => new URL(r.url).pathname.startsWith(ASSET_PATH)).map((r) => new URL(r.url).pathname.split('/').pop());
  expect([...files].sort()).toEqual([...BUNDLE_FILES].sort());
  await expect(page.getByTestId('garment3d-label')).toContainText('estimate');
  const view = page.getByTestId('garment3d');
  await expect(view.getByText('Estimate · not measured')).toBeVisible();
  // Watch the canvas: a remount would replace it, a new drape or a reload would change its state.
  await canvas.evaluate((el) => {
    const w = window as unknown as { __c3d: Element; __c3dStates: string[] };
    w.__c3d = el;
    w.__c3dStates = [];
    new MutationObserver(() => w.__c3dStates.push((el as HTMLElement).dataset.state ?? '')).observe(el, { attributes: true, attributeFilter: ['data-state'] });
  });
  const sameView = (): Promise<{ same: boolean; states: string[] }> =>
    page.evaluate(() => {
      const w = window as unknown as { __c3d: Element; __c3dStates: string[] };
      return { same: document.querySelector('[data-testid="garment3d-canvas"]') === w.__c3d && w.__c3d.isConnected, states: w.__c3dStates };
    });
  /** Take the view's WebGL context away and give it back (a tab put to sleep, a GPU reset); the viewer must see it go. */
  const loseAndRestore = async (): Promise<void> => {
    const lossesBefore = contextLosses;
    const lost = await canvas.evaluate(async (el) => {
      const gl = (el as HTMLCanvasElement).getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !ext) return false;
      const restored = new Promise<void>((done) => el.addEventListener('webglcontextrestored', () => done(), { once: true }));
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 200));
      ext.restoreContext();
      await restored;
      return true;
    });
    expect(lost, 'could not lose the WebGL context of the 3D view').toBe(true);
    expect(contextLosses, 'the viewer did not see its context go').toBe(lossesBefore + 1);
  };
  const standard = await still(page, canvas, '3d-standard-colour.png');
  // The picture is still: a second one is the same, so a difference later is the colour's.
  const again = await diffShots(decoder, standard, await still(page, canvas));
  expect(again.changed, 'the settled 3D view is not still').toBe(0);

  // ---- from here on: no request at all -----------------------------------------------------------
  const before = seen.length;
  const report: Record<string, unknown>[] = [];
  const bodies: { monk: number; hex: string; diff: ShotDiff; png: Buffer }[] = [];
  let lastFigure = figureStandard;
  for (const tone of TONES) {
    await inPrompt(page, async (dialog) => {
      const sw = dialog.getByRole('switch', { name: 'Match my skin tone' });
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      // Skin slider (CUR-28): set the value directly; (monk-1)/9 is the slider position.
      await dialog.getByTestId('skin-slider-input').evaluate((el, m) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, String((m - 1) / 9));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, tone.monk);
      if (tone.monk === 6) await pageShot(page, 'prompt-tone-6-picked.png');
    });
    expect(await figureSkin()).toBe(tone.hex);
    const figPng = await still(page, figure, `2d-tone-${tone.monk}.png`, lastFigure);
    lastFigure = figPng;
    const fig = await diffShots(decoder, figureStandard, figPng, { keepA: 'warm' });
    const png = await still(page, canvas, `3d-tone-${tone.monk}.png`, bodies.at(-1)?.png ?? standard);
    await pageShot(page, `3d-view-tone-${tone.monk}-phone.png`);
    const diff = await diffShots(decoder, standard, png, { keepA: 'grey' });
    bodies.push({ ...tone, diff, png });
    // The body took a colour: a good part of the picture changed, and where it changed it was the grey mannequin.
    expect(diff.changed, `Monk ${tone.monk}: the 3D body did not change colour`).toBeGreaterThan(diff.total * 0.02);
    await expect(view.getByText('Estimate · not measured')).toBeVisible();
    report.push(row(`2D figure, Monk ${tone.monk}`, tone.hex, fig), row(`3D body (classic), Monk ${tone.monk}`, tone.hex, diff));
  }
  // Each body is nearest its own swatch among the three, and they run from light to deep.
  for (const b of bodies) {
    const nearest = [...TONES].sort((x, y) => deltaE2000(labOf(b.diff.medianB!), labOf(hexToRgb(x.hex))) - deltaE2000(labOf(b.diff.medianB!), labOf(hexToRgb(y.hex))))[0]!;
    expect(nearest.monk, `the 3D body of Monk ${b.monk} looks like Monk ${nearest.monk}`).toBe(b.monk);
  }
  const lightness = bodies.map((b) => labOf(b.diff.medianB!)[0]);
  expect(lightness[0]! > lightness[1]! && lightness[1]! > lightness[2]!, `3D lightness does not run light to deep: ${lightness.join(', ')}`).toBe(true);
  // The same pixels in every tone: the bare body (the skirt is a little see-through, so the legs under it change too).
  const sizes = bodies.map((b) => b.diff.changed);
  expect(Math.max(...sizes) / Math.min(...sizes), `the changed area differs between tones: ${sizes.join(', ')}`).toBeLessThan(1.25);

  // A lost context while a colour is picked: the picture comes back in that colour (Monk 9, the last one set).
  const picked = bodies.at(-1)!;
  await loseAndRestore();
  const backPicked = await diffShots(decoder, picked.png, await still(page, canvas, '3d-after-context-loss-tone-9.png'));
  expect(backPicked.changed, 'after a lost and restored WebGL context the 3D view lost its picked colour or its picture').toBeLessThanOrEqual(Math.round(backPicked.total * 0.0005));
  // And it is not the standard picture: the comparison above was against the coloured one.
  expect((await diffShots(decoder, standard, picked.png)).changed).toBeGreaterThan(backPicked.total * 0.02);

  // Off again: the mannequin is back in its standard colour, pixel for pixel.
  await inPrompt(page, async (dialog) => {
    await dialog.getByTestId('avatar-skin-switch').click();
    await expect(dialog.getByTestId('avatar-skin-switch')).toHaveAttribute('aria-checked', 'false');
  });
  expect(await figureSkin()).toBe(STANDARD_2D);
  const off = await diffShots(decoder, standard, await still(page, canvas, '3d-off-again.png', bodies.at(-1)!.png));
  expect(off.changed, 'switching the skin tone off did not return the 3D body to the standard colour').toBeLessThanOrEqual(Math.round(off.total * 0.0005));

  const during = seen.slice(before);
  expect(during, `requests during the look changes: ${during.map((r) => `${r.method} ${r.url}`).join(', ')}`).toEqual([]);
  const watched = await sameView();
  expect(watched.same, 'the 3D canvas was replaced (a remount)').toBe(true);
  expect(watched.states, 'the 3D view left the settled state (a new mount or drape)').toEqual([]);

  // ---- a lost WebGL context (a tab put to sleep, a GPU reset) comes back with the picture ----------
  await loseAndRestore();
  const back = await diffShots(decoder, standard, await still(page, canvas, '3d-after-context-loss.png'));
  expect(back.changed, 'after a lost and restored WebGL context the 3D view is not the picture it was').toBeLessThanOrEqual(Math.round(back.total * 0.0005));
  await expect(canvas).toHaveAttribute('data-state', 'settled');

  // ---- and after a size switch: the size on screen is the one drawn again, not the first one -----
  const sizes3d = await page.getByRole('radiogroup', { name: 'Compare sizes' }).getByRole('radio').all();
  const startAt = await canvas.getAttribute('data-size');
  let other: Locator | null = null;
  let original: Locator | null = null;
  for (const r of sizes3d) {
    if ((await r.getAttribute('aria-checked')) === 'true') original = r;
    else other ??= r;
  }
  expect(original, 'no size is selected').not.toBeNull();
  expect(other, 'the skirt has one size only: no size switch to test').not.toBeNull();
  await other!.click();
  await expect(canvas).not.toHaveAttribute('data-size', startAt ?? '');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });
  const otherSize = await still(page, canvas, '3d-other-size.png', standard);
  expect((await diffShots(decoder, standard, otherSize)).changed, 'the other size looks the same as the first').toBeGreaterThan(0);
  await loseAndRestore();
  const backOther = await diffShots(decoder, otherSize, await still(page, canvas, '3d-after-context-loss-other-size.png'));
  expect(backOther.changed, 'after a size switch, a lost and restored WebGL context did not bring back the size on screen').toBeLessThanOrEqual(Math.round(backOther.total * 0.0005));
  await expect(canvas).toHaveAttribute('data-state', 'settled');
  // Back to the first size for the rest of the test (its drape is kept, so this is quick).
  await original!.click();
  await expect(canvas).toHaveAttribute('data-size', startAt ?? '');
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });

  // ---- a view opened after the colour was picked starts in that colour ---------------------------
  await view.getByRole('button', { name: 'Close the 3D view' }).click();
  await expect(page.getByTestId('garment3d-open')).toBeVisible();
  await inPrompt(page, async (dialog) => {
    await dialog.getByTestId('avatar-skin-switch').click();
    // Skin slider (CUR-28): set monk 6 (slider = 5/9).
    await dialog.getByTestId('skin-slider-input').evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, String(5 / 9));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.getByTestId('garment3d-open').click();
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });
  // The body of the new view against the grey one of the first: the same pixels in the same colour
  // as when the colour was set on the mounted view. (The skirt is not compared: it is draped anew,
  // and a fold that settles a hair differently moves its print.)
  const reopened = await diffShots(decoder, standard, await still(page, canvas, '3d-opened-with-tone-6.png'), { keepA: 'grey' });
  const mounted = bodies[1]!.diff;
  expect(deltaE2000(labOf(reopened.medianB!), labOf(mounted.medianB!)), 'a view opened with a picked colour is not in the colour a mounted view takes').toBeLessThan(1);
  expect(Math.abs(reopened.changed - mounted.changed) / mounted.changed, 'a view opened with a picked colour colours another area than a mounted view').toBeLessThan(0.05);

  // ---- the measured difference (not a limit: lighting stays `classic` until the founder decides) --
  for (const b of bodies) {
    const fig = report.find((r) => r.where === `2D figure, Monk ${b.monk}`) as { median: string };
    report.push({ where: `2D figure vs 3D body (classic), Monk ${b.monk}`, a: fig.median, b: rgbToHex(b.diff.medianB!), dE2000: Math.round(deltaEHex(fig.median, rgbToHex(b.diff.medianB!)) * 10) / 10 });
  }
  report.push({ where: 'no colour picked: 2D standard colour vs 3D standard mannequin (by design: the 3D body stays the grey mannequin)', a: STANDARD_2D, b: STANDARD_3D, dE2000: Math.round(deltaEHex(STANDARD_2D, STANDARD_3D) * 10) / 10 });
  if (SHOTS) writeFileSync(join(SHOTS, 'colour-report.json'), `${JSON.stringify({ viewport: VIEWPORT, deviceScaleFactor: 2, lighting: 'classic', method: 'median sRGB over every bare-body pixel (a pixel that differs from the standard-colour picture and is bare body there: all visible skin, shaded sides included, not the body seen through the skirt); CIEDE2000 against the picked swatch', rows: report }, null, 2)}\n`);
  console.log(report.map((r) => JSON.stringify(r)).join('\n'));

  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

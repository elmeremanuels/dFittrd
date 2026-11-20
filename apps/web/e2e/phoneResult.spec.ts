import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { computeFit, wearBlock } from '@curtain/fit-engine';
import { PILOT_PULL_ON_SKIRT, type GarmentPayload } from '@curtain/schema';

/**
 * What a shopper sees on the result screen at phone sizes (docs/OPEN-ISSUES.md OI-105, OI-104, OI-83): the production
 * build, a mocked api, three screens (360 x 640, 390 x 844, 430 x 932 at 2x).
 *   - OI-105: a size that is not drawn shows the body alone and one sentence that says why. Wherever the shopper has
 *     scrolled, while a real part of that picture is on screen the whole sentence is on screen too, above the sticky
 *     "Choose size" bar and not under anything, on the 2D figure and under the 3D view; the figure's estimate label is
 *     still there and not under the sentence.
 *   - OI-104: the size-ring chips under the 3D view of a men's garment read "Chest", never "Bust".
 *   - OI-83: the female 2D figure has no hole: every point inside one of its parts (head, torso, legs, arms) is filled,
 *     asked of the browser's own fill (`isPointInFill`), for a slim, a mid and a full body. One place is counted apart:
 *     a loop under half a pixel wide where the torso's outline crosses itself between the legs (OI-134).
 * The 3D tests use the SYNTHETIC tape-built dress and men's tee of `spikes/garment-engine` (not products), draped on the
 * device; the bundles are git-ignored and built here when absent. EMULATED, not a phone: headless Chromium, SwiftShader.
 * Not part of `pnpm check`.
 *
 * Env: PHONE_SHOTS   folder for the screenshots (phone size at 2x)
 *      PHONE_SHOT_TAG  a word put in each file name (`before`, `after`)
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = join(ROOT, 'spikes', 'garment-engine', 'out');
const DRESS = resolve(process.env.E2E_DRESS_BUNDLE ?? join(OUT, 'synthetic-tape-babydoll-dress'));
const TEE = resolve(process.env.E2E_TEE_BUNDLE ?? join(OUT, 'synthetic-men-tee'));
const SHOTS = process.env.PHONE_SHOTS ?? null;
const TAG = process.env.PHONE_SHOT_TAG ?? 'after';
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
const PHONES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;
/** This much of a picture on screen counts as "the shopper is looking at it". */
const PICTURE_IN_VIEW_PX = 120;

test.beforeAll(() => {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  if (!existsSync(join(DRESS, 'base.glb')) && !process.env.E2E_DRESS_BUNDLE) spawnSync(pnpm, ['--filter', '@curtain/garment-spike', 'exec', 'tsx', 'scripts/build-dress-bundle.ts'], { cwd: ROOT, stdio: 'ignore' });
  if (!existsSync(join(TEE, 'base.glb')) && !process.env.E2E_TEE_BUNDLE) spawnSync(pnpm, ['--filter', '@curtain/garment-spike', 'exec', 'tsx', 'scripts/build-bundle.ts', '--only', 'synthetic-men-tee', '--skip-separation'], { cwd: ROOT, stdio: 'ignore' });
});

async function instrument(page: Page, origin: string, garment: GarmentPayload, bundle: string | null): Promise<void> {
  const assetPath = `/assets/${SHOP_ID}/p/0123456789abcdef`;
  const grading = bundle ? (JSON.parse(readFileSync(join(bundle, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] }) : null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (bundle && url.pathname.startsWith(`${assetPath}/`)) {
      const file = url.pathname.slice(assetPath.length + 1);
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
          ...(grading ? { asset: { version: '0123456789abcdef', baseUrl: `${origin}${assetPath}`, baseSize: grading.baseSize, sizes: grading.sizes.map((s) => s.size), label: 'estimate' } } : {}),
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
}

async function phone(browser: Browser, size: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport: size, locale: 'en-AU', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  return context.newPage();
}

async function aboutYou(page: Page, baseURL: string, body: { height: number; weight: number; bust?: number; waist: number; hip: number }): Promise<void> {
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill(String(body.height));
  await page.getByLabel(/^Weight/).fill(String(body.weight));
  await page.getByText('I know my measurements').click();
  await expect(page.getByLabel(/^Waist/)).toBeVisible();
  const chest = page.getByLabel(/^(Bust|Chest)/);
  if (body.bust !== undefined && (await chest.count())) await chest.fill(String(body.bust));
  await page.getByLabel(/^Waist/).fill(String(body.waist));
  const hip = page.getByLabel(/^(Hip|Seat)/);
  if (await hip.count()) await hip.fill(String(body.hip));
  await page.getByTestId('see-my-size').click();
}

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}--${TAG}.png`), ...(clip ? { clip } : {}) });
}

interface Sweep {
  /** Scroll positions at which the picture was on screen. */
  looked: number;
  /** What was wrong, one line per scroll position. */
  wrong: string[];
  /** The first scroll position at which the sentence had to ride above the bar (it would otherwise be under it or below the screen). */
  rideAt: number | null;
}

/**
 * Scrolls the result from top to bottom in small steps. At every step where at least `PICTURE_IN_VIEW_PX` of the picture
 * is on screen above the "Choose size" bar, the sentence must be wholly on screen above the bar and on top (the element
 * under its corners and centre is the sentence itself); the estimate label, when given, must not be under the sentence.
 */
async function sweep(page: Page, picture: string, sentence: string, label: string | null): Promise<Sweep> {
  return page.evaluate(
    async ({ picture, sentence, label, need }) => {
      const q = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
      const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
      const max = scroller.scrollHeight - window.innerHeight;
      const out = { looked: 0, wrong: [] as string[], rideAt: null as number | null };
      const pic = q(picture)!;
      const note = q(sentence);
      if (!note) return { ...out, wrong: ['the sentence is not on the page'] };
      const naturalTop = note.getBoundingClientRect().top + scroller.scrollTop;
      for (let y = 0; y <= max + 15; y += 16) {
        scroller.scrollTop = Math.min(y, max);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const at = scroller.scrollTop;
        const bar = q('choose-bar')!.getBoundingClientRect();
        const line = Math.min(bar.top, window.innerHeight);
        const p = pic.getBoundingClientRect();
        const seen = Math.min(p.bottom, line) - Math.max(p.top, 0);
        if (seen < need) continue;
        out.looked++;
        const n = note.getBoundingClientRect();
        if (out.rideAt === null && Math.abs(n.top + at - naturalTop) > 1) out.rideAt = at;
        if (n.height < 8 || n.top < 0 || n.bottom > line + 0.5 || n.left < 0 || n.right > window.innerWidth + 0.5) {
          out.wrong.push(`scroll ${at}: sentence at ${Math.round(n.top)}..${Math.round(n.bottom)}, bar starts at ${Math.round(line)}, screen is ${window.innerHeight} high`);
          continue;
        }
        const onTop = [
          [n.left + 3, n.top + 3],
          [n.right - 3, n.top + 3],
          [n.left + n.width / 2, n.top + n.height / 2],
          [n.left + 3, n.bottom - 3],
          [n.right - 3, n.bottom - 3],
        ].every(([x, yy]) => {
          const el = document.elementFromPoint(x!, yy!);
          return !!el && (el === note || note.contains(el));
        });
        if (!onTop) out.wrong.push(`scroll ${at}: something lies over the sentence`);
        const badge = label ? pic.querySelector(`[data-testid="${label}"]`) : null;
        if (badge) {
          const b = badge.getBoundingClientRect();
          const overlap = b.bottom > n.top + 0.5 && b.top < n.bottom - 0.5 && b.right > n.left + 0.5 && b.left < n.right - 0.5;
          if (overlap) out.wrong.push(`scroll ${at}: the estimate label is under the sentence`);
          if (b.bottom > line + 0.5) out.wrong.push(`scroll ${at}: the estimate label is under the bar`);
        }
      }
      return out;
    },
    { picture, sentence, label, need: PICTURE_IN_VIEW_PX },
  );
}

/** Scrolls so the picture's top is `offset` px under the top of the screen. */
async function scrollPictureTo(page: Page, picture: string, offset: number): Promise<void> {
  await page.getByTestId(picture).first().evaluate((el, o) => {
    const scroller = document.scrollingElement ?? document.documentElement;
    scroller.scrollTop += el.getBoundingClientRect().top - o;
  }, offset);
}

for (const size of PHONES) {
  const name = `${size.width}x${size.height}`;

  test(`OI-105, 2D, ${name}: the sentence of a skirt size that is not drawn is on screen with the figure`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    // The pilot skirt on the chart line between AU 8 and AU 10 (hip 98): AU 8's band does not stretch over the hips.
    const body = { height: 168, weight: 62, bust: 89, waist: 71.5, hip: 98 };
    const garment = { ...PILOT_PULL_ON_SKIRT, productPhotos: [] } as GarmentPayload;
    expect(wearBlock(computeFit(garment, { measurements: body }), '8')).toMatchObject({ reason: 'pull-on' });
    const page = await phone(browser, size);
    await instrument(page, new URL(baseURL!).origin, garment, null);
    await aboutYou(page, baseURL!, body);
    await expect(page.getByTestId('embed-result')).toBeVisible();
    await page.getByRole('radiogroup', { name: /compare sizes/i }).getByRole('radio', { name: /^8/ }).click();
    await expect(page.getByTestId('figure-not-drawn')).toContainText('Size 8 is not drawn');
    await expect(page.getByTestId('mirror').first().getByTestId('garment-layer')).toHaveCount(0);
    // The shot a shopper gets with the figure's head at the top of the screen.
    await scrollPictureTo(page, 'mirror', 56);
    await shot(page, `oi-105-2d-skirt-size-8-not-drawn-${name}`);
    // And with the figure coming up from under the bar: its head and chest on screen, its foot (and the sentence's own place) not.
    await scrollPictureTo(page, 'mirror', size.height - 400);
    await shot(page, `oi-105-2d-skirt-size-8-not-drawn-figure-low-${name}`);
    const result = await sweep(page, 'mirror', 'figure-not-drawn', 'estimate-badge');
    expect(result.looked).toBeGreaterThan(5);
    expect(result.wrong).toEqual([]);
    // The case the issue is about did happen on this screen: left where it is written, the sentence would not have been seen.
    expect(result.rideAt, 'the sentence never had to move: this screen does not test the case').not.toBeNull();
    await page.context().close();
  });

  test(`OI-105, 3D, ${name}: the sentence of a dress size that is not drawn is on screen with the 3D view and with the figure`, async ({ browser, baseURL }) => {
    test.skip(!existsSync(join(DRESS, 'base.glb')), `no dress bundle at ${DRESS}`);
    test.setTimeout(900_000);
    // The AU 16 chart body: AU 12 is two sizes too small at the bust.
    const body = { height: 168, weight: 82, bust: 105, waist: 87.5, hip: 114 };
    const garment = JSON.parse(readFileSync(join(DRESS, 'payload.json'), 'utf8')) as GarmentPayload & { productPhotos?: string[] };
    garment.productPhotos = [];
    expect(wearBlock(computeFit(garment, { measurements: body }), '12')).toMatchObject({ reason: 'tight', point: 'bust' });
    const page = await phone(browser, size);
    await instrument(page, new URL(baseURL!).origin, garment, DRESS);
    await aboutYou(page, baseURL!, body);
    await expect(page.getByTestId('embed-result')).toBeVisible();
    await page.getByTestId('garment3d-open').click();
    const canvas = page.getByTestId('garment3d-canvas');
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
    await page.getByTestId('garment3d').getByRole('radio', { name: '12', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-size', '12');
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
    await expect(canvas).toHaveAttribute('data-garment', 'not-drawn');
    await expect(page.getByTestId('garment3d-not-drawn')).toContainText('Size 12 is not drawn');
    await expect(page.getByTestId('figure-not-drawn')).toContainText('Size 12 is not drawn');
    await scrollPictureTo(page, 'garment3d', 8);
    await shot(page, `oi-105-3d-dress-size-12-not-drawn-${name}`);
    const in3d = await sweep(page, 'garment3d-canvas', 'garment3d-not-drawn', null);
    expect(in3d.looked).toBeGreaterThan(5);
    expect(in3d.wrong).toEqual([]);
    const in2d = await sweep(page, 'mirror', 'figure-not-drawn', 'estimate-badge');
    expect(in2d.looked).toBeGreaterThan(5);
    expect(in2d.wrong).toEqual([]);
    if (size.height <= 844) expect(in3d.rideAt, 'the 3D sentence never had to move: this screen does not test the case').not.toBeNull();
    await scrollPictureTo(page, 'mirror', 56);
    await shot(page, `oi-105-2d-dress-size-12-not-drawn-${name}`);
    await page.context().close();
  });
}

test('OI-104: the size-ring chips under the 3D view of a men\'s tee read "Chest", never "Bust"', async ({ browser, baseURL }) => {
  test.skip(!existsSync(join(TEE, 'base.glb')), `no men's tee bundle at ${TEE}`);
  test.setTimeout(600_000);
  const garment = JSON.parse(readFileSync(join(TEE, 'payload.json'), 'utf8')) as GarmentPayload & { productPhotos?: string[] };
  garment.productPhotos = [];
  expect(garment.audience).toBe('men');
  const page = await phone(browser, PHONES[1]);
  await instrument(page, new URL(baseURL!).origin, garment, TEE);
  await aboutYou(page, baseURL!, { height: 178, weight: 78, bust: 100, waist: 88, hip: 98 });
  const open = page.getByTestId('garment3d-open');
  const canvas = page.getByTestId('garment3d-canvas');
  await expect(open.or(canvas).first()).toBeVisible({ timeout: 60_000 });
  if (await open.count()) await open.click();
  await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 300_000 });
  const rings = page.getByTestId('garment3d-rings');
  await expect(rings).toBeVisible();
  const names = await rings.locator('li > span').allTextContents();
  await rings.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'oi-104-3d-mens-tee-ring-chips-390x844');
  expect(names).toContain('Chest');
  expect(names).not.toContain('Bust');
  await expect(rings).not.toContainText(/bust/i);
  // The fit list beside the 2D figure says the same word.
  await expect(page.getByTestId('fit-point-bust')).toContainText('Chest');
  await page.context().close();
});

test('OI-83: the female 2D figure has no hole, for a slim, a mid and a full body (the browser\'s own fill)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const garment = { ...PILOT_PULL_ON_SKIRT, productPhotos: [] } as GarmentPayload;
  const bodies = [
    { name: 'slim', height: 160, weight: 50, bust: 80, waist: 62, hip: 88 },
    { name: 'mid', height: 168, weight: 62, bust: 89, waist: 71.5, hip: 98 },
    { name: 'full', height: 176, weight: 98, bust: 112, waist: 98, hip: 120 },
  ];
  const holes: Record<string, number> = {};
  for (const body of bodies) {
    const page = await phone(browser, PHONES[1]);
    await instrument(page, new URL(baseURL!).origin, garment, null);
    await aboutYou(page, baseURL!, body);
    await expect(page.getByTestId('embed-result')).toBeVisible();
    const figure = page.getByTestId('mirror').first().getByTestId('figure-body');
    await expect(figure).toBeVisible();
    // Every point of a 1 px grid (in the figure's own units) that lies inside one of the path's parts must be filled.
    const found = await figure.evaluate((el) => {
      const path = el as unknown as SVGPathElement;
      const svg = path.ownerSVGElement!;
      const parts = (path.getAttribute('d') ?? '').split(/(?=M)/).map((d) => d.trim()).filter(Boolean);
      const probes = parts.map((d) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
        return p;
      });
      const box = path.getBBox();
      let holes = 0;
      let first: { x: number; y: number } | null = null;
      // Known and left alone (OI-134): the torso's smoothed outline crosses itself in a loop under half a pixel wide at
      // its lowest point, between the legs. Those few points are counted apart.
      const torso = probes[1]!.getBBox();
      const tip = { x: torso.x + torso.width / 2, y: torso.y + torso.height };
      let atTorsoTip = 0;
      for (let y = Math.floor(box.y); y <= box.y + box.height; y += 0.5) {
        for (let x = Math.floor(box.x); x <= box.x + box.width; x += 0.5) {
          const pt = new DOMPoint(x, y);
          if (probes.some((p) => p.isPointInFill(pt)) && !path.isPointInFill(pt)) {
            if (Math.abs(x - tip.x) <= 4 && Math.abs(y - tip.y) <= 4) {
              atTorsoTip++;
              continue;
            }
            holes++;
            first ??= { x, y };
          }
        }
      }
      probes.forEach((p) => p.remove());
      const m = path.getScreenCTM()!;
      return { holes, atTorsoTip, parts: parts.length, at: first ? { x: first.x * m.a + m.e, y: first.y * m.d + m.f } : null, scale: m.a };
    });
    expect(found.parts).toBe(6);
    expect(found.atTorsoTip, 'the loop at the torso\'s lowest point grew').toBeLessThanOrEqual(8);
    holes[body.name] = found.holes;
    // The figure at phone size, and its left armpit four times enlarged by the browser (nothing is redrawn by hand).
    await scrollPictureTo(page, 'mirror', 56);
    await shot(page, `oi-83-2d-female-figure-${body.name}-390x844`);
    if (SHOTS) {
      const armpit = await figure.evaluate((el) => {
        const path = el as unknown as SVGPathElement;
        const m = path.getScreenCTM()!;
        // the last subpath is the left arm, four corners: the armpit is where its top meets the torso (the corner furthest up and in)
        const arm = (path.getAttribute('d') ?? '').split(/(?=M)/).pop()!;
        const nums = arm.match(/-?\d+(\.\d+)?/g)!.map(Number);
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        const top = Math.min(...ys);
        return { x: Math.max(...xs.filter((_, i) => ys[i]! < top + 10)) * m.a + m.e, y: top * m.d + m.f };
      });
      await shot(page, `oi-83-2d-female-left-armpit-${body.name}`, { x: Math.max(0, armpit.x - 50), y: Math.max(0, armpit.y - 20), width: 100, height: 100 });
    }
    await page.context().close();
  }
  if (SHOTS) writeFileSync(join(SHOTS, `oi-83-unfilled-points--${TAG}.json`), `${JSON.stringify({ unfilledPointsInsideAPart: holes }, null, 2)}\n`);
  expect(holes).toEqual({ slim: 0, mid: 0, full: 0 });
});

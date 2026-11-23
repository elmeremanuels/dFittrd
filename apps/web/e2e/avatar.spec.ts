import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page, type Request } from '@playwright/test';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';

/**
 * The avatar prompt of the embed (DECISIONS.md D19, photo-avatar-plan slices 1 and 2), on the
 * production build at phone width (360 px):
 *   - from the tap on the avatar to the closed prompt, and through "Forget me" (the device is
 *     only in memory here, so that is local too), the page makes NO request of any kind;
 *   - the picked colour is on the figure, the figure keeps its estimate label and its neutral face;
 *   - keyboard: the prompt takes the focus, keeps it, and gives it back;
 *   - nothing overflows 360 px.
 * With AVATAR_SHOTS=<dir> it also writes the screenshots of the picker, the prompt and the men's
 * "coming soon" screen as a Dutch browser sees them (English, D21), and the figure at all ten tones.
 * A build made with VITE_AVATAR_FACE_PHOTO=1 and run with AVATAR_FACE_FLAG=1 runs the flag-on test
 * instead (the "coming soon" row can be reached by keyboard and does nothing).
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const SHOTS = process.env.AVATAR_SHOTS ?? null;
const VIEWPORT = { width: 360, height: 740 };
const FACE_FLAG = process.env.AVATAR_FACE_FLAG === '1';

interface Seen {
  url: string;
  method: string;
  contentType: string;
  bodyBytes: number;
  body: string | null;
}

async function instrument(page: Page, origin: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.route('**/*', async (route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    const buf = req.postDataBuffer();
    seen.push({ url: req.url(), method: req.method(), contentType: req.headers()['content-type'] ?? '', bodyBytes: buf ? buf.byteLength : 0, body: buf ? buf.toString('utf8') : null });
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/v1/')) {
      const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/v1/devices') return json(201, DEVICE);
      if (url.pathname === `/v1/try/${TOKEN}` && req.method() === 'GET')
        return json(200, {
          shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: false, brandColor: '#2F4F3A' },
          garment: MOCK_GARMENTS_BY_ID['aalter-studio-1'],
          trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'e2e-intent-token-0123456789' },
          pairing: { created: true, pairedAt: new Date().toISOString() },
          embed: { allowedOrigins: [] },
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      if (url.pathname === '/v1/me' && req.method() === 'DELETE') return json(200, { deleted: true, deviceId: DEVICE.deviceId });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
  return seen;
}

async function openResult(browser: Browser, baseURL: string, locale: string, viewport = VIEWPORT): Promise<{ page: Page; seen: Seen[]; close: () => Promise<void> }> {
  // No service worker: every request must pass the route handler above.
  const context = await browser.newContext({ viewport, locale, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const seen = await instrument(page, new URL(baseURL).origin);
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByTestId('see-my-size').click();
  await expect(page.getByTestId('embed-result')).toBeVisible();
  await expect(page.getByTestId('avatar-open')).toBeVisible();
  // fit-shown and the product photo are on their way by now; let them finish before counting.
  await page.waitForLoadState('networkidle');
  return { page, seen, close: () => context.close() };
}

const figureSkin = (page: Page): Promise<string | null> => page.locator('[data-testid="embed-result"] svg[data-skin]').first().getAttribute('data-skin');

async function shot(page: Page, name: string, locator?: Locator): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Let the garment layer's fade-in and the sheet settle.
  await page.waitForTimeout(500);
  if (locator) await locator.screenshot({ path: join(SHOTS, name) });
  else await page.screenshot({ path: join(SHOTS, name) });
}

async function expectNoOverflow(page: Page, at = VIEWPORT.width): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `horizontal overflow at ${at} px`).toBeLessThanOrEqual(at);
}

test('avatar prompt: picking a skin colour makes no request, at 360 px, and the figure stays an estimate', async ({ browser, baseURL }) => {
  test.skip(FACE_FLAG, 'this build has the face flag on');
  const { page, seen, close } = await openResult(browser, baseURL!, 'en-AU');
  const figure = page.locator('[data-testid="avatar-open"]').locator('..');
  await expectNoOverflow(page);
  expect(await figureSkin(page)).toBe('#DFC3A8');
  await expect(page.getByTestId('embed-result').getByTestId('neutral-face')).toHaveCount(1);
  // With the whole figure on screen the labels sit in a strip under it: they cover neither the face nor the feet or a hem.
  await page.getByTestId('avatar-open').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const head = (await page.getByTestId('embed-result').getByTestId('neutral-face').boundingBox())!;
  const drawn = (await page.locator('[data-testid="embed-result"] svg[data-skin]').first().boundingBox())!;
  for (const id of ['estimate-label', 'avatar-body-chip']) {
    const label = (await figure.getByTestId(id).boundingBox())!;
    expect(label.y, `${id} covers the face`).toBeGreaterThan(head.y + head.height);
    expect(label.y, `${id} covers the figure`).toBeGreaterThanOrEqual(drawn.y + drawn.height - 1);
  }
  await expect(figure.getByText('Estimate · not measured')).toBeVisible();
  // At phone height the chip that says the figure can be tapped is on screen, above the sticky bar.
  await page.getByRole('tab', { name: 'How it fits' }).scrollIntoViewIfNeeded();
  const chip = (await page.locator('[data-testid="avatar-open"] .chip').boundingBox())!;
  const bar = (await page.getByTestId('choose-size').boundingBox())!;
  expect(chip.y, 'the avatar chip is above the window').toBeGreaterThanOrEqual(0);
  expect(chip.y + chip.height, 'the avatar chip is under the sticky bar or below the fold').toBeLessThanOrEqual(Math.min(bar.y, VIEWPORT.height));
  await shot(page, 'result-360.png');
  // A taller window for the figure pictures, so the sticky "Choose size" bar is not across them.
  await page.setViewportSize({ width: VIEWPORT.width, height: 1100 });
  await page.getByTestId('avatar-open').scrollIntoViewIfNeeded();
  await shot(page, 'figure-standard-colour-neutral-face.png', figure);
  await page.setViewportSize(VIEWPORT);

  // ---- from here on: no request at all ---------------------------------------------------------
  const before = seen.length;
  const cameraAsked = await page.evaluate(() => {
    const w = window as unknown as { __cameraAsked: number };
    w.__cameraAsked = 0;
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => ((w.__cameraAsked += 1), Promise.reject(new Error('camera asked in the avatar flow')));
    return w.__cameraAsked;
  });
  expect(cameraAsked).toBe(0);

  await page.getByTestId('avatar-open').click();
  const dialog = page.getByRole('dialog', { name: 'Make the avatar look like you' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Make the avatar look like you' })).toBeFocused();
  await expect(dialog.getByText('You choose. Everything here is off until you switch it on.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Read the full privacy terms' })).toHaveAttribute('href', /\/privacy$/);
  // The photo-based face is behind its flag, which is off in this build.
  await expect(dialog.getByTestId('avatar-item-face')).toHaveCount(0);
  await expect(dialog.getByText(/Use my face|Coming soon/)).toHaveCount(0);
  await expectNoOverflow(page);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
  await shot(page, 'prompt-en.png');

  // The page behind the prompt cannot be reached.
  expect(await page.evaluate(() => document.querySelector('[data-testid="embed-footer"]')?.closest('[inert]') !== null)).toBe(true);

  const sw = dialog.getByRole('switch', { name: 'Match my skin tone' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(dialog.getByRole('radio')).toHaveCount(10);
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  expect(await figureSkin(page)).toBe('#DFC3A8');
  // Memory only in this build: no sentence about saving the colour. The swatches are credited.
  await expect(dialog.getByTestId('avatar-c30')).toHaveCount(0);
  await expect(dialog.getByText(/saved on this device/)).toHaveCount(0);
  await expect(dialog.getByTestId('avatar-swatch-credit')).toHaveText('Colours: Monk Skin Tone Scale by Dr. Ellis Monk, CC BY 4.0.');
  // The skin slider (CUR-28): track is at least the width of a finger (≥44 px), and the thumb is at least 24 px tall.
  const track = (await dialog.getByTestId('skin-slider-track').boundingBox())!;
  expect(track.width).toBeGreaterThanOrEqual(44);
  expect(track.height).toBeGreaterThanOrEqual(12);
  await shot(page, 'picker-open-nothing-picked.png');

  // Skin slider (CUR-28): set monk 6 (slider = 5/9).
  await dialog.getByTestId('skin-slider-input').evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(5 / 9));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await figureSkin(page)).toBe('#A07E56');
  await shot(page, 'picker-colour-6-picked.png');
  await expectNoOverflow(page);

  // Keyboard: arrows move the choice, Tab stays inside, Escape closes and focus returns to the avatar.
  await dialog.getByRole('radio', { name: 'Colour 6 of 10' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Colour 7 of 10' })).toBeChecked();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `Tab ${i + 1} left the dialog`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('avatar-open')).toBeFocused();
  expect(await figureSkin(page)).toBe('#825C43');

  // The figure: all ten tones, each with the face, the outline and the estimate label.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    await page.setViewportSize(VIEWPORT);
    await page.getByTestId('avatar-open').click();
    // Skin slider (CUR-28): set the slider to the monk's position.
    await page.getByTestId('skin-slider-input').evaluate((el, m) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, String((m - 1) / 9));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);
    await page.getByTestId('avatar-prompt-done').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(figure.getByText('Estimate · not measured')).toBeVisible();
    await expect(figure.getByTestId('neutral-face')).toHaveCount(1);
    await expect(figure.locator('svg image')).toHaveCount(0);
    await expect(figure.getByTestId('figure-body')).toHaveAttribute('stroke', /^#[0-9a-f]{6}$/i);
    await page.setViewportSize({ width: VIEWPORT.width, height: 1100 });
    await page.getByTestId('avatar-open').scrollIntoViewIfNeeded();
    await shot(page, `figure-tone-${n}.png`, figure);
  }
  await page.setViewportSize(VIEWPORT);
  await page.getByTestId('avatar-open').scrollIntoViewIfNeeded();
  await shot(page, 'result-360-tone-9.png');

  // Switch it off again: back to the standard colour.
  await page.getByTestId('avatar-open').click();
  await page.getByTestId('avatar-skin-switch').click();
  await expect(page.getByTestId('avatar-skin-state')).toHaveText('The avatar goes back to the standard colour. Your colour is deleted from this device.');
  expect(await figureSkin(page)).toBe('#DFC3A8');
  await page.getByTestId('avatar-skin-switch').click();
  // Skin slider (CUR-28): set monk 4 (slider = 3/9).
  await page.getByTestId('skin-slider-input').evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(3 / 9));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByTestId('avatar-prompt-close').click();

  const during = seen.slice(before);
  expect(during, `requests during the avatar flow: ${during.map((r) => `${r.method} ${r.url}`).join(', ')}`).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __cameraAsked: number }).__cameraAsked)).toBe(0);
  expect(await page.locator('input[type="file"], video').count()).toBe(0);

  // ---- the colour is in memory only: the device stores the profile, and nothing about the colour ----
  const rows = (): Promise<{ key: string; json: string }[]> =>
    page.evaluate(
      () =>
        new Promise<{ key: string; json: string }[]>((resolve, reject) => {
          const open = indexedDB.open('curtain-embed');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction('kv').objectStore('kv').getAll();
            all.onsuccess = () => {
              resolve((all.result as { key: string; value: unknown }[]).map((r) => ({ key: r.key, json: JSON.stringify(r.value) ?? '' })));
              open.result.close();
            };
            all.onerror = () => reject(all.error);
          };
        }),
    );
  // "Remember me" is on (the default): the profile row is there, so the store does write.
  await expect.poll(async () => (await rows()).map((r) => r.key)).toContain(`profile:${SHOP_ID}`);
  // Give a late write the time to land, then look: no look row, no key, no swatch in any row.
  await page.waitForTimeout(500);
  const stored = await rows();
  expect(stored.map((r) => r.key).filter((k) => /look/.test(k))).toEqual([]);
  for (const r of stored) expect(r.json, `row ${r.key}`).not.toMatch(/monk|picked|skin|F6EDE4|F3E7DB|F7EAD0|EADABA|D7BD96|A07E56|825C43|604134|3A312A|292420/i);
  expect(await page.evaluate(() => `${JSON.stringify({ ...localStorage })} ${JSON.stringify({ ...sessionStorage })} ${document.cookie}`)).not.toMatch(/monk|EADABA/i);

  await page.getByRole('button', { name: 'Forget me' }).click();
  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await expect.poll(async () => (await rows()).map((r) => r.key)).toEqual([]);

  // ---- nothing about the avatar ever left the page -----------------------------------------------
  for (const r of seen) {
    expect(new URL(r.url).origin, `third-party request ${r.url}`).toBe(new URL(baseURL!).origin);
    expect(r.contentType, `image or form upload: ${r.url}`).not.toMatch(/image\/|multipart\//);
    expect(r.bodyBytes, `large body: ${r.url}`).toBeLessThanOrEqual(8 * 1024);
    if (!new URL(r.url).pathname.startsWith('/v1/')) {
      expect(r.bodyBytes, `non-API request with a body: ${r.url}`).toBe(0);
      continue;
    }
    const text = `${new URL(r.url).search} ${r.body ?? ''}`;
    expect(text, `avatar data in ${r.method} ${r.url}`).not.toMatch(/skin|monk|look|colou?r|tone|data:image|F6EDE4|F3E7DB|F7EAD0|EADABA|D7BD96|A07E56|825C43|604134|3A312A|292420/i);
  }
  await close();
});

/**
 * AGENTS.md rule 3 at phone size: the sticky "Choose size" bar lies over the bottom of the window,
 * and the figure's estimate label has its place under the figure's feet. Wherever the page is
 * scrolled, as long as a strip of the figure is on screen, the label is on screen too: above the
 * bar, inside the frame on all four sides, and never over the face. Nothing of the figure's labels
 * is drawn over the bar. Run at 320, 360 and 600 px wide (the last is the two-column layout).
 *
 * What the riding label covers is measured, not hidden: it is as wide as its text, the figure fills
 * the frame, so on its way up it crosses the left arm and a wide hem. The sweep samples the label's
 * area against the drawn body and garment and holds the share to a limit; it never touches the feet.
 */
const SWEEP_SIZES = [
  { width: 320, height: 658 },
  { width: 360, height: 740 },
  { width: 600, height: 740 },
];
/** At most this share of the riding label may lie over the drawn body or garment (measured: see apps/web/README.md). */
const MAX_COVER = 0.45;

for (const size of SWEEP_SIZES) {
  test(`the figure's estimate label is on screen wherever the figure is, at ${size.width} x ${size.height}, without scrolling to it`, async ({ browser, baseURL }) => {
    test.skip(FACE_FLAG, 'this build has the face flag on');
    const { page, close } = await openResult(browser, baseURL!, 'en-AU', size);
    const at360 = size.width === VIEWPORT.width;
    const figure = page.locator('[data-testid="avatar-open"]').locator('..');
    const label = figure.getByTestId('estimate-label');
    await expect(label).toHaveText('Estimate · not measured');
    interface Box {
      top: number;
      bottom: number;
      left: number;
      right: number;
    }
    interface Measured {
      scrollY: number;
      max: number;
      windowHeight: number;
      frame: Box;
      track: Box;
      label: Box;
      chip: Box;
      face: Box;
      bar: Box;
      /** Shares of the label's area (a 16 x 8 grid of points) over the drawn garment, the bare body, and the feet. */
      cover: { garment: number; body: number; feet: number };
    }
    const measure = (): Promise<Measured> =>
      page.evaluate(() => {
        const box = (el: Element | null): { top: number; bottom: number; left: number; right: number } => {
          const r = el!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const root = document.querySelector('[data-testid="embed-result"]')!;
        const frame = root.querySelector('.mirror-frame')!;
        const labelEl = frame.querySelector('[data-testid="estimate-label"]')!;
        const svg = frame.querySelector<SVGSVGElement>('svg[data-skin]')!;
        const body = svg.querySelector<SVGPathElement>('[data-testid="figure-body"]')!;
        const garment = Array.from(svg.querySelectorAll<SVGPathElement>('[data-testid="garment-layer"] > g:first-child path'));
        const toSvg = svg.getScreenCTM()!.inverse();
        const bb = body.getBBox();
        const feetFrom = bb.y + bb.height * 0.93;
        const r = labelEl.getBoundingClientRect();
        const hits = { garment: 0, body: 0, feet: 0 };
        const COLS = 16;
        const ROWS = 8;
        for (let i = 0; i < COLS; i++)
          for (let j = 0; j < ROWS; j++) {
            const pt = new DOMPoint(r.left + ((i + 0.5) / COLS) * r.width, r.top + ((j + 0.5) / ROWS) * r.height).matrixTransform(toSvg);
            if (garment.some((g) => g.isPointInFill(pt))) hits.garment += 1;
            else if (body.isPointInFill(pt)) {
              hits.body += 1;
              if (pt.y >= feetFrom) hits.feet += 1;
            }
          }
        return {
          scrollY: window.scrollY,
          max: document.documentElement.scrollHeight - window.innerHeight,
          windowHeight: window.innerHeight,
          frame: box(frame),
          track: box(frame.querySelector('[data-testid="avatar-labels"]')),
          label: box(labelEl),
          chip: box(frame.querySelector('[data-testid="avatar-body-chip"]')),
          face: box(root.querySelector('[data-testid="neutral-face"]')),
          bar: box(root.querySelector('[data-testid="choose-bar"]')),
          cover: { garment: hits.garment / (COLS * ROWS), body: hits.body / (COLS * ROWS), feet: hits.feet / (COLS * ROWS) },
        };
      });
    /**
     * The label needs this much of the frame on screen: from the frame's top edge to the top of
     * the label's track (the frame's border and inset), the label's own height, and its gap to the
     * bar (0.375rem). With less of the frame on screen the label has no room inside it, so a strip
     * of the figure narrower than this can be on screen without the label (the known gap).
     */
    const GAP = 6;
    const start = await measure();
    const NEEDS = Math.ceil(start.track.top - start.frame.top + (start.label.bottom - start.label.top) + GAP);
    expect(NEEDS, 'the room the label needs grew').toBeLessThanOrEqual(58);
    const worst = { cover: 0, at: '' };
    const sweep = async (what: string): Promise<number> => {
      let checked = 0;
      const { max } = await measure();
      for (let y = 0; y <= max + 16; y += 16) {
        await page.evaluate((top) => window.scrollTo(0, top), Math.min(y, max));
        const m = await measure();
        const where = `${what}, scrolled to ${Math.round(m.scrollY)}`;
        const windowBottom = Math.min(m.bar.top, m.windowHeight);
        const onScreen = Math.min(m.frame.bottom, windowBottom) - Math.max(m.frame.top, 0);
        if (onScreen < NEEDS || m.frame.top > windowBottom - NEEDS) continue;
        checked += 1;
        expect(m.label.bottom, `${where}: the estimate label is behind the "Choose size" bar or below the window`).toBeLessThanOrEqual(windowBottom);
        expect(m.label.top, `${where}: the estimate label is above the window`).toBeGreaterThanOrEqual(0);
        expect(m.label.top, `${where}: the estimate label left the frame (top)`).toBeGreaterThanOrEqual(m.frame.top);
        expect(m.label.left, `${where}: the estimate label left the frame (left)`).toBeGreaterThanOrEqual(m.frame.left);
        expect(m.label.right, `${where}: the estimate label left the frame (right)`).toBeLessThanOrEqual(m.frame.right);
        expect(m.label.bottom, `${where}: the estimate label left the frame (bottom)`).toBeLessThanOrEqual(m.frame.bottom);
        const overFace = m.label.left < m.face.right && m.label.right > m.face.left && m.label.top < m.face.bottom && m.label.bottom > m.face.top;
        expect(overFace, `${where}: the estimate label covers the face`).toBe(false);
        expect(m.cover.feet, `${where}: the estimate label lies over a foot`).toBe(0);
        const cover = m.cover.garment + m.cover.body;
        if (cover > worst.cover) Object.assign(worst, { cover, at: `${where} (garment ${m.cover.garment.toFixed(2)}, body ${m.cover.body.toFixed(2)})` });
        expect(cover, `${where}: the estimate label covers too much of the figure`).toBeLessThanOrEqual(MAX_COVER);
      }
      return checked;
    };

    // As the result opens (nothing scrolled): where the head is on screen, so is the label, beside it.
    expect(start.scrollY).toBe(0);
    /** The "Choose size" button as it is drawn, without its round ends (what is behind them shows there). */
    const buttonShot = async (): Promise<Buffer> => {
      const b = (await page.getByTestId('choose-size').boundingBox())!;
      return page.screenshot({ clip: { x: Math.ceil(b.x + b.height / 2), y: Math.ceil(b.y), width: Math.floor(b.width - b.height), height: Math.floor(b.height) } });
    };
    const buttonAlone = await buttonShot();
    expect(start.chip.top >= start.bar.bottom || start.chip.bottom <= start.bar.top, 'the body chip is at the bar as the result opens: no clean picture of the button').toBe(true);
    if (start.frame.top < start.bar.top - NEEDS) {
      expect(start.label.bottom, 'as the result opens, the estimate label is behind the "Choose size" bar').toBeLessThanOrEqual(start.bar.top);
      await expect(label).toBeInViewport({ ratio: 1 });
    } else expect(at360, 'the figure is not on the first screen at all').toBe(false);
    if (at360) await shot(page, 'result-360-as-opened-estimate-label.png');

    expect(await sweep('result'), 'the sweep never saw the figure').toBeGreaterThan(20);

    // The whole figure on screen: the label is in its own strip, under the feet.
    await page.getByTestId('avatar-open').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const drawn = (await page.locator('[data-testid="embed-result"] svg[data-skin]').first().boundingBox())!;
    const whole = await measure();
    if (whole.frame.bottom <= whole.bar.top) expect((await label.boundingBox())!.y).toBeGreaterThanOrEqual(drawn.y + drawn.height - 1);
    await shot(page, `result-${size.width}-whole-figure-estimate-label.png`);

    // The body chip does not ride: scrolled so that its strip is behind the bar, the bar covers it.
    const chipAt = whole.scrollY + whole.chip.top;
    await page.evaluate((top) => window.scrollTo(0, top), Math.max(0, chipAt - (whole.bar.top + (whole.bar.bottom - whole.bar.top) / 2)));
    const behind = await measure();
    const button = (await page.getByTestId('choose-size').boundingBox())!;
    const lapsButton = behind.chip.bottom > button.y && behind.chip.top < button.y + button.height && behind.chip.right > button.x + button.height / 2 && behind.chip.left < button.x + button.width - button.height / 2;
    if (lapsButton) {
      // The button is opaque: its picture (without the round ends) is the one taken at the top of the page.
      expect((await buttonShot()).equals(buttonAlone), 'the body chip is drawn over the "Choose size" button').toBe(true);
      await shot(page, `result-${size.width}-body-chip-behind-the-bar.png`);
    } else expect(at360, 'at 360 x 740 the body chip never got behind the button: the check above did not run').toBe(false);

    // A darker figure, half scrolled: the label rides above the bar.
    await page.getByTestId('avatar-open').click();
    await page.getByTestId('avatar-skin-switch').click();
    // Skin slider (CUR-28): set monk 7 (slider = 6/9).
    await page.getByTestId('skin-slider-input').evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, String(6 / 9));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByTestId('avatar-prompt-done').click();
    await page.evaluate(() => window.scrollTo(0, 150));
    await shot(page, `result-${size.width}-half-scrolled-estimate-label.png`);

    // The bar grows when it has something to say (here: the size could not be handed to a shop page).
    const barBefore = (await measure()).bar;
    await page.getByTestId('choose-size').click();
    await expect(page.getByTestId('choose-fallback')).toBeVisible();
    await expect.poll(async () => (await measure()).bar.top).toBeLessThan(barBefore.top);
    expect(await sweep('with the taller bar'), 'the sweep never saw the figure').toBeGreaterThan(at360 ? 20 : 5);
    await page.evaluate(() => window.scrollTo(0, 150));
    await shot(page, `result-${size.width}-taller-bar-estimate-label.png`);
    await expectNoOverflow(page, size.width);
    console.log(`estimate label at ${size.width} x ${size.height}: needs ${NEEDS} px of frame; most of it over the figure: ${worst.cover.toFixed(2)} at ${worst.at}`);
    await close();
  });
}

test('D21: a Dutch browser (nl-NL) gets the avatar prompt in English, at 360 px', async ({ browser, baseURL }) => {
  test.skip(FACE_FLAG, 'this build has the face flag on');
  const { page, seen, close } = await openResult(browser, baseURL!, 'nl-NL');
  expect(await page.evaluate(() => navigator.language)).toBe('nl-NL');
  const before = seen.length;
  await expect(page.getByTestId('avatar-open')).toHaveText('Make the avatar look like you');
  await page.getByTestId('avatar-open').click();
  const dialog = page.getByRole('dialog', { name: 'Make the avatar look like you' });
  await expect(dialog).not.toHaveAttribute('lang', /.*/);
  await expect(dialog.getByText('You choose. Everything here is off until you switch it on.')).toBeVisible();
  await expect(dialog.getByText('The shop never sees your photo, your face or your body measurements.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Read the full privacy terms' })).toBeVisible();
  await expect(dialog.getByTestId('avatar-terms-lang')).toHaveCount(0);
  await expect(dialog).not.toContainText(/Jij kiest|avatar op jou|Sluiten|Klaar/);
  await expectNoOverflow(page);
  await shot(page, 'prompt-browser-nl-NL-shows-english.png');
  await dialog.getByRole('switch', { name: 'Match my skin tone' }).click();
  await expect(dialog.getByText('Pick a colour from the row.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Colour 8 of 10' }).check({ force: true });
  await expectNoOverflow(page);
  await shot(page, 'picker-browser-nl-NL-shows-english.png');
  await dialog.getByTestId('avatar-prompt-done').click();
  expect(seen.slice(before)).toEqual([]);
  await close();
});

test('D21: a Dutch browser (nl-NL) gets the men\'s "coming soon" screen in English, at 360 px', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'nl-NL', deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await instrument(page, new URL(baseURL!).origin);
  // Registered after instrument(), so it wins for this one path: the api's men's gate answer (D20 point 3).
  await page.route(`**/v1/try/${TOKEN}*`, (route) =>
    route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'men_coming_soon', message: 'Men’s clothing: coming soon' } }) }),
  );
  await page.goto(`${baseURL}/embed/${TOKEN}`);
  expect(await page.evaluate(() => navigator.language)).toBe('nl-NL');
  const blocked = page.getByTestId('blocked-comingSoon');
  await expect(blocked).toBeVisible();
  await expect(blocked.getByRole('heading', { name: 'Men’s clothing: coming soon' })).toBeVisible();
  await expect(blocked).toContainText('use the shop’s own size chart');
  await expect(blocked).not.toHaveAttribute('lang', /.*/);
  await expect(page.locator('body')).not.toContainText(/Herenkleding|binnenkort|maattabel|Terug naar/);
  await expectNoOverflow(page);
  await shot(page, 'coming-soon-browser-nl-NL-shows-english.png');
  await context.close();
});

test('face flag on: "Use my face" is a coming-soon row a keyboard reaches, and it does nothing', async ({ browser, baseURL }) => {
  test.skip(!FACE_FLAG, 'needs a build with VITE_AVATAR_FACE_PHOTO=1');
  for (const locale of ['en-AU', 'nl-NL']) {
    const { page, seen, close } = await openResult(browser, baseURL!, locale);
    const before = seen.length;
    await page.getByTestId('avatar-open').click();
    const dialog = page.getByRole('dialog');
    const sw = dialog.getByTestId('avatar-face-switch');
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    // Tab reaches it (a disabled button would be skipped).
    let reached = false;
    for (let i = 0; i < 4 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await sw.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab never reached the "Use my face" switch').toBe(true);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    // Playwright waits for an aria-disabled control to become enabled: tap it regardless.
    await sw.click({ force: true });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await page.locator('input[type="file"], video').count()).toBe(0);
    await expectNoOverflow(page);
    await shot(page, `prompt-face-flag-on-${locale.slice(0, 2)}.png`);
    expect(seen.slice(before)).toEqual([]);
    await close();
  }
});

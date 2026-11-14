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
 * With AVATAR_SHOTS=<dir> it also writes the screenshots of the picker, the prompt in English and
 * Dutch, and the figure at three tones.
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const SHOTS = process.env.AVATAR_SHOTS ?? null;
const VIEWPORT = { width: 360, height: 740 };

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

async function openResult(browser: Browser, baseURL: string, locale: string): Promise<{ page: Page; seen: Seen[]; close: () => Promise<void> }> {
  // No service worker: every request must pass the route handler above.
  const context = await browser.newContext({ viewport: VIEWPORT, locale, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
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

async function expectNoOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, 'horizontal overflow at 360 px').toBeLessThanOrEqual(VIEWPORT.width);
}

test('avatar prompt: picking a skin colour makes no request, at 360 px, and the figure stays an estimate', async ({ browser, baseURL }) => {
  const { page, seen, close } = await openResult(browser, baseURL!, 'en-AU');
  const figure = page.locator('[data-testid="avatar-open"]').locator('..');
  await expectNoOverflow(page);
  expect(await figureSkin(page)).toBe('#DFC3A8');
  await expect(page.getByTestId('embed-result').getByTestId('neutral-face')).toHaveCount(1);
  // The labels sit at the figure's foot, so the face is not covered.
  const head = (await page.getByTestId('embed-result').getByTestId('neutral-face').boundingBox())!;
  const labels = (await page.getByTestId('embed-result').getByTestId('avatar-labels').boundingBox())!;
  expect(labels.y, 'the estimate label covers the face').toBeGreaterThan(head.y + head.height);
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
  // Every swatch is a finger-sized target.
  for (const b of await dialog.locator('[data-testid="skin-swatches"] label').all()) {
    const r = (await b.boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, 'picker-open-nothing-picked.png');

  await dialog.getByRole('radio', { name: 'Colour 6 of 10' }).check({ force: true });
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

  // The figure: three tones, each with the face and the estimate label.
  for (const n of [2, 6, 9]) {
    await page.setViewportSize(VIEWPORT);
    await page.getByTestId('avatar-open').click();
    await page.getByTestId(`skin-swatch-${n}`).check({ force: true });
    await page.getByTestId('avatar-prompt-done').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(figure.getByText('Estimate · not measured')).toBeVisible();
    await expect(figure.getByTestId('neutral-face')).toHaveCount(1);
    await expect(figure.locator('svg image')).toHaveCount(0);
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
  await page.getByTestId('skin-swatch-4').check({ force: true });
  await page.getByTestId('avatar-prompt-close').click();

  const during = seen.slice(before);
  expect(during, `requests during the avatar flow: ${during.map((r) => `${r.method} ${r.url}`).join(', ')}`).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __cameraAsked: number }).__cameraAsked)).toBe(0);
  expect(await page.locator('input[type="file"], video').count()).toBe(0);

  // ---- the colour is stored encrypted on the device and "Forget me" removes it -----------------
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
  await expect.poll(async () => (await rows()).map((r) => r.key).sort()).toContain(`look:${SHOP_ID}`);
  const stored = await rows();
  // Neither the swatch nor its class is readable in any stored row.
  for (const r of stored) expect(r.json.toUpperCase(), `row ${r.key}`).not.toContain('EADABA');
  expect(stored.find((r) => r.key === `look:${SHOP_ID}`)!.json).not.toMatch(/monk|picked/);

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

test('avatar prompt in Dutch at 360 px', async ({ browser, baseURL }) => {
  const { page, seen, close } = await openResult(browser, baseURL!, 'nl-NL');
  const before = seen.length;
  await expect(page.getByTestId('avatar-open')).toHaveText('Laat de avatar op jou lijken');
  await page.getByTestId('avatar-open').click();
  const dialog = page.getByRole('dialog', { name: 'Laat de avatar op jou lijken' });
  await expect(dialog).toHaveAttribute('lang', 'nl');
  await expect(dialog.getByText('Jij kiest. Alles staat uit tot jij het aanzet.')).toBeVisible();
  await expect(dialog.getByText('De winkel ziet je foto, je gezicht en je lichaamsmaten nooit.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Lees de volledige privacyvoorwaarden' })).toBeVisible();
  await expectNoOverflow(page);
  await shot(page, 'prompt-nl.png');
  await dialog.getByRole('switch', { name: 'Mijn huidskleur' }).click();
  await expect(dialog.getByText('Kies een kleur uit de rij.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Kleur 8 van 10' }).check({ force: true });
  await expectNoOverflow(page);
  await shot(page, 'picker-nl-colour-8-picked.png');
  await dialog.getByTestId('avatar-prompt-done').click();
  expect(seen.slice(before)).toEqual([]);
  await close();
});

#!/usr/bin/env node
/**
 * Screenshots and timings of slices 4 and 5 (skin tone from a face photo, the shopper's own face
 * as a 2D tile), in the real embed of a build made with VITE_AVATAR_FACE_PHOTO=live, at phone size
 * (390 × 844 CSS px, deviceScaleFactor 2), for the three synthetic faces (Monk 2, 6 and 9 renders of
 * the mannequin head; not photos of anybody).
 *
 *   VITE_AVATAR_FACE_PHOTO=live pnpm exec vite build --outDir <dist>
 *   pnpm exec vite preview --outDir <dist> --port 4180 --strictPort &
 *   node scripts/face-2d-shots.mjs http://127.0.0.1:4180 ../../docs/screens/claude/face-2d-slice5
 *
 * Every request of the page goes through a route handler: anything off the page's origin is
 * aborted and counted, and so is any request with a body during the photo steps.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://127.0.0.1:4180';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });
const WEB = fileURLToPath(new URL('..', import.meta.url));
const FACES = join(WEB, 'e2e', 'fixtures', 'synthetic-faces');
const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const { MOCK_GARMENTS_BY_ID } = await import('@curtain/schema');

const PEOPLE = [
  { id: 'a', file: 'person-a.jpg', note: 'Monk 2 render' },
  { id: 'b', file: 'person-b.jpg', note: 'Monk 6 render' },
  { id: 'c', file: 'person-c.jpg', note: 'Monk 9 render' },
];

const browser = await chromium.launch();
const report = { base, when: new Date().toISOString(), people: [] };

async function open(context) {
  const page = await context.newPage();
  const origin = new URL(base).origin;
  const seen = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const buf = req.postDataBuffer();
    seen.push({ url: req.url(), method: req.method(), bodyBytes: buf ? buf.byteLength : 0, t: Date.now() });
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/v1/')) {
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
  await page.goto(`${base}/embed/${TOKEN}`);
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByTestId('see-my-size').click();
  await page.getByTestId('embed-result').waitFor();
  await page.waitForLoadState('networkidle');
  return { page, seen };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const dialog = (page) => page.getByTestId('avatar-prompt');

async function promptShot(page, name) {
  await settle(page);
  await page.screenshot({ path: join(out, name) });
}

async function figureShots(page, prefix) {
  await page.setViewportSize({ width: 390, height: 1150 });
  const fig = page.locator('[data-testid="avatar-open"]').locator('..');
  await fig.scrollIntoViewIfNeeded();
  await settle(page, 700);
  await fig.screenshot({ path: join(out, `${prefix}-figure.png`) });
  // Close-up of the head and the chip: the top of the figure frame.
  const box = await fig.boundingBox();
  await page.screenshot({ path: join(out, `${prefix}-head-closeup.png`), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(200, box.height) } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('avatar-open').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({ path: join(out, `${prefix}-phone.png`) });
}

async function choosePhoto(page, purpose, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(`${purpose}-photo-choose`).click();
  const t0 = Date.now();
  await (await chooser).setFiles(join(FACES, file));
  return t0;
}

for (const person of PEOPLE) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'en-AU' });
  const { page, seen } = await open(context);
  const p = person.id;
  const entry = { ...person };
  if (p === 'a') await figureShots(page, `0-standard`);

  // 1. The prompt, live rows, before anything is on.
  const flowStart = seen.length;
  await page.getByTestId('avatar-open').click();
  await dialog(page).waitFor();
  if (p === 'a') await promptShot(page, '1-prompt-live.png');

  // 2. "Use my face" on → the ask (C6, C7, C5, age box, yes / no).
  await page.getByTestId('avatar-face-switch').click();
  await page.getByTestId('face-photo-ask').scrollIntoViewIfNeeded();
  if (p === 'a') await promptShot(page, '2-face-ask.png');
  await page.getByTestId('face-photo-age').check();
  await page.getByTestId('face-photo-yes').click();
  if (p === 'a') await promptShot(page, '3-face-photo-buttons.png');

  // 3. The photo → the tile.
  const t0 = await choosePhoto(page, 'face', person.file);
  await page.getByTestId('face-photo-busy').waitFor({ timeout: 5000 }).catch(() => null);
  await page.getByTestId('face-photo-on').waitFor({ timeout: 120_000 });
  entry.faceMs = Date.now() - t0;
  await page.getByTestId('face-photo-on').scrollIntoViewIfNeeded();
  await promptShot(page, `${p}-4-face-on-prompt.png`);
  await page.getByTestId('face-photo-preview').screenshot({ path: join(out, `${p}-4-face-preview-closeup.png`) });

  // 4. Close: the face on the 2D figure, unmatched (the photo's own colour, de-lit).
  await page.getByTestId('avatar-prompt-done').click();
  await figureShots(page, `${p}-5-face-unmatched`);

  // 5. Skin tone from the photo: switch on, read it from my photo, the ask, the photo, the suggestion.
  await page.getByTestId('avatar-open').click();
  await dialog(page).waitFor();
  await page.getByTestId('avatar-skin-switch').click();
  await page.getByTestId('skin-photo-read').scrollIntoViewIfNeeded();
  if (p === 'a') await promptShot(page, '6-skin-offer.png');
  await page.getByTestId('skin-photo-read').click();
  await page.getByTestId('skin-photo-ask').scrollIntoViewIfNeeded();
  if (p === 'a') await promptShot(page, '7-skin-ask.png');
  await page.getByTestId('skin-photo-age').check();
  await page.getByTestId('skin-photo-yes').click();
  const t1 = await choosePhoto(page, 'skin', person.file);
  await page.getByTestId('skin-photo-suggestion').waitFor({ timeout: 120_000 });
  entry.skinMs = Date.now() - t1;
  entry.suggestion = Number((await page.getByTestId('skin-photo-suggestion').textContent()).match(/colour (\d+)/)[1]);
  entry.notices = await page.locator('[data-testid="skin-photo-notice"] [data-notice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-notice')));
  entry.figureSkinBeforeConfirm = await page.locator('[data-testid="embed-result"] svg[data-skin]').first().getAttribute('data-skin');
  await page.getByTestId('skin-swatches').scrollIntoViewIfNeeded();
  await promptShot(page, `${p}-8-skin-suggestion.png`);

  // 6. The shopper confirms the suggested swatch (G4: nothing is applied before this tap).
  await page.getByTestId(`skin-swatch-${entry.suggestion}`).check({ force: true });
  entry.figureSkinAfterConfirm = await page.locator('[data-testid="embed-result"] svg[data-skin]').first().getAttribute('data-skin');
  await promptShot(page, `${p}-9-skin-confirmed.png`);
  await page.getByTestId('avatar-prompt-done').click();
  await figureShots(page, `${p}-10-face-matched`);

  // 7. Remember my photo, then Delete my photo.
  await page.getByTestId('avatar-open').click();
  await page.getByTestId('face-photo-remember').scrollIntoViewIfNeeded();
  await page.getByTestId('face-photo-remember').click();
  if (p === 'b') await promptShot(page, '11-remember-on.png');
  await page.getByTestId('face-photo-delete').click();
  await page.getByTestId('face-moment').scrollIntoViewIfNeeded();
  if (p === 'b') await promptShot(page, '12-deleted.png');
  await page.getByTestId('avatar-prompt-done').click();

  const flow = seen.slice(flowStart);
  entry.requestsDuringFlow = flow.map((r) => `${r.method} ${new URL(r.url).pathname}${r.bodyBytes ? ` (${r.bodyBytes} B body)` : ''}`);
  entry.offOrigin = flow.filter((r) => new URL(r.url).origin !== new URL(base).origin).map((r) => r.url);
  entry.withBody = flow.filter((r) => r.bodyBytes > 0).map((r) => r.url);
  report.people.push(entry);
  await context.close();
}

writeFileSync(join(out, 'face-2d.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.people.map(({ id, faceMs, skinMs, suggestion, notices, offOrigin, withBody, figureSkinBeforeConfirm, figureSkinAfterConfirm }) => ({ id, faceMs, skinMs, suggestion, notices, offOrigin, withBody, figureSkinBeforeConfirm, figureSkinAfterConfirm })), null, 2));
await browser.close();

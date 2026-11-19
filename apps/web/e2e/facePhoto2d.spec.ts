import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';

/**
 * Slices 4 and 5 of the photo-avatar plan in the real embed (production build), framed in a shop
 * page, with the real scan worker and the real Face Landmarker on a synthetic face (a render of the
 * mannequin head, not a photo of anybody). Over the WHOLE flow (open the prompt, "Use my face",
 * the age box and the yes, the photo, the tile on the figure, "Match my skin tone", "Read it from
 * my photo", the suggestion, the confirmed swatch, "Remember my photo", "Delete my photo"):
 *   - in every frame, fetch, XMLHttpRequest, WebSocket (and send), navigator.sendBeacon,
 *     EventSource and RTCPeerConnection are trapped: none is called;
 *   - the shop page receives no postMessage from the embed;
 *   - at the network level (which sees the worker's own requests: its model download is seen), every
 *     request is a same-origin GET without a body, for a script chunk, the worker or a model file;
 *     no api call; the segmenter and the pose model are not fetched;
 *   - no file input exists before the yes;
 *   - the trap itself works (checked last, with a POST it must catch).
 *
 * Runs only on a build made with VITE_AVATAR_FACE_PHOTO=live and with FACE_PHOTO_LIVE=1 set, and
 * needs the models (`pnpm --filter @curtain/web models`):
 *   VITE_AVATAR_FACE_PHOTO=live pnpm exec vite build && FACE_PHOTO_LIVE=1 pnpm exec playwright test -c e2e/playwright.config.ts facePhoto2d --trace off
 * On a normal build it checks that the prompt has no live face row.
 */

const LIVE = process.env.FACE_PHOTO_LIVE === '1';
const WEB = fileURLToPath(new URL('..', import.meta.url));
const MODEL = join(WEB, 'public', 'models', 'face_landmarker.task');
const PHOTO = join(WEB, 'e2e', 'fixtures', 'synthetic-faces', 'person-b.jpg');
const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const ALLOWED_PATH = /^\/(assets\/[\w.-]+\.(js|css|woff2)|models\/[\w./-]+|favicon[\w.-]*|icons\/[\w.-]+)$/;

const TRAP = `(() => {
  const log = (window.__net = []);
  const note = (kind, detail) => log.push({ kind, detail: String(detail).slice(0, 200) });
  const f = window.fetch;
  window.fetch = function (input, init) { note('fetch', (init && init.method ? init.method + ' ' : '') + (input && input.url ? input.url : input)); return f.apply(this, arguments); };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { note('xhr.open', m + ' ' + u); return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { note('xhr.send', b == null ? 'empty' : typeof b); return send.apply(this, arguments); };
  const WS = window.WebSocket;
  window.WebSocket = function (u, p) { note('websocket', u); return new WS(u, p); };
  window.WebSocket.prototype = WS.prototype;
  const wsSend = WS.prototype.send;
  WS.prototype.send = function (d) { note('websocket.send', typeof d); return wsSend.apply(this, arguments); };
  if (navigator.sendBeacon) { const b = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (u, d) { note('sendBeacon', u); return b(u, d); }; }
  if (window.EventSource) { const ES = window.EventSource; window.EventSource = function (u, o) { note('eventsource', u); return new ES(u, o); }; }
  if (window.RTCPeerConnection) { const P = window.RTCPeerConnection; window.RTCPeerConnection = function (c) { note('rtc', 'new'); return new P(c); }; }
  if (window === window.top) {
    window.__fromEmbed = [];
    window.addEventListener('message', (e) => window.__fromEmbed.push({ origin: e.origin, data: JSON.stringify(e.data).slice(0, 300) }));
  }
})();`;

interface Seen {
  url: string;
  method: string;
  bodyBytes: number;
}

async function mockApi(context: BrowserContext, origin: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const buf = req.postDataBuffer();
    seen.push({ url: req.url(), method: req.method(), bodyBytes: buf ? buf.byteLength : 0 });
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === '/e2e-shop.html')
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0"><iframe src="/embed/${TOKEN}" style="border:0;width:100vw;height:100vh" allow="camera"></iframe></body>` });
    if (url.pathname.startsWith('/v1/')) {
      const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/v1/devices') return json(201, DEVICE);
      if (url.pathname === `/v1/try/${TOKEN}` && req.method() === 'GET')
        return json(200, {
          shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: false, brandColor: '#2F4F3A' },
          garment: MOCK_GARMENTS_BY_ID['aalter-studio-1'],
          trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'e2e-intent-token-0123456789' },
          pairing: { created: true, pairedAt: new Date().toISOString() },
          embed: { allowedOrigins: [origin] },
        });
      if (url.pathname === `/v1/try/${TOKEN}/fit-shown`) return json(200, { billed: true });
      return json(404, { error: { code: 'not_found', message: 'mock' } });
    }
    return route.continue();
  });
  return seen;
}

async function embedFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const frame = page.frames().find((f) => f.url().includes('/embed/'))!;
  return frame;
}

async function toResult(frame: Frame): Promise<void> {
  await frame.getByLabel(/^Height/).fill('168');
  await frame.getByLabel(/^Weight/).fill('62');
  await frame.getByTestId('see-my-size').click();
  await expect(frame.getByTestId('embed-result')).toBeVisible();
}

test.describe('face photo in 2D (slices 4 and 5, real worker)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the photo, the crop and the tile never leave the device, over the whole flow', async ({ browser, baseURL }) => {
    test.skip(!LIVE, 'needs a build with VITE_AVATAR_FACE_PHOTO=live and FACE_PHOTO_LIVE=1');
    test.skip(!existsSync(MODEL), 'models not fetched: run `pnpm --filter @curtain/web models`');
    const origin = new URL(baseURL!).origin;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'en-AU' });
    await context.addInitScript(TRAP);
    const seen = await mockApi(context, origin);
    const page = await context.newPage();
    await page.goto(`${baseURL}/e2e-shop.html`);
    const frame = await embedFrame(page);
    await toResult(frame);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // ---- from here on: the flow under test -----------------------------------------------------
    const before = seen.length;
    const netBefore = await frame.evaluate(() => (window as unknown as { __net: unknown[] }).__net.length);
    const topNetBefore = await page.evaluate(() => (window as unknown as { __net: unknown[] }).__net.length);
    const msgsBefore = await page.evaluate(() => (window as unknown as { __fromEmbed: unknown[] }).__fromEmbed.length);
    // The traps work: before the flow the embed did call fetch (the api) and post to the shop page (curtain:ready).
    expect(netBefore, 'the in-frame trap saw the api calls before the flow').toBeGreaterThan(0);
    expect(msgsBefore, 'the shop page saw curtain:ready before the flow').toBeGreaterThan(0);

    await frame.getByTestId('avatar-open').click();
    await expect(frame.getByTestId('avatar-item-face')).toHaveAttribute('data-live', '1');
    await expect(frame.locator('input[type=file]')).toHaveCount(0);
    await frame.getByTestId('avatar-face-switch').click();
    await expect(frame.getByText('We use a photo of your face to draw your face on the avatar.')).toBeVisible();
    await expect(frame.getByText('The photo stays on your device. It is never sent to us.')).toBeVisible();
    await frame.getByTestId('face-photo-age').check();
    await frame.getByTestId('face-photo-yes').click();
    await expect(frame.locator('input[type=file]')).toHaveCount(0);
    let chooser = page.waitForEvent('filechooser');
    await frame.getByTestId('face-photo-choose').click();
    await (await chooser).setFiles(PHOTO);
    await expect(frame.getByTestId('face-photo-on')).toBeVisible({ timeout: 180_000 });
    await expect(frame.locator('input[type=file]')).toHaveCount(0);

    await frame.getByTestId('avatar-skin-switch').click();
    await frame.getByTestId('skin-photo-read').click();
    await frame.getByTestId('skin-photo-age').check();
    await frame.getByTestId('skin-photo-yes').click();
    chooser = page.waitForEvent('filechooser');
    await frame.getByTestId('skin-photo-choose').click();
    await (await chooser).setFiles(PHOTO);
    const suggestion = frame.getByTestId('skin-photo-suggestion');
    await expect(suggestion).toBeVisible({ timeout: 180_000 });
    const monk = Number((await suggestion.textContent())!.match(/colour (\d+) of 10/)![1]);
    // The render is a Monk 6 face; the suggestion is a proposal and may be a neighbour.
    expect(Math.abs(monk - 6)).toBeLessThanOrEqual(1);
    const skin = () => frame.locator('[data-testid="embed-result"] svg[data-skin]').first().getAttribute('data-skin');
    expect(await skin()).toBe('#DFC3A8');
    await frame.getByTestId(`skin-swatch-${monk}`).check({ force: true });
    expect(await skin()).not.toBe('#DFC3A8');

    await frame.getByTestId('avatar-prompt-done').click();
    const result = frame.getByTestId('embed-result');
    await expect(result.getByTestId('face-tile')).toHaveCount(1);
    await expect(result.getByTestId('face-chip')).toBeVisible();
    await expect(result.getByTestId('face-label')).toHaveText('Your face on an estimated body');
    await expect(result.getByTestId('estimate-label').first()).toBeVisible();
    // The tile is a blob: URL of the embed's own page.
    expect(await result.locator('[data-testid="face-tile"] image').getAttribute('href')).toMatch(new RegExp(`^blob:${origin.replace(/[.]/g, '\\.')}/`));
    // The hero render's figure (if mounted) has no face and no image.
    expect(await frame.locator('[data-testid="hero-avatar"] image').count()).toBe(0);

    await frame.getByTestId('avatar-open').click();
    await frame.getByTestId('face-photo-remember').click();
    await expect(frame.getByTestId('face-photo-remember')).toHaveAttribute('aria-checked', 'true');
    await frame.getByTestId('face-photo-delete').click();
    await expect(frame.getByTestId('face-moment')).toHaveText('Your face is taken off the avatar and deleted from this device.');
    await frame.getByTestId('avatar-prompt-done').click();
    await expect(result.getByTestId('face-tile')).toHaveCount(0);
    await expect(result.getByTestId('neutral-face')).toHaveCount(1);
    // Nothing of the face is left in the embed's database.
    const keys = await frame.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const r = indexedDB.open('curtain-embed');
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readonly');
            const q = tx.objectStore('kv').getAllKeys();
            q.onsuccess = () => resolve((q.result as IDBValidKey[]).map(String));
          };
          r.onerror = () => resolve([]);
        }),
    );
    expect(keys.filter((k) => k.startsWith('face'))).toEqual([]);

    // ---- what went out ---------------------------------------------------------------------------
    const net = await frame.evaluate(() => (window as unknown as { __net: { kind: string; detail: string }[] }).__net);
    expect(net.slice(netBefore), 'fetch / XHR / WebSocket / sendBeacon / EventSource / RTC in the embed during the flow').toEqual([]);
    const topNet = await page.evaluate(() => (window as unknown as { __net: { kind: string }[] }).__net);
    expect(topNet.slice(topNetBefore)).toEqual([]);
    const msgs = await page.evaluate(() => (window as unknown as { __fromEmbed: { data: string }[] }).__fromEmbed);
    expect(msgs.slice(msgsBefore), 'postMessage from the embed to the shop page during the flow').toEqual([]);
    const flow = seen.slice(before);
    for (const r of flow) {
      const u = new URL(r.url);
      expect(u.origin, r.url).toBe(origin);
      expect(r.method, r.url).toBe('GET');
      expect(r.bodyBytes, r.url).toBe(0);
      expect(u.pathname, r.url).toMatch(ALLOWED_PATH);
      expect(u.search, r.url).toBe('');
    }
    // The network listener sees the worker's requests: its model download is in the flow.
    expect(flow.some((r) => new URL(r.url).pathname === '/models/face_landmarker.task')).toBe(true);
    expect(flow.some((r) => /selfie_multiclass|pose_landmarker/.test(r.url))).toBe(false);

    // Self-test of the trap: a POST from the embed must show up in both logs.
    await frame.evaluate(() => fetch('/trap-self-test', { method: 'POST', body: 'x' }).catch(() => null));
    await expect.poll(() => seen.some((r) => r.method === 'POST' && r.url.endsWith('/trap-self-test'))).toBe(true);
    expect((await frame.evaluate(() => (window as unknown as { __net: { kind: string }[] }).__net)).slice(netBefore).map((e) => e.kind)).toEqual(['fetch']);
    await context.close();
  });

  test('a normal build has no live face row and no way to pick a photo', async ({ browser, baseURL }) => {
    test.skip(LIVE, 'this build has the live face rows');
    const origin = new URL(baseURL!).origin;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'en-AU' });
    await mockApi(context, origin);
    const page = await context.newPage();
    await page.goto(`${baseURL}/e2e-shop.html`);
    const frame = await embedFrame(page);
    await toResult(frame);
    await frame.getByTestId('avatar-open').click();
    await expect(frame.getByTestId('avatar-prompt')).toBeVisible();
    await expect(frame.locator('[data-testid="avatar-item-face"][data-live]')).toHaveCount(0);
    await frame.getByTestId('avatar-skin-switch').click();
    await expect(frame.getByTestId('skin-photo-read')).toHaveCount(0);
    await expect(frame.locator('input[type=file]')).toHaveCount(0);
    await context.close();
  });
});

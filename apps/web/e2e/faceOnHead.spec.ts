import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Slice 6 spike (face on the 3D head, on the device): over the WHOLE flow of the dev harness
 * (`dev/face-on-head.html`: open the prompt, pick a swatch, switch "Use my face" on, say yes,
 * choose a picture, the worker loads its model and bakes, the face is drawn, the face is switched
 * off again), nothing carries the photo, a crop, the landmarks or the texture off the page:
 *   - fetch, XMLHttpRequest, WebSocket, navigator.sendBeacon, EventSource and RTCPeerConnection are
 *     trapped in the page: none of them is called during the flow (Vite's dev client opens one
 *     WebSocket at page load, before the flow; no frame may be sent on any socket during it);
 *   - at the network level (which also sees the scan worker's own requests: its model downloads
 *     are seen here, which proves it), every request is a same-origin GET or HEAD without a body,
 *     for a module, a font or a model file; no WebSocket is opened;
 *   - the trap itself works (checked last, with a POST it must catch).
 * And with the flag off (a normal build), the face row is not there at all.
 *
 * The harness runs on its own Vite dev servers (no HMR), not on the production
 * preview the other specs use. The test faces are the synthetic renders of
 * `e2e/fixtures/synthetic-faces/` (the mannequin's own head, painted; not photos of anybody).
 * Skipped with a note when the models are not fetched (`pnpm --filter @curtain/web models`).
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const MODEL = join(WEB, 'public', 'models', 'face_landmarker.task');
const PHOTO = join(WEB, 'e2e', 'fixtures', 'synthetic-faces', 'person-b.jpg');
const ALLOWED_PATH = /^\/(models\/|src\/|node_modules\/|@vite\/|@id\/|@fs\/|@react-refresh|dev\/face-on-head\.html|favicon|icons\/)/;

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
})();`;

interface Seen {
  url: string;
  method: string;
  bodyBytes: number;
  resourceType: string;
}

async function harnessServer(flag: '0' | '1', port: number): Promise<ViteDevServer> {
  process.env.VITE_AVATAR_FACE_ON_HEAD = flag;
  const server = await createServer({ root: WEB, configFile: join(WEB, 'vite.config.ts'), logLevel: 'warn', server: { port, strictPort: false, hmr: false } });
  await server.listen();
  return server;
}

const baseOf = (s: ViteDevServer): string => s.resolvedUrls!.local[0]!.replace(/\/$/, '');

function watch(page: Page): { seen: Seen[]; sockets: string[]; frames: string[] } {
  const seen: Seen[] = [];
  const sockets: string[] = [];
  const frames: string[] = [];
  page.context().on('request', (req: Request) => {
    const buf = req.postDataBuffer();
    seen.push({ url: req.url(), method: req.method(), bodyBytes: buf ? buf.byteLength : 0, resourceType: req.resourceType() });
  });
  page.on('websocket', (ws) => {
    sockets.push(ws.url());
    ws.on('framesent', (f) => frames.push(`${ws.url()}: ${typeof f.payload === 'string' ? f.payload.slice(0, 80) : `${f.payload.byteLength} bytes`}`));
  });
  return { seen, sockets, frames };
}

test.describe('face on the 3D head (slice 6 spike, dev harness)', () => {
  test.skip(!existsSync(MODEL), 'models not fetched: run `pnpm --filter @curtain/web models`');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('the photo, the landmarks and the texture never leave the page', async ({ browser }) => {
    const server = await harnessServer('1', 5197);
    try {
      const base = baseOf(server);
      const origin = new URL(base).origin;
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.addInitScript(TRAP);
      const { seen, sockets, frames } = watch(page);
      await page.goto(`${base}/dev/face-on-head.html?prompt=1`);
      await expect(page.getByTestId('harness')).toHaveAttribute('data-flag', 'on');
      await page.waitForFunction(() => (window as unknown as { faceSpike: { ready: boolean } }).faceSpike.ready, null, { timeout: 120_000 });
      // The page is loaded: from here on is the flow under test. (Vite's dev client opens its own WebSocket at page
      // load, even without HMR; it is a dev-server artefact, opened before the flow, and the flow must send nothing on it.)
      // Wait until the Vite client's socket is reported at the network level too, so it is counted before the flow.
      const pageSockets = await page.evaluate(() => (window as unknown as { __net: { kind: string }[] }).__net.filter((e) => e.kind === 'websocket').length);
      await expect.poll(() => sockets.length).toBe(pageSockets);
      const before = seen.length;
      const netBefore = await page.evaluate(() => (window as unknown as { __net: unknown[] }).__net.length);
      const socketsBefore = sockets.length;
      const framesBefore = frames.length;
      await page.getByTestId('avatar-skin-switch').click();
      // Skin slider (CUR-28): set monk 6 (slider = 5/9).
      await page.getByTestId('skin-slider-input').evaluate((el) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, String(5 / 9));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Nothing that can read a file exists before the yes.
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      await page.getByTestId('avatar-face-switch').click();
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('avatar-face-yes').click();
      await (await chooser).setFiles(PHOTO);
      await page.waitForFunction(() => (window as unknown as { faceSpike: { viewHasFace: () => boolean } }).faceSpike.viewHasFace(), null, { timeout: 240_000 });
      await expect(page.getByTestId('face-label')).toHaveText('Your face on an estimated body');
      await expect(page.getByTestId('estimate-label')).toBeVisible();
      const textureBytes = await page.evaluate(() => (window as unknown as { faceSpike: { textureBytes: number } }).faceSpike.textureBytes);
      expect(textureBytes).toBe(512 * 512 * 4);
      // Switch the face off again: it is taken off the avatar (C9).
      await page.getByTestId('avatar-face-switch').click();
      await expect(page.getByText('Your face is taken off the avatar and deleted from this device.')).toBeVisible();
      await page.waitForFunction(() => !(window as unknown as { faceSpike: { viewHasFace: () => boolean } }).faceSpike.viewHasFace());

      const net = await page.evaluate(() => (window as unknown as { __net: { kind: string; detail: string }[] }).__net);
      expect(net.slice(0, netBefore).every((e) => e.kind === 'websocket' && /^ws:\/\/(localhost|127\.0\.0\.1):\d+\/\?token=/.test(e.detail)), 'only the Vite client before the flow').toBe(true);
      expect(net.slice(netBefore), 'fetch / XHR / WebSocket / sendBeacon / EventSource / RTC in the page during the flow').toEqual([]);
      // Only Vite dev-client sockets (the module worker's own dev client opens one when the worker starts); nothing is sent on them.
      for (const u of sockets.slice(socketsBefore)) expect(u, 'WebSockets opened during the flow').toMatch(new RegExp(`^ws://(localhost|127\\.0\\.0\\.1):${new URL(base).port}/\\?token=[\\w-]+$`));
      expect(frames.slice(framesBefore), 'WebSocket frames sent during the flow').toEqual([]);
      const flow = seen.slice(before);
      for (const r of flow) {
        const u = new URL(r.url);
        expect(u.origin, r.url).toBe(origin);
        expect(['GET', 'HEAD'], `${r.method} ${r.url}`).toContain(r.method);
        expect(r.bodyBytes, r.url).toBe(0);
        expect(u.pathname, r.url).toMatch(ALLOWED_PATH);
        expect(u.search.length, `${r.url}: no query beyond Vite's own`).toBeLessThan(64);
      }
      // The network listener sees the worker's requests: its model downloads are in the flow.
      expect(flow.some((r) => new URL(r.url).pathname === '/models/face_landmarker.task')).toBe(true);
      expect(flow.some((r) => /\/models\/wasm\/vision_wasm_module_internal\.wasm$/.test(new URL(r.url).pathname))).toBe(true);
      // No segmenter and no pose model are downloaded for the face.
      expect(flow.some((r) => /selfie_multiclass|pose_landmarker/.test(r.url))).toBe(false);

      // Self-test of the trap: a POST must show up in both logs.
      await page.evaluate(() => fetch('/trap-self-test', { method: 'POST', body: 'x' }).catch(() => null));
      await expect.poll(() => seen.some((r) => r.method === 'POST' && r.url.endsWith('/trap-self-test'))).toBe(true);
      expect((await page.evaluate(() => (window as unknown as { __net: { kind: string }[] }).__net)).slice(netBefore).map((e) => e.kind)).toEqual(['fetch']);
      await context.close();
    } finally {
      await server.close();
    }
  });

  test('with the flag off the face row is not there (as in a normal build)', async ({ browser }) => {
    const server = await harnessServer('0', 5198);
    try {
      const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
      await page.goto(`${baseOf(server)}/dev/face-on-head.html?prompt=1`);
      await expect(page.getByTestId('harness')).toHaveAttribute('data-flag', 'off');
      await expect(page.getByTestId('avatar-prompt')).toBeVisible();
      await expect(page.getByTestId('avatar-item-face')).toHaveCount(0);
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      await page.close();
    } finally {
      await server.close();
    }
  });
});

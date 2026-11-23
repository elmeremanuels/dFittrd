import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * D3 privacy guarantee for the realistic body spike (OI-145, OI-150): when VITE_VIEWER_BODY=realistic-spike
 * is on, the embed adds exactly one request: a GET of the static .crb file under /assets/, same origin,
 * no credentials, no referrer, no body. No measurement, photo, device id or hair choice leaves the page.
 * The .crb.br and .crb.gz files exist in the build and decompress to the exact .crb bytes.
 *
 * This spec runs only when the build has VITE_VIEWER_BODY=realistic-spike; it skips otherwise so the
 * normal pnpm check stays as it is.
 */

const TOKEN = 'e2e-try-token-0123456789abcdef';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const BUNDLE = fileURLToPath(new URL('../../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt', import.meta.url));
const ASSET_PATH = `/assets/${SHOP_ID}/skirt/0123456789abcdef`;
const BUNDLE_FILES = ['anchors.json', 'grading.json', 'material.json', 'qa.json', 'base.glb'];
const MAX_BODY_BYTES = 8 * 1024;

interface Seen {
  url: string;
  method: string;
  contentType: string;
  bodyBytes: number;
  body: string | null;
  resourceType: string;
  headers: Record<string, string>;
}

async function instrument(page: Page, origin: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  if (!existsSync(join(BUNDLE, 'base.glb'))) return seen;
  const garment = JSON.parse(readFileSync(join(BUNDLE, 'payload.json'), 'utf8')) as { productPhotos?: string[] };
  const grading = JSON.parse(readFileSync(join(BUNDLE, 'grading.json'), 'utf8')) as { baseSize: string; sizes: { size: string }[] };
  garment.productPhotos = [];
  await page.route('**/*', async (route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    const buf = req.postDataBuffer();
    seen.push({
      url: req.url(),
      method: req.method(),
      contentType: req.headers()['content-type'] ?? '',
      bodyBytes: buf ? buf.byteLength : 0,
      body: buf ? buf.toString('utf8') : null,
      resourceType: req.resourceType(),
      headers: req.headers(),
    });
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
          shop: { id: SHOP_ID, name: 'Test Shop', platform: 'shopify', paused: false, brandColor: '#2F4F3A' },
          garment,
          trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'e2e-intent-token' },
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

test.describe('realistic body privacy', () => {
  test.skip(() => process.env.VITE_VIEWER_BODY !== 'realistic-spike', 'skipped: build without VITE_VIEWER_BODY=realistic-spike');
  test.skip(!existsSync(join(BUNDLE, 'base.glb')), `no skirt bundle at ${BUNDLE} (git-ignored; set E2E_SKIRT_BUNDLE)`);

  test('adds exactly one request: GET of .crb under /assets/, no credentials, no referrer, no body data', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.request.get('/__csp-report');
    const seen = await instrument(page, origin);

    await page.goto(`${baseURL}/embed/${TOKEN}`);
    await page.getByLabel(/^Height/).fill('168');
    await page.getByLabel(/^Weight/).fill('62');
    await page.getByTestId('see-my-size').click();
    await expect(page.getByTestId('embed-result')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Open the 3D view which triggers the realistic body load
    await page.getByTestId('garment3d-open').click();
    const canvas = page.getByTestId('garment3d-canvas');
    await expect(canvas).toHaveAttribute('data-state', 'settled', { timeout: 150_000 });

    // Wait for any additional requests to complete
    await page.waitForTimeout(2000);

    // Find all .crb requests
    const crbRequests = seen.filter((r) => /\.crb(\.br|\.gz)?$/.test(r.url) && r.url.endsWith('.crb'));
    expect(crbRequests, `expected exactly 1 .crb request, found ${crbRequests.length}: ${crbRequests.map((r) => r.url).join(', ')}`).toHaveLength(1);

    const crbReq = crbRequests[0]!;
    const crbUrl = new URL(crbReq.url);

    // Same origin
    expect(crbUrl.origin, 'crb must be same origin').toBe(origin);

    // Under /assets/
    expect(crbUrl.pathname, 'crb must be under /assets/').toMatch(/^\/assets\/.*\.crb$/);

    // GET method
    expect(crbReq.method, 'crb must be GET').toBe('GET');

    // No request body
    expect(crbReq.bodyBytes, 'crb must have no request body').toBe(0);

    // No Cookie header
    expect(crbReq.headers['cookie'], 'crb must have no Cookie header').toBeFalsy();

    // No Authorization header
    expect(crbReq.headers['authorization'], 'crb must have no Authorization header').toBeFalsy();

    // Privacy assertions on ALL requests
    for (const r of seen) {
      const url = new URL(r.url);

      // No image MIME type
      expect(r.contentType, `image MIME on ${r.url}`).not.toMatch(/image\/|multipart\//);

      // No large body (would indicate a frame or photo)
      expect(r.bodyBytes, `body too large on ${r.url} (${r.bodyBytes} bytes)`).toBeLessThanOrEqual(MAX_BODY_BYTES);

      // No body data in request body
      if (r.body) {
        expect(r.body, `data URL in ${r.url}`).not.toMatch(/data:image\//);
        expect(r.body, `measurement field name in ${r.url}`).not.toMatch(/"(bust|waist|hip|height|weight|measurements|faceTile|baseFrame|hairChoice)"/);
      }

      // No body data in URL
      expect(r.url, `body data in URL ${r.url}`).not.toMatch(/[?&](bust|waist|hip|height|measurements|faceTile|baseFrame|hairChoice)=/);

      // API calls stay JSON
      if (url.pathname.startsWith('/v1/') && r.bodyBytes > 0) {
        expect(r.contentType, `non-JSON API call ${r.url}`).toMatch(/^application\/json/);
      }
    }

    // No third-party requests
    const thirdParty = seen.filter((r) => new URL(r.url).origin !== origin);
    expect(thirdParty, `third-party requests: ${thirdParty.map((r) => r.url).join(', ')}`).toEqual([]);

    // No CSP violations
    const reports = (await (await page.request.get('/__csp-report')).json()) as { 'csp-report'?: Record<string, string> }[];
    expect(reports.map((r) => `${r['csp-report']?.['effective-directive']} ${r['csp-report']?.['blocked-uri']}`), 'CSP violations').toEqual([]);
  });

  test('precompressed .crb.br and .crb.gz exist in build and decompress to exact .crb bytes', async ({ baseURL }) => {
    const origin = new URL(baseURL!).origin;

    // Find the .crb file in /assets/
    const assetDir = fileURLToPath(new URL('../dist/assets', import.meta.url));
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(assetDir);
    const crbFile = files.find((f: string) => f.endsWith('.crb'));
    expect(crbFile, '.crb file must exist in dist/assets').toBeTruthy();

    const crbPath = `/assets/${crbFile}`;
    const brPath = `${crbPath}.br`;
    const gzPath = `${crbPath}.gz`;

    // Fetch the .crb file
    const crbRes = await fetch(`${origin}${crbPath}`);
    expect(crbRes.ok, '.crb file must exist').toBe(true);
    const crbBytes = new Uint8Array(await crbRes.arrayBuffer());
    const crbSize = crbBytes.length;
    expect(crbSize).toBeGreaterThan(0);

    // Fetch .crb.br (brotli)
    const brRes = await fetch(`${origin}${brPath}`);
    expect(brRes.ok, '.crb.br file must exist in build').toBe(true);
    const brBytes = new Uint8Array(await brRes.arrayBuffer());
    const brSize = brBytes.length;
    expect(brSize).toBeGreaterThan(0);
    expect(brSize).toBeLessThan(crbSize);

    // Fetch .crb.gz (gzip)
    const gzRes = await fetch(`${origin}${gzPath}`);
    expect(gzRes.ok, '.crb.gz file must exist in build').toBe(true);
    const gzBytes = new Uint8Array(await gzRes.arrayBuffer());
    const gzSize = gzBytes.length;
    expect(gzSize).toBeGreaterThan(0);
    expect(gzSize).toBeLessThan(crbSize);

    // Decompress and verify using Node.js zlib (running in Node context)
    const { brotliDecompressSync, gunzipSync } = await import('node:zlib');

    const brDecompressed = brotliDecompressSync(brBytes);
    expect(brDecompressed.length, 'brotli decompresses to exact .crb size').toBe(crbSize);
    expect(Buffer.compare(brDecompressed, Buffer.from(crbBytes)), 'brotli decompresses to exact .crb bytes').toBe(0);

    const gzDecompressed = gunzipSync(gzBytes);
    expect(gzDecompressed.length, 'gzip decompresses to exact .crb size').toBe(crbSize);
    expect(Buffer.compare(gzDecompressed, Buffer.from(crbBytes)), 'gzip decompresses to exact .crb bytes').toBe(0);

    // Log sizes for the report
    console.log(`CRB sizes: raw=${crbSize} bytes, brotli=${brSize} bytes (${Math.round((1 - brSize / crbSize) * 100)}% reduction), gzip=${gzSize} bytes (${Math.round((1 - gzSize / crbSize) * 100)}% reduction)`);
  });
});

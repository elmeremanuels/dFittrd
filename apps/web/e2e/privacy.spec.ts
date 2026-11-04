import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * D3 privacy guarantee, provable in CI: run onboarding with a fake camera and assert that
 *   - every request is same-origin (fonts, models, bundle) or a `/v1/*` JSON call (mocked here);
 *   - no request carries an image MIME type or multipart body;
 *   - no request body exceeds 8 KB (an 80-float signature is < 1 KB; a frame would be far larger);
 *   - no third-party host is contacted at all.
 */

const MAX_BODY_BYTES = 8 * 1024;
const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };

interface Seen {
  url: string;
  method: string;
  contentType: string;
  bodyBytes: number;
  body: string | null;
  resourceType: string;
}

async function instrument(page: Page, origin: string): Promise<Seen[]> {
  const seen: Seen[] = [];
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
    });
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/v1/')) {
      if (url.pathname === '/v1/devices') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(DEVICE) });
      if (url.pathname === '/v1/me/signature') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString(), ledgerEntryId: '22222222-2222-4222-8222-222222222222' }) });
      if (url.pathname === '/v1/swipes') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: 1, duplicates: 0, usageEventsCreated: 0, ledgerEntryId: '33333333-3333-4333-8333-333333333333' }) });
      if (url.pathname.startsWith('/v1/wardrobe/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ productId: 'x', shopId: '00000000-0000-4000-8000-000000000001', size: 'M', state: 'saved', updatedAt: new Date().toISOString() }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'mock' } }) });
    }
    return route.continue();
  });
  return seen;
}

test('onboarding with a camera never lets a photo, a frame or a third-party request leave the page', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const seen = await instrument(page, origin);

  await page.goto('/onboarding');
  await expect(page.getByRole('heading', { name: /Welcome to Paskamer/ })).toBeVisible();
  await page.getByRole('button', { name: /Next/ }).click();

  // measurements: number inputs with labels, required height, foot size, measuring method
  const height = page.getByRole('spinbutton', { name: /^Height/ });
  await expect(height).toBeVisible();
  await height.fill('168');
  await page.getByRole('spinbutton', { name: /^Bust/ }).fill('88');
  await page.getByRole('spinbutton', { name: /^Waist/ }).fill('70');
  await page.getByRole('spinbutton', { name: /^Hip/ }).fill('96');
  await page.getByRole('radio', { name: /tape/i }).click();
  await page.getByRole('button', { name: /Next/ }).click();

  // vibes
  const minimal = page.getByRole('button', { name: 'Minimal' });
  await minimal.click();
  await expect(minimal).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Next/ }).click();

  // capture step: the fake camera is detected; the models are not shipped in CI, so the step
  // falls back to manual entry (models load from /models/* on the same origin).
  const start = page.getByRole('button', { name: /Start with a photo|Enter measurements/ });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  const label = await start.textContent();
  await start.click();
  if (/Start with a photo/.test(label ?? '')) {
    // face stage: take the photo if the camera path is live, otherwise skip it
    const faceSkip = page.getByRole('button', { name: /Skip|Continue without/i }).first();
    await faceSkip.click({ timeout: 30_000 }).catch(() => undefined);
    const bodySkip = page.getByRole('button', { name: /Skip|measurements only/i }).first();
    await bodySkip.click({ timeout: 30_000 }).catch(() => undefined);
  }
  await expect(page.getByRole('heading', { name: /Your measurements/ })).toBeVisible();
  await expect(page.getByLabel(/^Height/)).toHaveValue('168');
  await page.getByRole('button', { name: /Combine with the scan/ }).click();
  await page.getByRole('button', { name: /Use these measurements/ }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'done');
  await page.getByRole('button', { name: /Enter the fitting room/ }).click();

  // the deck renders an estimate with a fit result
  await expect(page.getByTestId('fit-panel')).toBeVisible();
  await expect(page.getByText(/Estimate · not measured/)).toBeVisible();
  await expect(page.getByTestId('recommended-size')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Love' }).click();
  await page.getByRole('button', { name: 'Save to wardrobe' }).click();
  // give the outbox a moment to flush the signature + swipes
  await page.waitForTimeout(1500);

  // ---- assertions on everything that tried to leave the page -------------------------------
  expect(seen.length).toBeGreaterThan(0);
  const thirdParty = seen.filter((r) => new URL(r.url).origin !== origin);
  expect(thirdParty, `third-party requests: ${thirdParty.map((r) => r.url).join(', ')}`).toEqual([]);

  for (const r of seen) {
    const path = new URL(r.url).pathname;
    const allowed = path.startsWith('/v1/') || path.startsWith('/models/') || path.startsWith('/assets/') || path.startsWith('/icons/') || path === '/' || path.startsWith('/onboarding') || path.startsWith('/deck') || /\.(js|css|webmanifest|svg|png|woff2|html)$/.test(path) || path === '/sw.js';
    expect(allowed, `unexpected request ${r.method} ${r.url}`).toBe(true);
    if (path.startsWith('/models/')) expect(r.method, `models must be GET: ${r.url}`).toBe('GET');
    if (path.startsWith('/v1/')) {
      if (r.bodyBytes > 0) expect(r.contentType, `non-JSON API call ${r.url}`).toMatch(/^application\/json/);
      expect(r.contentType, `image MIME on ${r.url}`).not.toMatch(/image\/|multipart\//);
      expect(r.bodyBytes, `body too large on ${r.url} (${r.bodyBytes} bytes)`).toBeLessThanOrEqual(MAX_BODY_BYTES);
      if (r.body) {
        expect(r.body, `data URL in ${r.url}`).not.toMatch(/data:image\//);
        expect(r.body, `measurement field name in ${r.url}`).not.toMatch(/"(bust|waist|hip|height|weight|measurements|faceTile|baseFrame)"/);
      }
    } else {
      expect(r.bodyBytes, `non-API request with a body: ${r.url}`).toBe(0);
    }
  }

  // the signature went out exactly as an 80-float vector
  const sig = seen.find((r) => new URL(r.url).pathname === '/v1/me/signature');
  expect(sig, 'signature sync happened').toBeTruthy();
  const wire = JSON.parse(sig!.body!) as { version: number; vector: number[]; quality: number };
  expect(wire.version).toBe(1);
  expect(wire.vector).toHaveLength(80);
  expect(wire.vector[78]).toBe(1);
  expect(Object.keys(wire).sort()).toEqual(['quality', 'vector', 'version']);

  // swipes carry size/score, never body data
  const swipes = seen.find((r) => new URL(r.url).pathname === '/v1/swipes');
  expect(swipes, 'swipe batch happened').toBeTruthy();
  const batch = JSON.parse(swipes!.body!) as { events: Record<string, unknown>[] };
  expect(batch.events.length).toBeGreaterThan(0);
  for (const e of batch.events) expect(Object.keys(e).sort()).toEqual(['action', 'at', 'clientId', 'dealIndex', 'fitScore', 'itemId', 'shopId', 'sizeAtSwipe'].filter((k) => k in e).sort());
});

test('merchant console never loads inside the phone frame and needs a key', async ({ page, baseURL }) => {
  await instrument(page, new URL(baseURL!).origin);
  await page.goto('/merchant');
  await expect(page).toHaveURL(/\/merchant\/login$/);
  await page.getByLabel(/Secret key/).fill('not-a-key');
  await page.getByRole('button', { name: /Open console/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel(/Secret key/).fill('sk_test_abcdefghijklmnop');
  await page.getByRole('button', { name: /Open console/ }).click();
  await expect(page.getByRole('heading', { name: /Merchant console/ })).toBeVisible();
  await expect(page.getByText(/API unreachable — showing demo data/)).toBeVisible();
});

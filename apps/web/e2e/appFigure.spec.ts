import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The consumer app's figure (the deck's mirror), where the estimate badge and the body chip sit
 * at the top of the frame: at phone size (360 x 740) they must not cover the neutral standard
 * face (D19: no avatar looks unfinished), and the estimate badge is on screen (rule 3).
 * With AVATAR_SHOTS=<dir> it writes the screenshot.
 */

const DEVICE = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'e2e.device.token', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), tokenVersion: 1 };
const SHOTS = process.env.AVATAR_SHOTS ?? null;
const VIEWPORT = { width: 360, height: 740 };

async function mockApi(page: Page, origin: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/v1/')) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/v1/devices') return json(201, DEVICE);
    if (url.pathname === '/v1/me/signature') return json(200, { updatedAt: new Date().toISOString(), ledgerEntryId: '22222222-2222-4222-8222-222222222222' });
    return json(404, { error: { code: 'not_found', message: 'mock' } });
  });
}

/** Onboarding with typed measurements, to the deck (the steps of privacy.spec.ts). */
async function toDeck(page: Page): Promise<void> {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('spinbutton', { name: /^Height/ }).fill('168');
  await page.getByRole('spinbutton', { name: /^Bust/ }).fill('88');
  await page.getByRole('spinbutton', { name: /^Waist/ }).fill('70');
  await page.getByRole('spinbutton', { name: /^Hip/ }).fill('96');
  await page.getByRole('radio', { name: /tape/i }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: 'Minimal' }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  const start = page.getByRole('button', { name: /Start with a photo|Enter measurements/ });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  const label = await start.textContent();
  await start.click();
  if (/Start with a photo/.test(label ?? '')) {
    await page.getByRole('button', { name: /Skip|Continue without/i }).first().click({ timeout: 30_000 }).catch(() => undefined);
    await page.getByRole('button', { name: /Skip|measurements only/i }).first().click({ timeout: 30_000 }).catch(() => undefined);
  }
  await page.getByRole('button', { name: /Combine with the scan/ }).click();
  await page.getByRole('button', { name: /Use these measurements/ }).click();
  await page.getByRole('button', { name: /Enter the fitting room/ }).click();
  await expect(page.getByTestId('fit-panel')).toBeVisible();
}

test('consumer app: the labels at the top of the figure do not cover the neutral face, at 360 x 740', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', permissions: [] });
  const page = await context.newPage();
  await mockApi(page, new URL(baseURL!).origin);
  await toDeck(page);
  const mirror = page.getByTestId('mirror').first();
  await expect(mirror.getByTestId('neutral-face')).toHaveCount(1);
  await expect(mirror.getByTestId('estimate-label')).toHaveText('Estimate · not measured');
  await expect(mirror.getByTestId('estimate-label')).toBeInViewport({ ratio: 1 });
  // Let the card settle (it springs in).
  await page.waitForTimeout(600);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'app-deck-360-labels-at-top.png') });
  }
  const face = (await mirror.getByTestId('neutral-face').boundingBox())!;
  for (const chip of await mirror.locator('[data-testid="avatar-labels"] > *').all()) {
    const r = (await chip.boundingBox())!;
    const over = r.x < face.x + face.width && r.x + r.width > face.x && r.y < face.y + face.height && r.y + r.height > face.y;
    const name = (await chip.innerText()).replace(/\s+/g, ' ').trim();
    expect(over, `"${name}" covers the face (label ${JSON.stringify(r)}, face ${JSON.stringify(face)})`).toBe(false);
    // The strip is above the head, not beside it: nothing of a label is level with the face.
    expect(r.y + r.height, `"${name}" reaches down to the face`).toBeLessThanOrEqual(face.y);
  }
  await context.close();
});

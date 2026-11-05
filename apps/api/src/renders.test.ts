import { readdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerEntries, renderJobs, usageEvents } from './db/schema.js';
import { makePruneRendersHandler } from './jobs/maintenance.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

async function png(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: '#F5EFE7' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'should-be-stripped' } } })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

describe('POST /v1/renders/hero — the only image route', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  let body: Record<string, unknown>;
  beforeAll(async () => {
    t = await makeApp({ RENDERS_DIR: `/tmp/claude-0/curtain-renders-${process.pid}` });
    s = await seedShop(t);
    body = {
      productId: 'aalter-studio-1',
      shopId: s.shop.id,
      size: 'M',
      person: { kind: 'avatarRender', mimeType: 'image/png', imageBase64: await png(512, 768), width: 512, height: 768 },
      consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: new Date().toISOString() },
    };
  });
  afterAll(async () => {
    await t.close();
  });

  it("rejects person.kind !== 'avatarRender' and missing consent at the schema", async () => {
    const d = await createDevice(t);
    const photo = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, person: { ...(body.person as object), kind: 'userPhoto' } } });
    expect(photo.statusCode).toBe(400);
    expect(photo.json().error.code).toBe('validation');
    expect(JSON.stringify(photo.json())).toContain('person');

    const noAck = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, consent: { tier: 'heroOptIn', ack: false, acknowledgedAt: new Date().toISOString() } } });
    expect(noAck.statusCode).toBe(400);
    const noConsent = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, consent: undefined } });
    expect(noConsent.statusCode).toBe(400);
    const wrongTier = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, consent: { tier: 'avatar', ack: true, acknowledgedAt: new Date().toISOString() } } });
    expect(wrongTier.statusCode).toBe(400);
    expect(await t.handle.db.select().from(renderJobs)).toHaveLength(0);
  });

  it('validates the image: dimensions ≤ 1024×1536, declared size must match, must decode', async () => {
    const d = await createDevice(t);
    const big = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, person: { kind: 'avatarRender', mimeType: 'image/png', imageBase64: await png(1025, 800), width: 1025, height: 800 } } });
    expect(big.statusCode).toBe(422);
    expect(big.json().error.code).toBe('image_too_large');
    const mismatch = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, person: { ...(body.person as object), width: 600 } } });
    expect(mismatch.statusCode).toBe(422);
    const garbage = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, person: { ...(body.person as object), imageBase64: Buffer.from('not an image').toString('base64') } } });
    expect(garbage.statusCode).toBe(422);
  });

  it('queues the job, the worker renders through the router (mock), ledger + usage are written, files expire', async () => {
    const d = await createDevice(t);
    const res = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, video: { seconds: 5 } } });
    expect(res.statusCode).toBe(202);
    const { jobId, status, disclaimer } = res.json<{ jobId: string; status: string; disclaimer: string }>();
    expect(status).toBe('queued');
    expect(disclaimer).toMatch(/estimate/i);

    const queued = await t.app.inject({ method: 'GET', url: `/v1/renders/${jobId}`, headers: d.auth });
    expect(queued.json()).toMatchObject({ status: 'queued', retentionHours: 24 });
    expect(queued.json().imageUrl).toBeUndefined();
    const other = await createDevice(t);
    expect((await t.app.inject({ method: 'GET', url: `/v1/renders/${jobId}`, headers: other.auth })).statusCode).toBe(404);

    // the person image was stored stripped of metadata, under the renders dir, and nowhere else
    const row = await t.handle.db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) });
    expect(row?.personPath).toContain(jobId);
    const stored = await t.app.renders.read(row!.personPath!);
    const meta = await sharp(Buffer.from(stored!)).metadata();
    expect(meta.exif).toBeUndefined();

    expect(t.queue.pending('render-hero')).toHaveLength(1);
    expect(await t.queue.drain()).toBe(1);
    expect(t.queue.failed).toHaveLength(0);

    const done = await t.app.inject({ method: 'GET', url: `/v1/renders/${jobId}`, headers: d.auth });
    const st = done.json<{ status: string; imageUrl: string; videoUrl?: string; provider: string; model: string; disclaimer: string; retentionHours: number }>();
    expect(st.status).toBe('done');
    expect(st.provider).toBe('mock');
    expect(st.disclaimer).toMatch(/estimate/i);
    expect(st.retentionHours).toBeLessThanOrEqual(24);
    expect(st.imageUrl).toContain(`/v1/renders/${jobId}/image?exp=`);
    expect(st.videoUrl).toContain(`/v1/renders/${jobId}/video?exp=`);

    const url = new URL(st.imageUrl);
    const img = await t.app.inject({ method: 'GET', url: url.pathname + url.search });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-curtain-disclaimer']).toBe('generated-estimate');
    const tampered = await t.app.inject({ method: 'GET', url: url.pathname + url.search.replace(/sig=.{4}/, 'sig=zzzz') });
    expect(tampered.statusCode).toBe(403);

    const after = await t.handle.db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) });
    expect(after?.personPath).toBeNull();
    expect(after?.resultPath).toBeTruthy();
    const files = await readdir(t.app.renders.dir);
    expect(files.some((f) => f.includes('-person'))).toBe(false);

    const ledger = await t.handle.db.select().from(ledgerEntries).where(eq(ledgerEntries.deviceId, d.deviceId));
    const hero = ledger.find((l) => l.kind === 'hero_render');
    expect(hero?.payloadSummary).toMatchObject({ provider: 'mock', fields: ['person', 'productId', 'shopId', 'size', 'consent'] });
    expect(hero?.inputs).toContain('avatarRender');
    expect(hero?.productExternalId).toBe('aalter-studio-1');
    const usage = await t.handle.db.select().from(usageEvents).where(eq(usageEvents.kind, 'hero_render'));
    expect(usage).toHaveLength(1);

    // merchant ledger sees provider/model/retention but never the device
    const ml = await t.app.inject({ method: 'GET', url: '/v1/merchant/ledger', headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(ml.json().entries[0]).toMatchObject({ provider: 'mock', productExternalId: 'aalter-studio-1', inputs: expect.arrayContaining(['avatarRender']) });
    expect(JSON.stringify(ml.json())).not.toContain(d.deviceId);

    // 24 h later: pruned
    await t.handle.db.update(renderJobs).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(renderJobs.id, jobId));
    expect(await makePruneRendersHandler(t.app)()).toBe(1);
    const expired = await t.app.inject({ method: 'GET', url: `/v1/renders/${jobId}`, headers: d.auth });
    expect(expired.json().status).toBe('expired');
    expect((await readdir(t.app.renders.dir)).some((f) => f.startsWith(jobId))).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: url.pathname + url.search })).statusCode).toBe(404);
  });

  it('a failing job is reported as failed and deletes the person image', async () => {
    const d = await createDevice(t);
    const res = await t.app.inject({ method: 'POST', url: '/v1/renders/hero', headers: d.auth, payload: { ...body, productId: 'raw-denim-01' } });
    const { jobId } = res.json<{ jobId: string }>();
    const row = await t.handle.db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) });
    await t.app.renders.remove(row!.personPath);
    await t.queue.drain();
    const st = await t.app.inject({ method: 'GET', url: `/v1/renders/${jobId}`, headers: d.auth });
    expect(st.json()).toMatchObject({ status: 'failed', error: 'person_image_missing' });
  });
});

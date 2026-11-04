import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './test/helpers.js';

describe('ops', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('healthz and readyz answer', async () => {
    const h = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ ok: true });
    const r = await t.app.inject({ method: 'GET', url: '/readyz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, db: true, jobs: true });
  });

  it('serves OpenAPI generated from the zod DTOs', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3\./);
    for (const p of ['/v1/devices', '/v1/me/signature', '/v1/swipes', '/v1/sdk/sessions', '/v1/merchant/products/{externalId}', '/v1/renders/hero', '/v1/try/{token}']) {
      expect(doc.paths[p], p).toBeDefined();
    }
  });

  it('unknown routes return the ApiError shape', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  it('rejects invalid JSON bodies with 400', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/devices', payload: '{bad', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_json');
  });
});

import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  AnalyticsSwipesResponseSchema,
  DateRangeQuerySchema,
  DeviceCreateRequestSchema,
  DeviceTokenResponseSchema,
  ESTIMATE_DISCLAIMER,
  HeroRenderRequestSchema,
  HeroRenderStatusSchema,
  LedgerEntrySchema,
  MerchantProductUpsertRequestSchema,
  MerchantProductUpsertResponseSchema,
  MerchantProductValidateResponseSchema,
  PersonInputSchema,
  SdkSessionRequestSchema,
  ShopProductsQuerySchema,
  SignaturePutRequestSchema,
  SwipeBatchRequestSchema,
  TryResolveResponseSchema,
  UsageResponseSchema,
  WardrobePutRequestSchema,
  validateGarmentDraft,
} from './api';
import { mockGarment } from './fixtures';
import { toFitSignatureWire } from './fitSignature';

const UUID = '6f1a2c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const NOW = '2026-11-04T10:00:00.000Z';

describe('device + signature DTOs', () => {
  it('validate the anonymous device flow', () => {
    expect(DeviceCreateRequestSchema.safeParse({ platform: 'web', appVersion: '0.1.0' }).success).toBe(true);
    expect(DeviceCreateRequestSchema.safeParse({ platform: 'windows', appVersion: '0.1.0' }).success).toBe(false);
    expect(DeviceTokenResponseSchema.safeParse({ deviceId: UUID, token: 'jwt', expiresAt: NOW, tokenVersion: 1 }).success).toBe(true);
  });

  it('PUT /v1/me/signature takes the wire form only', () => {
    const wire = toFitSignatureWire({ girths: { bust: 88 }, quality: 0.6 });
    expect(SignaturePutRequestSchema.safeParse(wire).success).toBe(true);
    expect(SignaturePutRequestSchema.safeParse({ ...wire, measurements: { bust: 88 } }).success).toBe(true); // extra keys stripped
    expect(SignaturePutRequestSchema.parse({ ...wire, measurements: { bust: 88 } })).not.toHaveProperty('measurements');
  });

  it('ledger entries list field names, never values', () => {
    const ok = LedgerEntrySchema.safeParse({ id: UUID, kind: 'signature_sync', at: NOW, payloadSummary: { bytes: 812, fields: ['version', 'vector', 'quality'] } });
    expect(ok.success).toBe(true);
    expect(LedgerEntrySchema.safeParse({ id: UUID, kind: 'photo_upload', at: NOW, payloadSummary: { bytes: 1, fields: [] } }).success).toBe(false);
  });
});

describe('try / shop / swipes / wardrobe DTOs', () => {
  it('try resolve returns branding + a full garment + intent token', () => {
    const r = TryResolveResponseSchema.safeParse({
      shop: { id: UUID, name: 'Aalter Studio', brandColor: '#C97A4F', platform: 'shopify' },
      garment: mockGarment('aalter-studio-1'),
      trySession: { id: UUID, expiresAt: NOW, intentToken: 'it_0123456789abcdef' },
      pairing: { created: true, pairedAt: NOW },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.shop.paused).toBe(false);
  });

  it('shop products query coerces limit and validates category', () => {
    expect(ShopProductsQuerySchema.parse({ limit: '20', category: 'dress' })).toEqual({ limit: 20, category: 'dress' });
    expect(ShopProductsQuerySchema.safeParse({ category: 'hats' }).success).toBe(false);
    expect(ShopProductsQuerySchema.parse({}).limit).toBe(50);
  });

  it('swipe batches are ≤ 100 events with shopId + clientId and carry no body data', () => {
    const ev = { itemId: 'aalter-studio-1', action: 'love', at: 1, sizeAtSwipe: 'M', fitScore: 1, dealIndex: 0, shopId: UUID, clientId: 'c_00000001' };
    expect(SwipeBatchRequestSchema.safeParse({ events: [ev] }).success).toBe(true);
    expect(SwipeBatchRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(SwipeBatchRequestSchema.safeParse({ events: Array(101).fill(ev) }).success).toBe(false);
    const parsed = SwipeBatchRequestSchema.parse({ events: [{ ...ev, bust: 88 }] });
    expect(parsed.events[0]).not.toHaveProperty('bust');
  });

  it('wardrobe states are the four lifecycle states', () => {
    expect(WardrobePutRequestSchema.safeParse({ shopId: UUID, size: 'M', state: 'kept' }).success).toBe(true);
    expect(WardrobePutRequestSchema.safeParse({ shopId: UUID, size: 'M', state: 'wishlist' }).success).toBe(false);
  });
});

describe('hero render (the only image-accepting route)', () => {
  const person = { kind: 'avatarRender', mimeType: 'image/png', imageBase64: 'iVBORw0KGgo=', width: 1024, height: 1536 };

  it("PersonInput.kind is the literal 'avatarRender' only", () => {
    expect(PersonInputSchema.safeParse(person).success).toBe(true);
    expect(PersonInputSchema.safeParse({ ...person, kind: 'userPhoto' }).success).toBe(false);
    expect(PersonInputSchema.safeParse({ ...person, kind: 'photo' }).success).toBe(false);
    // The literal is closed: a kind other than 'avatarRender' never parses.
    const def = PersonInputSchema.shape.kind;
    expect(def.safeParse('avatarRender').success).toBe(true);
    expect(def.safeParse('userPhoto').success).toBe(false);
  });

  it('requires explicit per-render consent', () => {
    const req = { productId: 'aalter-studio-1', shopId: UUID, size: 'M', person, consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: NOW } };
    expect(HeroRenderRequestSchema.safeParse(req).success).toBe(true);
    expect(HeroRenderRequestSchema.safeParse({ ...req, consent: { ...req.consent, ack: false } }).success).toBe(false);
    expect(HeroRenderRequestSchema.safeParse({ ...req, consent: { ...req.consent, tier: 'default' } }).success).toBe(false);
  });

  it('every status response carries an estimate disclaimer and ≤ 24 h retention', () => {
    const s = HeroRenderStatusSchema.parse({ jobId: UUID, status: 'done', imageUrl: 'https://api.curtain.fit/r/x', createdAt: NOW });
    expect(s.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(s.retentionHours).toBe(24);
    expect(HeroRenderStatusSchema.safeParse({ jobId: UUID, status: 'done', createdAt: NOW, retentionHours: 72 }).success).toBe(false);
    expect(HeroRenderStatusSchema.safeParse({ jobId: UUID, status: 'done', createdAt: NOW, disclaimer: '' }).success).toBe(false);
  });
});

describe('SDK + merchant DTOs', () => {
  it('sdk session request validates the public key prefix and page url', () => {
    expect(SdkSessionRequestSchema.safeParse({ shopKeyPrefix: ('pk_' + 'live_abc123XYZ'), productExternalId: '42', pageUrl: 'https://shop.example/p/42' }).success).toBe(true);
    expect(SdkSessionRequestSchema.safeParse({ shopKeyPrefix: ('sk_' + 'live_abc123XYZ'), productExternalId: '42', pageUrl: 'https://shop.example/p/42' }).success).toBe(false);
  });

  it('merchant upsert accepts drafts and the response reports completeness', () => {
    expect(MerchantProductUpsertRequestSchema.safeParse({ id: '42', name: 'Thing', brand: 'B' }).success).toBe(true);
    expect(MerchantProductUpsertRequestSchema.safeParse(mockGarment('sole-01')).success).toBe(true);
    const res = { externalId: '42', status: 'incomplete', score: 0.3, missingFields: ['sizeChart'], contentHash: 'a'.repeat(64), changed: true, updatedAt: NOW };
    expect(MerchantProductUpsertResponseSchema.safeParse(res).success).toBe(true);
  });

  it('validateGarmentDraft returns zod issues + completeness and matches its DTO', () => {
    const full = validateGarmentDraft(mockGarment('aalter-studio-1'));
    expect(full.valid).toBe(true);
    expect(full.issues).toEqual([]);
    expect(full.completeness.status).toBe('active');
    expect(MerchantProductValidateResponseSchema.safeParse(full).success).toBe(true);

    const partial = validateGarmentDraft({ id: '42', name: 'Thing', brand: 'B', fabric: { primary: 'linen', stretchPct: 'lots' } });
    expect(partial.valid).toBe(false);
    expect(partial.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['category', 'fabric.stretchPct', 'sizeChartType']));
    expect(partial.completeness.status).toBe('incomplete');
    expect(MerchantProductValidateResponseSchema.safeParse(partial).success).toBe(true);
  });

  it('usage + analytics responses carry the plan and the k-anonymity floor', () => {
    expect(DateRangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-10-01' }).success).toBe(false);
    const usage = UsageResponseSchema.safeParse({
      from: '2026-11-01',
      to: '2026-11-04',
      days: [{ day: '2026-11-01', fitSessions: 12, heroRenders: 1, costUsd: 0.08 }],
      totals: { fitSessions: 12, heroRenders: 1, costUsd: 0.08 },
      plan: { name: 'starter', includedSessions: 500, overageEurPerSession: 0.05, periodStart: '2026-11-01', periodEnd: '2026-11-30', sessionsUsedThisPeriod: 12, paused: false },
    });
    expect(usage.success).toBe(true);
    const analytics = AnalyticsSwipesResponseSchema.safeParse({
      from: '2026-11-01',
      to: '2026-11-04',
      kAnonymityFloor: 5,
      suppressedGroups: 2,
      byProduct: [{ externalId: '42', love: 5, pass: 3, save: 1, less: 0, sizeHistogram: { M: 4, L: 2 }, passReasons: { fit: 2 } }],
      byColour: [],
      byFabric: [],
      bySize: [],
    });
    expect(analytics.success).toBe(true);
  });

  it('route table covers the documented surface', () => {
    expect(API_ROUTES.signaturePut).toBe('PUT /v1/me/signature');
    expect(API_ROUTES.renderHero).toBe('POST /v1/renders/hero');
    expect(API_ROUTES.merchantProductValidate).toBe('POST /v1/merchant/products/validate');
    expect(Object.values(API_ROUTES).every((r) => /^(GET|POST|PUT|DELETE) \/v1\//.test(r))).toBe(true);
  });
});

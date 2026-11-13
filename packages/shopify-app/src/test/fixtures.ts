/**
 * Test fixtures: a Shopify product node that normalises to MOCK_GARMENTS 'aalter-studio-1'
 * (fit-engine WRAP), a matching bulk JSONL export, and a tiny fetch mock.
 */
import type { ShopifyProductNode } from '@curtain/schema';
import type { FetchLike } from '../types';

export const SHOP = 'aalter-studio.myshopify.com';
export const API_KEY = '0123456789abcdef0123456789abcdef';
export const API_SECRET = 'shp' + 'ss_test_secret_0123456789abcdef';
export const ACCESS_TOKEN = 'shp' + 'at_0123456789abcdef0123456789abcdef';
export const PRODUCT_ID = '8213455001';
export const PRODUCT_GID = `gid://shopify/Product/${PRODUCT_ID}`;

export const WRAP_METAFIELDS: Array<{ namespace: string; key: string; type: string; value: string }> = [
  { namespace: '$app:curtain', key: 'category', type: 'single_line_text_field', value: 'dress' },
  { namespace: '$app:curtain', key: 'subcategory', type: 'single_line_text_field', value: 'wrap-midi' },
  { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
  {
    namespace: '$app:curtain',
    key: 'size_chart',
    type: 'json',
    value: JSON.stringify([
      { size: 'XS', bust: 84, waist: 64, hip: 92, shoulder: 36 },
      { size: 'S', bust: 88, waist: 68, hip: 96, shoulder: 37 },
      { size: 'M', bust: 92, waist: 72, hip: 100, shoulder: 38 },
      { size: 'L', bust: 96, waist: 76, hip: 104, shoulder: 39 },
    ]),
  },
  {
    namespace: '$app:curtain',
    key: 'fabric',
    type: 'json',
    value: JSON.stringify({ primary: 'linen', blend: [['linen', 100]], weightGsm: 240, stretchPct: 2, drape: 0.78, opacity: 0.92, sheen: 0.15 }),
  },
  { namespace: '$app:curtain', key: 'flat_lay_photo', type: 'url', value: 'https://cdn.shopify.com/s/files/1/aalter/flat-lay-wrap.jpg' },
  { namespace: '$app:curtain', key: 'pattern_block', type: 'single_line_text_field', value: 'wrap' },
  { namespace: '$app:curtain', key: 'ease', type: 'json', value: JSON.stringify({ bust: 6, waist: 4, hip: 8 }) },
  { namespace: '$app:curtain', key: 'length_cm', type: 'json', value: JSON.stringify({ shoulder_to_hem: 118, shoulder_to_waist: 41, sleeve_length: 0 }) },
  { namespace: '$app:curtain', key: 'sizing_notes', type: 'multi_line_text_field', value: 'runs small' },
  { namespace: '$app:curtain', key: 'true_to_size_score', type: 'number_decimal', value: '0.92' },
  { namespace: '$app:curtain', key: 'critical_fit_points', type: 'list.single_line_text_field', value: JSON.stringify(['bust', 'shoulder']) },
  { namespace: '$app:curtain', key: 'stretch_zones', type: 'list.single_line_text_field', value: JSON.stringify(['waist-tie']) },
  { namespace: '$app:curtain', key: 'style_tags', type: 'json', value: JSON.stringify({ bohemian: 0.9, classic: 0.3 }) },
  { namespace: '$app:curtain', key: 'primary_color_hex', type: 'color', value: '#C97A4F' },
  {
    namespace: '$app:curtain',
    key: 'colorways',
    type: 'json',
    value: JSON.stringify([
      { name: 'Terracotta', hex: '#C97A4F', sku: 'AS-LWD-TER' },
      { name: 'Sage', hex: '#8A9A7B', sku: 'AS-LWD-SAG' },
    ]),
  },
];

export function wrapDressNode(overrides: Partial<ShopifyProductNode> = {}): ShopifyProductNode {
  return {
    id: PRODUCT_GID,
    handle: 'linen-wrap-dress',
    title: 'Linen Wrap Dress',
    vendor: 'Aalter Studio',
    productType: 'Dresses',
    status: 'ACTIVE',
    onlineStoreUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress',
    category: { name: 'Dresses', fullName: 'Apparel & Accessories > Clothing > Dresses' },
    featuredImage: { url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg' },
    images: { nodes: [{ url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg' }, { url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg' }] },
    priceRangeV2: { minVariantPrice: { amount: '149.00', currencyCode: 'EUR' } },
    variants: { nodes: [{ price: '149.00', selectedOptions: [{ name: 'Size', value: 'S' }] }] },
    metafields: { nodes: WRAP_METAFIELDS },
    ...overrides,
  };
}

/** The same product as a bulk export: product line, then children with __parentId. */
export function wrapDressJsonl(): string {
  const lines: unknown[] = [
    {
      id: PRODUCT_GID,
      handle: 'linen-wrap-dress',
      title: 'Linen Wrap Dress',
      vendor: 'Aalter Studio',
      productType: 'Dresses',
      status: 'ACTIVE',
      onlineStoreUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress',
      category: { name: 'Dresses', fullName: 'Apparel & Accessories > Clothing > Dresses' },
      featuredImage: { url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg' },
      priceRangeV2: { minVariantPrice: { amount: '149.00', currencyCode: 'EUR' } },
    },
    { id: 'gid://shopify/ProductImage/1', url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg', __parentId: PRODUCT_GID },
    { id: 'gid://shopify/ProductImage/2', url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg', __parentId: PRODUCT_GID },
    { id: 'gid://shopify/ProductVariant/11', price: '149.00', selectedOptions: [{ name: 'Size', value: 'S' }], __parentId: PRODUCT_GID },
    ...WRAP_METAFIELDS.map((m, i) => ({ id: `gid://shopify/Metafield/${100 + i}`, ...m, __parentId: PRODUCT_GID })),
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string | undefined;
}

export type MockReply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | ((call: RecordedCall) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> });

export interface FetchMock {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** Queue replies in order; the last one repeats when the queue runs dry. */
  reply(...replies: MockReply[]): FetchMock;
  /** GraphQL helper: reply with `{ data }`. */
  data(...payloads: unknown[]): FetchMock;
  last(): RecordedCall;
  variables<T = Record<string, unknown>>(i?: number): T;
  query(i?: number): string;
}

export function fetchMock(): FetchMock {
  const queue: MockReply[] = [];
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    else if (Array.isArray(h)) for (const pair of h) headers[String(pair[0]).toLowerCase()] = String(pair[1]);
    else if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    let body: unknown = rawBody;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const call: RecordedCall = { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body, rawBody };
    calls.push(call);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (!next) throw new Error(`fetchMock: no reply queued for ${call.method} ${url}`);
    const r = typeof next === 'function' ? next(call) : next;
    const status = r.status ?? 200;
    const text = r.text !== undefined ? r.text : r.json !== undefined ? JSON.stringify(r.json) : '';
    return new Response(text, { status, headers: { 'content-type': r.text !== undefined ? 'text/plain' : 'application/json', ...(r.headers ?? {}) } });
  };
  const mock: FetchMock = {
    fetch,
    calls,
    reply(...replies) {
      queue.push(...replies);
      return mock;
    },
    data(...payloads) {
      for (const p of payloads) queue.push({ json: { data: p } });
      return mock;
    },
    last: () => calls[calls.length - 1]!,
    variables: <T,>(i = calls.length - 1) => ((calls[i]!.body as { variables: T }).variables),
    query: (i = calls.length - 1) => (calls[i]!.body as { query: string }).query,
  };
  return mock;
}

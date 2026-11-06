// @vitest-environment jsdom
/**
 * The size chart builder in the embedded admin page, driven in jsdom with a mocked App Bridge
 * (`shopify.idToken`, `shopify.resourcePicker`) and a mocked api: template choice, onboarding,
 * bulk assign (request body + paging), product checklist and the description import confirm.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartTemplatesDto } from '@curtain/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAdminPage } from './admin';
import { API_KEY } from './test/fixtures';

const template = readFileSync(join(process.cwd(), 'admin', 'index.html'), 'utf8');
interface El {
  id: string;
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  textContent: string | null;
  innerHTML: string;
  classList: { contains(c: string): boolean };
  getAttribute(name: string): string | null;
  append(...nodes: El[]): void;
  click(): void;
  dispatchEvent(e: unknown): boolean;
  querySelectorAll(sel: string): ArrayLike<El>;
}
interface Dom {
  document: { head: El; body: El; createElement(tag: string): El; getElementById(id: string): El | null; querySelector(sel: string): El | null; querySelectorAll(sel: string): ArrayLike<El> };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  window: { shopify?: unknown };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
}
const { document, history, window, Event } = globalThis as unknown as Dom;
const $ = (id: string) => document.getElementById(id)!;

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

function mountPage(routes: Record<string, (c: Call) => unknown>, picker?: (opts: Record<string, unknown>) => unknown): Call[] {
  const calls: Call[] = [];
  history.replaceState(null, '', '/shopify/admin?shop=bohohippychic.myshopify.com');
  const html = renderAdminPage({ apiKey: API_KEY, apiUrl: 'https://api.curtain.fit', appUrl: 'https://app.curtain.fit', template });
  const config = /<script id="curtain-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const body = /<body>([\s\S]*?)<script>/.exec(html)![1]!;
  const script = /<script>\s*([\s\S]*?)<\/script>\s*<\/body>/.exec(html)![1]!;
  document.head.innerHTML = '';
  const cfgEl = document.createElement('script');
  cfgEl.id = 'curtain-config';
  cfgEl.type = 'application/json';
  cfgEl.textContent = config;
  document.head.append(cfgEl);
  document.body.innerHTML = body;
  window.shopify = {
    config: { shop: 'bohohippychic.myshopify.com' },
    idToken: async () => 'session-token',
    resourcePicker: async (opts: Record<string, unknown>) => (picker ? picker(opts) : undefined),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      const u = new URL(url);
      const call: Call = { method: init.method, path: u.pathname, body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null, auth: init.headers.authorization ?? null };
      calls.push(call);
      const key = `${init.method} ${u.pathname}`;
      const h = routes[key] ?? DEFAULTS[key];
      if (!h) return new Response(JSON.stringify({ error: { code: 'nope', message: `unmocked ${key}` } }), { status: 404 });
      const r = h(call);
      return new Response(JSON.stringify(r), { status: 200 });
    }),
  );
  new Function(script)();
  return calls;
}

const steps = (done: string[], next: string | null) => ({
  steps: ['connect', 'template', 'assign', 'themeBlock', 'test'].map((key) => ({ key, label: key, done: done.includes(key), detail: `${key} detail` })),
  next,
  state: { templateId: null, themeBlockConfirmed: false, tested: false },
});

const DEFAULTS: Record<string, (c: Call) => unknown> = {
  'POST /shopify/token-exchange': () => ({ shopId: '00000000-0000-4000-8000-000000000000', shopDomain: 'bohohippychic.myshopify.com', publicKeyPrefix: 'pk_' + 'test_abc', scope: 'read_products', backfillQueued: false }),
  'GET /v1/merchant/usage': () => ({ from: '', to: '', days: [], totals: { fitSessions: 0, heroRenders: 0, costUsd: 0 }, plan: { name: 'free', includedSessions: 0, overageEurPerSession: 0.05, periodStart: '', periodEnd: '', sessionsUsedThisPeriod: 0, paused: false } }),
  'GET /v1/merchant/products': () => ({ items: [{ externalId: '301', name: 'Boho Kaftan', category: 'dress', status: 'incomplete', score: 0.4, missingFields: ['sizeChart'], flatLayProcessedUrl: null, updatedAt: '2026-11-06T00:00:00.000Z' }], nextCursor: null, counts: { active: 0, incomplete: 1, archived: 0 } }),
  'GET /v1/merchant/ledger': () => ({ entries: [], nextCursor: null }),
  'GET /v1/merchant/charts/templates': () => chartTemplatesDto(),
  'GET /shopify/charts/onboarding': () => steps(['connect'], 'template'),
  'PUT /shopify/charts/onboarding': (c) => ({ templateId: null, themeBlockConfirmed: false, tested: false, ...c.body }),
};

afterEach(() => {
  delete window.shopify;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const fire = (el: El, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('admin page: size chart builder', () => {
  it('renders the templates with an explicit chart type, preselects AU, and shows the onboarding steps', async () => {
    mountPage({});
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    expect((document.querySelector('input[name="tpl"]:checked') as El).value).toBe('au-womens-body');
    expect((document.querySelector('input[name="chart-type"]:checked') as El).value).toBe('body');
    expect($('tpl-list').textContent).toContain('Garment measurements');
    expect($('chart-body').querySelectorAll('tr').length).toBe(7);
    expect($('tpl-sources').textContent).toMatch(/Sources: median of 3/);
    await vi.waitFor(() => expect($('chk-install').classList.contains('done')).toBe(true));
    expect(document.querySelector('[data-step="template"]')!.getAttribute('aria-current')).toBe('step');
  });

  it('switching to inches converts the displayed numbers; picking a template saves it to onboarding', async () => {
    const calls = mountPage({});
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    const firstCell = () => ($('chart-body').querySelectorAll('input')[0] as El).value;
    expect(firstCell()).toBe('85');
    const inches = document.querySelector('input[name="chart-unit"][value="in"]')!;
    inches.checked = true;
    fire(inches, 'change');
    expect(firstCell()).toBe('33.5');
    const uk = $('tpl-uk-womens-body');
    uk.checked = true;
    fire(uk, 'change');
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/shopify/charts/onboarding')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ templateId: 'uk-womens-body' });
  });

  it('assigns the template to a picked collection, paging until done, with the session token', async () => {
    let page = 0;
    const calls = mountPage(
      {
        'POST /shopify/charts/assign': () => {
          page += 1;
          return { written: page === 1 ? ['1', '2'] : ['3'], skipped: [], failed: [], syncQueued: 1, nextCursor: page === 1 ? 'c1' : null, chart: { sizeChartType: 'body', sizeChart: [] }, warnings: [] };
        },
      },
      (opts) => (opts.type === 'collection' ? [{ id: 'gid://shopify/Collection/555', title: 'Dresses' }] : undefined),
    );
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    $('btn-pick-collection').click();
    await vi.waitFor(() => expect($('sel-collection').textContent).toBe('Dresses'));
    $('btn-assign').click();
    await vi.waitFor(() => expect($('assign-status').textContent).toMatch(/Chart assigned to 3 product/));
    const assigns = calls.filter((c) => c.path === '/shopify/charts/assign');
    expect(assigns).toHaveLength(2);
    expect(assigns[0]!.body).toEqual({ selector: { kind: 'collection', collectionId: 'gid://shopify/Collection/555' }, chart: { templateId: 'au-womens-body', sizes: ['8', '10', '12', '14', '16', '18', '20'] }, overwrite: false, cursor: null });
    expect(assigns[1]!.body!.cursor).toBe('c1');
    expect(assigns[0]!.auth).toBe('Bearer session-token');
  });

  it('R5: a successful assign with the preselected AU template completes the template step', async () => {
    const calls = mountPage({ 'POST /shopify/charts/assign': () => ({ written: ['1'], skipped: [], failed: [], syncQueued: 1, nextCursor: null, chart: { sizeChartType: 'body', sizeChart: [] }, warnings: [] }) });
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]:checked').length).toBe(1));
    const tag = $('sel-tag');
    fire(tag, 'focus');
    tag.value = 'dress';
    $('btn-assign').click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/shopify/charts/onboarding')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ templateId: 'au-womens-body' });
  });

  it('R5: a saved template is restored instead of the AU default', async () => {
    mountPage({ 'GET /shopify/charts/onboarding': () => ({ ...steps(['connect', 'template'], 'assign'), state: { templateId: 'uk-womens-body', themeBlockConfirmed: false, tested: false } }) });
    await vi.waitFor(() => expect((document.querySelector('input[name="tpl"]:checked') as El | null)?.value).toBe('uk-womens-body'));
  });

  it('R6: switching a body template to garment clears the body numbers and warns', async () => {
    const calls = mountPage({});
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]:checked').length).toBe(1));
    expect(($('chart-body').querySelectorAll('input')[0] as El).value).toBe('85');
    const garment = document.querySelector('input[name="chart-type"][value="garment"]')!;
    garment.checked = true;
    fire(garment, 'change');
    expect(($('chart-body').querySelectorAll('input')[0] as El).value).toBe('');
    expect($('chart-check').textContent).toMatch(/body numbers were cleared/);
    const tag = $('sel-tag');
    fire(tag, 'focus');
    tag.value = 'dress';
    $('btn-assign').click();
    expect($('chart-check').textContent).toMatch(/has no measurements/);
    expect(calls.some((c) => c.path === '/shopify/charts/assign')).toBe(false);
    const body = document.querySelector('input[name="chart-type"][value="body"]')!;
    body.checked = true;
    fire(body, 'change');
    expect(($('chart-body').querySelectorAll('input')[0] as El).value).toBe('85');
  });

  it('sends typed garment rows (cm) once the merchant edits, and blocks empty sizes locally', async () => {
    const calls = mountPage({ 'POST /shopify/charts/assign': () => ({ written: ['9'], skipped: [], failed: [], syncQueued: 1, nextCursor: null, chart: { sizeChartType: 'garment', sizeChart: [] }, warnings: [] }) });
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    const one = $('tpl-garment-one-size');
    one.checked = true;
    fire(one, 'change');
    $('btn-assign').click();
    expect($('chart-check').textContent).toMatch(/Size ONE has no measurements/);
    const bust = $('chart-body').querySelectorAll('input')[0] as El;
    bust.value = '140';
    fire(bust, 'change');
    const tag = $('sel-tag');
    fire(tag, 'focus');
    tag.value = 'kaftan';
    $('btn-assign').click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === '/shopify/charts/assign')).toBe(true));
    expect(calls.find((c) => c.path === '/shopify/charts/assign')!.body).toMatchObject({
      selector: { kind: 'tag', tag: 'kaftan' },
      chart: { sizeChartType: 'garment', unit: 'cm', sizeChart: [{ size: 'ONE', bust: 140 }] },
    });
  });

  it('opens a product: checklist, Try it on preview link, description import and confirm', async () => {
    const calls = mountPage({
      'GET /shopify/products/301/checklist': () => ({
        productId: '301',
        title: 'Boho Kaftan',
        status: 'incomplete',
        score: 0.4,
        items: [{ key: 'sizeChart', label: 'Size chart', done: false, required: true, hint: 'Assign a template.' }],
        previewUrl: 'https://bohohippychic.com.au/products/boho-kaftan',
        adminUrl: 'https://bohohippychic.myshopify.com/admin/products/301',
      }),
      'GET /shopify/products/301/chart-import': () => ({
        productId: '301',
        title: 'Boho Kaftan',
        oneSize: true,
        sizeLabel: 'ONE',
        proposal: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }] },
        lengthCm: { shoulder_to_hem: 110 },
        fabric: { primary: 'viscose', blend: [['viscose', 100]], stretchPct: 0, drape: 0.85 },
        fabricStatement: 'Made from 100% rayon.',
        evidence: ['bust: “Bust 140cm circumference.” → 140 cm'],
        warnings: [],
        hasChart: false,
      }),
      'PUT /shopify/products/301/chart': () => ({ productId: '301', written: ['size_chart_type', 'size_chart', 'fabric', 'length_cm'], syncQueued: true, warnings: [] }),
    });
    await vi.waitFor(() => expect(document.querySelector('[data-product="301"]')).not.toBeNull());
    (document.querySelector('[data-product="301"]') as El).click();
    await vi.waitFor(() => expect($('product-checklist').textContent).toContain('Size chart'));
    expect($('product-panel').classList.contains('hidden')).toBe(false);
    expect($('lnk-preview').getAttribute('href')).toBe('https://bohohippychic.com.au/products/boho-kaftan');
    expect($('lnk-preview').getAttribute('target')).toBe('_blank');
    $('btn-import').click();
    await vi.waitFor(() => expect(document.getElementById('imp-bust')).not.toBeNull());
    expect(($('imp-bust') as El).value).toBe('140');
    ($('imp-waist') as El).value = '130';
    const form = $('import-result').querySelectorAll('form')[0] as El;
    fire(form, 'submit');
    await vi.waitFor(() => expect($('import-result').textContent).toMatch(/Saved/));
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/shopify/products/301/chart')!;
    expect(put.body).toEqual({
      sizeChartType: 'garment',
      sizeChart: [{ size: 'ONE', bust: 140, waist: 130 }],
      lengthCm: { shoulder_to_hem: 110 },
      fabric: { primary: 'viscose', blend: [['viscose', 100]], stretchPct: 0, drape: 0.85 },
    });
  });
});

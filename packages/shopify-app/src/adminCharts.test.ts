// @vitest-environment jsdom
/**
 * The size chart builder in the embedded admin page, driven in jsdom with a mocked App Bridge
 * (`shopify.idToken`, `shopify.resourcePicker`) and a mocked api: template choice, onboarding,
 * bulk assign (request body + paging), product checklist and the description import confirm.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartTemplatesDto, merchantSetupSteps, type SetupFacts } from '@curtain/schema';
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
  hidden: boolean;
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

function mountPage(routes: Record<string, (c: Call) => unknown>, picker?: (opts: Record<string, unknown>) => unknown, opts: { billing?: 'shopify' | 'arranged' } = {}): Call[] {
  const calls: Call[] = [];
  history.replaceState(null, '', '/shopify/admin?shop=bohohippychic.myshopify.com');
  const html = renderAdminPage({ apiKey: API_KEY, apiUrl: 'https://api.curtain.fit', appUrl: 'https://app.curtain.fit', template, ...(opts.billing ? { billing: opts.billing } : {}) });
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
      const r = h(call) as { __status?: number; body?: unknown } | null;
      if (r && typeof r === 'object' && typeof r.__status === 'number') return new Response(JSON.stringify(r.body), { status: r.__status });
      return new Response(JSON.stringify(r), { status: 200 });
    }),
  );
  new Function(script)();
  return calls;
}

/** The api's onboarding answer for a shop at a given point (the real @curtain/schema checklist). */
const steps = (facts: Partial<SetupFacts> = {}) => ({
  ...merchantSetupSteps({ connected: true, productsTotal: 1, productsWithChart: 0, productsMeasured: 0, buttonOpened: false, fitSessions: 0, buttonConfirmed: false, phoneConfirmed: false, ...facts }, 'shopify'),
  platform: 'shopify',
  measureProduct: null,
  phoneCheck: null,
  state: { templateId: null, themeBlockConfirmed: false, tested: false },
});

const DEFAULTS: Record<string, (c: Call) => unknown> = {
  'POST /shopify/token-exchange': () => ({ shopId: '00000000-0000-4000-8000-000000000000', shopDomain: 'bohohippychic.myshopify.com', publicKeyPrefix: 'pk_' + 'test_abc', scope: 'read_products', backfillQueued: false }),
  'GET /v1/merchant/usage': () => ({ from: '', to: '', days: [], totals: { fitSessions: 0, heroRenders: 0, costUsd: 0 }, plan: { name: 'free', includedSessions: 0, overageEurPerSession: 0.05, periodStart: '', periodEnd: '', sessionsUsedThisPeriod: 0, paused: false } }),
  'GET /v1/merchant/products': () => ({ items: [{ externalId: '301', name: 'Boho Kaftan', category: 'dress', status: 'incomplete', score: 0.4, missingFields: ['sizeChart'], flatLayProcessedUrl: null, updatedAt: '2026-11-06T00:00:00.000Z' }], nextCursor: null, counts: { active: 0, incomplete: 1, archived: 0 } }),
  'GET /v1/merchant/ledger': () => ({ entries: [], nextCursor: null }),
  'GET /v1/merchant/charts/templates': () => chartTemplatesDto(),
  'GET /shopify/charts/onboarding': () => steps(),
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
    await vi.waitFor(() => expect(document.querySelector('#setup-list [data-step="connect"] .num.done')).not.toBeNull());
    expect(document.querySelector('[data-step="chart"]')!.getAttribute('aria-current')).toBe('step');
    expect($('setup-progress').textContent).toBe('1 of 5 done');
    expect($('setup-list').textContent).toContain('3. Measure one skirt');
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
    mountPage({ 'GET /shopify/charts/onboarding': () => ({ ...steps(), state: { templateId: 'uk-womens-body', themeBlockConfirmed: false, tested: false } }) });
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

describe('admin page: the plan button (checklist B2)', () => {
  const usage = (plan: Record<string, unknown>) => () => ({
    from: '',
    to: '',
    days: [],
    totals: { fitSessions: 0, heroRenders: 0, costUsd: 0 },
    plan: { name: 'free', includedSessions: 50, overageEurPerSession: 0, priceUsdPerMonth: 0, periodStart: '', periodEnd: '', sessionsUsedThisPeriod: 0, paused: false, ...plan },
  });
  /** Every panel loaded (the page's main() is done), so nothing runs after the test tears the page down. */
  const settled = async (planText: string) => {
    await vi.waitFor(() => expect($('usage-plan').textContent).toBe(planText));
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    await vi.waitFor(() => expect(document.querySelector('[data-step="chart"]')!.getAttribute('aria-current')).toBe('step'));
  };

  it('a shop without a plan (new install, or reinstalled after uninstall) can subscribe', async () => {
    mountPage({ 'GET /v1/merchant/usage': usage({ name: 'free' }) });
    await settled('No plan');
    expect($('btn-plan').textContent).toBe('Start the plan');
    expect($('btn-plan').disabled).toBe(false);
  });

  it('an active Curtain subscription shows Plan active', async () => {
    mountPage({ 'GET /v1/merchant/usage': usage({ name: 'curtain', priceUsdPerMonth: 8.99, chargePrice: 13.8, chargeCurrency: 'AUD' }) });
    await settled('Curtain · 13.80 AUD a month');
    expect($('btn-plan').textContent).toBe('Plan active');
    expect($('btn-plan').disabled).toBe(true);
  });

  it('a shop still on a retired plan is offered the switch, not shown as subscribed at US$8.99', async () => {
    const calls = mountPage({
      'GET /v1/merchant/usage': usage({ name: 'curtain', priceUsdPerMonth: 8.99, legacyPlan: 'starter', switchVia: 'shopify' }),
      'POST /shopify/billing/subscribe': () => ({ confirmationUrl: null, subscriptionId: 'gid://shopify/AppSubscription/9', currency: 'USD', price: 8.99, trialDays: 0, test: true }),
    });
    await settled('Retired plan (starter) at its old price');
    expect($('btn-plan').textContent).toBe('Switch to Curtain (US$8.99)');
    expect($('btn-plan').disabled).toBe(false);
    expect($('chk-plan').classList.contains('done')).toBe(false);
    $('btn-plan').click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/shopify/billing/subscribe')).toBe(true));
    await vi.waitFor(() => expect($('banner').textContent).toContain('Subscription created'));
  });

  it('custom distribution (billing arranged): no Subscribe button, the plan reads as arranged, no billing call', async () => {
    const calls = mountPage({ 'GET /v1/merchant/usage': usage({ name: 'curtain', priceUsdPerMonth: 8.99 }) }, undefined, { billing: 'arranged' });
    await settled('Curtain · US$8.99 a month');
    expect($('btn-plan').hidden).toBe(true);
    expect($('chk-plan').classList.contains('done')).toBe(true);
    expect($('txt-plan').textContent).toContain('Curtain arranges payment with you directly');
    expect($('leaving-steps').textContent).toContain('Settings → Apps and sales channels → Curtain → Uninstall');
    expect(calls.some((c) => c.path === '/shopify/billing/subscribe')).toBe(false);
  });

  it('custom distribution, paused shop: told to contact Curtain, never to approve a Shopify charge', async () => {
    mountPage({ 'GET /v1/merchant/usage': usage({ name: 'curtain', paused: true }) }, undefined, { billing: 'arranged' });
    await settled('Curtain · US$8.99 a month · paused');
    expect($('banner').textContent).toContain('Email Curtain support');
    expect($('banner').textContent).not.toContain('Approve');
  });
});

describe('admin page: men\u2019s templates', () => {
  it('are not offered while their sources wait for the legal review', async () => {
    mountPage({});
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    expect(chartTemplatesDto().templates.some((t) => t.audience === 'men' && t.kind === 'body')).toBe(false);
    for (const id of ['mens-letter-body', 'eu-mens-body', 'mens-jeans-wl-body']) expect(document.getElementById('tpl-' + id), id).toBeNull();
    expect(document.getElementById('tpl-uk-womens-body')).not.toBeNull();
  });

  it('once released: prints Chest for a men\u2019s template, marks XXL an estimate, and shows the waist and inseam columns of the jeans chart', async () => {
    const calls = mountPage({ 'GET /v1/merchant/charts/templates': () => chartTemplatesDto({ includePendingLegalReview: true }) });
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    expect($('chart-head').textContent).toContain('Bust');
    const letters = $('tpl-mens-letter-body');
    letters.checked = true;
    fire(letters, 'change');
    expect($('chart-head').textContent).toContain('Chest (cm)');
    expect($('chart-head').textContent).not.toContain('Bust');
    expect(($('chart-body').querySelectorAll('input')[0] as El).value).toBe('95');
    // S, M, L, XL, XXL are preselected; the sources disagree by more than 10 cm at XXL only.
    expect(Array.from($('chart-body').querySelectorAll('.pill')).map((p) => p.getAttribute('title'))).toEqual(['Few sources, or the sources disagree']);
    const jeans = $('tpl-mens-jeans-wl-body');
    jeans.checked = true;
    fire(jeans, 'change');
    expect($('chart-head').textContent).toBe('SizeWaist (cm)Inseam (cm)');
    expect($('chart-body').querySelectorAll('tr').length).toBe(19);
    const first = $('chart-body').querySelectorAll('input');
    expect([(first[0] as El).value, (first[1] as El).value]).toEqual(['71', '81']);
    const women = $('tpl-uk-womens-body');
    women.checked = true;
    fire(women, 'change');
    expect($('chart-head').textContent).toContain('Bust (cm)');
    // Each pick saves the template to onboarding; let those finish before the page is torn down.
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ templateId: 'mens-letter-body' }, { templateId: 'mens-jeans-wl-body' }, { templateId: 'uk-womens-body' }]));
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});

describe('admin page: men\u2019s garment templates (neck, sleeve, length, rise, W/L)', () => {
  const ok = (sizeChartType: string) => () => ({ written: ['1'], skipped: [], failed: [], syncQueued: 1, nextCursor: null, chart: { sizeChartType, sizeChart: [] }, warnings: [] });
  const typeIn = (size: string, label: string, value: string) => {
    const input = Array.from($('chart-body').querySelectorAll('input')).find((i) => (i.getAttribute('aria-label') ?? '').startsWith(`Size ${size} ${label} `))!;
    input.value = value;
    fire(input, 'change');
  };
  const pickTag = () => {
    const tag = $('sel-tag');
    fire(tag, 'focus');
    tag.value = 'mens';
  };

  it("a women's template keeps its columns, help line and no sleeve question", async () => {
    mountPage({});
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]:checked').length).toBe(1));
    expect($('chart-head').textContent).toBe('SizeBust (cm)Waist (cm)Hip (cm)');
    expect($('sleeve-convention').classList.contains('hidden')).toBe(true);
    expect($('chart-wl-hint').classList.contains('hidden')).toBe(true);
    expect($('chart-help').textContent).toMatch(/^Bust, waist and hip all round/);
    const garment = $('tpl-garment-au-dress-top');
    garment.checked = true;
    fire(garment, 'change');
    expect($('chart-head').textContent).toBe('SizeBust (cm)Waist (cm)Hip (cm)');
    expect($('sleeve-convention').classList.contains('hidden')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it('the tee: Chest, Length, Sleeve and Neck columns, the sleeve measuring point is asked and sent', async () => {
    const calls = mountPage({ 'POST /shopify/charts/assign': ok('garment') });
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    const tee = $('tpl-garment-mens-tee');
    tee.checked = true;
    fire(tee, 'change');
    expect($('chart-head').textContent).toBe('SizeChest (cm)Waist (cm)Shoulder (cm)Length (cm)Sleeve (cm)Neck (cm)');
    expect($('sleeve-convention').classList.contains('hidden')).toBe(false);
    expect($('sleeve-convention').textContent).toContain('from the shoulder seam to the cuff');
    expect($('chart-help').textContent).toMatch(/^Chest and waist all round/);
    for (const [size, chest] of [['S', '98'], ['M', '106'], ['L', '114'], ['XL', '122'], ['XXL', '131']] as const) typeIn(size, 'Chest', chest);
    typeIn('M', 'Sleeve', '21');
    typeIn('M', 'Neck', '43');
    const cb = document.querySelector('input[name="sleeve-convention"][value="centre_back"]')!;
    cb.checked = true;
    pickTag();
    $('btn-assign').click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === '/shopify/charts/assign')).toBe(true));
    const chart = calls.find((c) => c.path === '/shopify/charts/assign')!.body!.chart as Record<string, unknown>;
    expect(chart.sleeveConvention).toBe('centre_back');
    expect(chart.sizeAxes).toBeUndefined();
    expect((chart.sizeChart as unknown[])[1]).toEqual({ size: 'M', bust: 106, sleeve: 21, neck: 43 });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it('the chino: Seat and Rise columns, W/L sizes sent as such, and the api’s plain-English refusal is shown at the chart', async () => {
    const calls = mountPage({
      'POST /shopify/charts/assign': () => ({ __status: 422, body: { error: { code: 'invalid_chart', message: 'x', details: { errors: ['Size 33 is not a waist/leg size: write it as waist/leg, for example 32/34.'], warnings: [] } } } }),
    });
    await vi.waitFor(() => expect(document.querySelectorAll('input[name="tpl"]').length).toBeGreaterThan(5));
    const chino = $('tpl-garment-mens-chino-wl');
    chino.checked = true;
    fire(chino, 'change');
    expect($('chart-head').textContent).toBe('SizeWaist (cm)Seat (cm)Thigh (cm)Rise (cm)Inseam (cm)');
    expect($('chart-body').querySelectorAll('tr').length).toBe(15);
    expect($('chart-wl-hint').classList.contains('hidden')).toBe(false);
    expect($('sleeve-convention').classList.contains('hidden')).toBe(true);
    for (const size of ['30/30', '30/32', '30/34', '32/30', '32/32', '32/34', '34/30', '34/32', '34/34', '36/30', '36/32', '36/34', '38/30', '38/32', '38/34']) typeIn(size, 'Waist', '80');
    typeIn('32/32', 'Rise', '26.5');
    pickTag();
    $('btn-assign').click();
    await vi.waitFor(() => expect($('chart-check').textContent).toContain('Size 33 is not a waist/leg size'));
    const chart = calls.find((c) => c.path === '/shopify/charts/assign')!.body!.chart as Record<string, unknown>;
    expect(chart.sizeAxes).toBe('wl');
    expect(chart.sleeveConvention).toBeUndefined();
    expect((chart.sizeChart as unknown[])[4]).toEqual({ size: '32/32', waist: 80, rise: 26.5 });
    expect($('assign-status').textContent).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});

// @vitest-environment jsdom
/**
 * The "Settings" section of the embedded admin page and the fabric notices of its product list,
 * driven in jsdom with a mocked App Bridge and a mocked api. The section reads and writes the
 * shop's settings through GET/PUT /shopify/settings (the values the web console also uses), and
 * every word comes from the catalogue the web console shares (@curtain/schema, D21).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_NOTICE_TEXT, SHOP_SETTINGS_TEXT, chartTemplatesDto, heldNowText, productNoticeLines, type ProductNoticeFacts } from '@curtain/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAdminPage } from './admin';
import { API_KEY } from './test/fixtures';

const template = readFileSync(join(process.cwd(), 'admin', 'index.html'), 'utf8');
interface El {
  id: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  textContent: string | null;
  classList: { contains(c: string): boolean };
  getAttribute(name: string): string | null;
  append(...nodes: El[]): void;
  click(): void;
  focus(): void;
  dispatchEvent(e: unknown): boolean;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): ArrayLike<El>;
}
interface Dom {
  document: { head: El & { innerHTML: string }; body: El & { innerHTML: string }; activeElement: El | null; createElement(tag: string): El & { type: string }; getElementById(id: string): El | null; querySelector(sel: string): El | null; querySelectorAll(sel: string): ArrayLike<El> };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  window: { shopify?: unknown };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
}
const { document, history, window, Event } = globalThis as unknown as Dom;
const $ = (id: string) => document.getElementById(id)!;
const ST = SHOP_SETTINGS_TEXT;
const NT = PRODUCT_NOTICE_TEXT;

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}
type Product = ProductNoticeFacts & { externalId: string; name: string; next?: { key: string; badge: string; tone: string; text: string; action?: string } };

const product = (p: Product) => ({ category: 'dress', score: 0.8, adviceScore: 80, missingFields: [], flatLayProcessedUrl: null, updatedAt: '2026-11-20T00:00:00.000Z', ...p });
const productsAnswer = (items: Product[]) => ({ items: items.map(product), nextCursor: null, counts: { active: items.filter((p) => p.status === 'active').length, incomplete: items.filter((p) => p.status === 'incomplete').length, archived: 0 } });
const SETTINGS = { incompleteProductData: 'let-through', showFitByCurtain: true, shopName: 'Boho Hippy Chic', platform: 'shopify', brandColor: null, logoUrl: null };

const DEFAULTS: Record<string, (c: Call) => unknown> = {
  'POST /shopify/token-exchange': () => ({ shopId: '00000000-0000-4000-8000-000000000000', shopDomain: 'bohohippychic.myshopify.com', publicKeyPrefix: 'pk_' + 'test_abc', scope: 'read_products', backfillQueued: false }),
  'GET /v1/merchant/usage': () => ({ from: '', to: '', days: [], totals: { fitSessions: 0, heroRenders: 0, costUsd: 0 }, plan: { name: 'free', includedSessions: 0, overageEurPerSession: 0.05, periodStart: '', periodEnd: '', sessionsUsedThisPeriod: 0, paused: false } }),
  'GET /v1/merchant/products': () => productsAnswer([{ externalId: '301', name: 'Boho Kaftan', status: 'active', notices: { defaulted: [], leftOut: [] } }]),
  'GET /v1/merchant/ledger': () => ({ entries: [], nextCursor: null }),
  'GET /v1/merchant/charts/templates': () => chartTemplatesDto(),
  'GET /shopify/charts/onboarding': () => ({ steps: [], next: null, headline: '', doneCount: 0, total: 5, platform: 'shopify', measureProduct: null, phoneCheck: null, state: { templateId: null, themeBlockConfirmed: false, tested: false } }),
  'GET /shopify/settings': () => SETTINGS,
};

function mountPage(routes: Record<string, (c: Call) => unknown>): Call[] {
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
  window.shopify = { config: { shop: 'bohohippychic.myshopify.com' }, idToken: async () => 'session-token', resourcePicker: async () => undefined };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      const u = new URL(url);
      const call: Call = { method: init.method, path: u.pathname, body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null, auth: init.headers.authorization ?? null };
      calls.push(call);
      const key = `${init.method} ${u.pathname}`;
      const h = routes[key] ?? DEFAULTS[key];
      if (!h) return new Response(JSON.stringify({ error: { code: 'nope', message: `unmocked ${key}` } }), { status: 404 });
      const r = (await h(call)) as { __status?: number; body?: unknown } | null;
      if (r && typeof r === 'object' && typeof r.__status === 'number') return new Response(JSON.stringify(r.body), { status: r.__status });
      return new Response(JSON.stringify(r), { status: 200 });
    }),
  );
  new Function(script)();
  return calls;
}

afterEach(() => {
  delete window.shopify;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const policy = (p: string) => $(`settings-policy-${p}`);
const choose = (el: El, checked = true) => {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const ready = () => vi.waitFor(() => expect($('settings-body').classList.contains('hidden')).toBe(false));
const settingsCalls = (calls: Call[], method: string) => calls.filter((c) => c.path === '/shopify/settings' && c.method === method);

describe('admin page: Settings section', () => {
  it('shows the two settings in the web console’s words, read from /shopify/settings with the session token', async () => {
    const calls = mountPage({});
    await ready();
    expect(settingsCalls(calls, 'GET')).toEqual([{ method: 'GET', path: '/shopify/settings', body: null, auth: 'Bearer session-token' }]);
    expect($('h-settings').textContent).toBe(ST.title);
    expect($('settings-intro').textContent).toBe(ST.introSavedAtOnce);
    expect($('settings-incomplete-h').textContent).toBe(ST.incomplete.title);
    expect($('settings-incomplete-intro').textContent).toBe(ST.incomplete.intro);

    // Two plain choices, "show size advice anyway" chosen and marked as the standard one.
    const radios = Array.from($('settings-choices').querySelectorAll('input[type="radio"]'));
    expect(radios.map((r) => r.value)).toEqual(['let-through', 'hold-back']);
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    expect(document.querySelector('label[for="settings-policy-let-through"]')!.textContent).toBe(`${ST.incomplete.choices['let-through'].label} ${ST.incomplete.defaultMark}`);
    expect(document.querySelector('label[for="settings-policy-hold-back"]')!.textContent).toBe(ST.incomplete.choices['hold-back'].label);
    for (const r of radios) expect($(r.getAttribute('aria-describedby')!).textContent).toBe(ST.incomplete.choices[r.value as 'let-through' | 'hold-back'].text);

    // The switch: on, a real switch for assistive technology, and its text says the Estimate labels stay (rule 3).
    const mark = $('settings-wordmark');
    expect(mark.checked).toBe(true);
    expect(mark.getAttribute('role')).toBe('switch');
    expect(mark.getAttribute('aria-checked')).toBe('true');
    expect($('settings-popup-h').textContent).toBe(ST.popup.title);
    expect(document.querySelector('label[for="settings-wordmark"]')!.textContent).toBe(ST.popup.wordmark);
    expect($(mark.getAttribute('aria-describedby')!).textContent).toBe(ST.popup.wordmarkText);
    expect(ST.popup.wordmarkText).toMatch(/“Estimate” labels .* always stay/);
    expect($('settings-status').textContent).toBe('');
    expect($('settings-held-now').classList.contains('hidden')).toBe(true);
    expect($('banner').classList.contains('show')).toBe(false);
  });

  it('shows what is stored: hold back chosen and the wordmark off', async () => {
    mountPage({ 'GET /shopify/settings': () => ({ ...SETTINGS, incompleteProductData: 'hold-back', showFitByCurtain: false }) });
    await ready();
    expect(policy('hold-back').checked).toBe(true);
    expect(policy('let-through').checked).toBe(false);
    expect($('settings-wordmark').checked).toBe(false);
    expect($('settings-wordmark').getAttribute('aria-checked')).toBe('false');
  });

  it('choosing "hold back" saves that one key, says Saving then Saved, and reloads the product list', async () => {
    let stored = 'let-through';
    let release: (() => void) | null = null;
    const held: Product = { externalId: '301', name: 'Boho Kaftan', status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] }, notices: { defaulted: [], leftOut: [] } };
    const calls = mountPage({
      'GET /v1/merchant/products': () => productsAnswer(stored === 'hold-back' ? [held, { ...held, externalId: '302', name: 'Sun Dress' }] : [{ externalId: '301', name: 'Boho Kaftan', status: 'active', notices: { defaulted: ['fabric.stretchPct'], leftOut: [] } }]),
      'PUT /shopify/settings': async (c) => {
        await new Promise<void>((r) => (release = r));
        stored = String(c.body!.incompleteProductData);
        return { ...SETTINGS, incompleteProductData: stored };
      },
    });
    await ready();
    await vi.waitFor(() => expect(document.querySelector('[data-notices="301"]')).not.toBeNull());
    const productLoads = () => calls.filter((c) => c.path === '/v1/merchant/products').length;
    const before = productLoads();

    choose(policy('hold-back'));
    await vi.waitFor(() => expect(release).not.toBeNull());
    expect($('settings-status').textContent).toBe(ST.saving);
    expect(policy('hold-back').disabled).toBe(true);
    expect($('settings-wordmark').disabled).toBe(true);
    release!();
    await vi.waitFor(() => expect($('settings-status').textContent).toBe(ST.saved));
    expect(settingsCalls(calls, 'PUT')).toEqual([{ method: 'PUT', path: '/shopify/settings', body: { incompleteProductData: 'hold-back' }, auth: 'Bearer session-token' }]);
    expect(policy('hold-back').checked).toBe(true);
    expect(policy('hold-back').disabled).toBe(false);

    await vi.waitFor(() => expect(productLoads()).toBe(before + 1));
    await vi.waitFor(() => expect($('settings-held-now').textContent).toBe(heldNowText(2)));
    expect($('settings-held-now').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-notices="301"] [data-notice="held-back"]')).not.toBeNull();
  });

  it('the switch saves showFitByCurtain and nothing else; it does not reload the products', async () => {
    const calls = mountPage({ 'PUT /shopify/settings': (c) => ({ ...SETTINGS, ...c.body }) });
    await ready();
    await vi.waitFor(() => expect($('products-body').textContent).toContain('Boho Kaftan'));
    const loads = calls.filter((c) => c.path === '/v1/merchant/products').length;
    choose($('settings-wordmark'), false);
    await vi.waitFor(() => expect($('settings-status').textContent).toBe(ST.saved));
    expect(settingsCalls(calls, 'PUT').map((c) => c.body)).toEqual([{ showFitByCurtain: false }]);
    expect($('settings-wordmark').checked).toBe(false);
    expect($('settings-wordmark').getAttribute('aria-checked')).toBe('false');
    expect(policy('let-through').checked).toBe(true);
    choose($('settings-wordmark'), true);
    await vi.waitFor(() => expect(settingsCalls(calls, 'PUT')).toHaveLength(2));
    expect(settingsCalls(calls, 'PUT')[1]!.body).toEqual({ showFitByCurtain: true });
    expect(calls.filter((c) => c.path === '/v1/merchant/products').length).toBe(loads);
  });

  it('a save that fails says so and puts the controls back to what is stored', async () => {
    mountPage({ 'PUT /shopify/settings': () => ({ __status: 500, body: { error: { code: 'internal', message: 'boom' } } }) });
    await ready();
    choose(policy('hold-back'));
    await vi.waitFor(() => expect($('settings-status').textContent).toBe(ST.failed));
    expect($('settings-status').classList.contains('bad')).toBe(true);
    expect(policy('let-through').checked).toBe(true);
    expect(policy('hold-back').checked).toBe(false);
    expect(policy('hold-back').disabled).toBe(false);
    choose($('settings-wordmark'), false);
    await vi.waitFor(() => expect($('settings-wordmark').disabled).toBe(false));
    expect($('settings-wordmark').checked).toBe(true);
    // No HTTP code or server text in front of the shop owner.
    expect($('settings').textContent).not.toMatch(/boom|500/);
  });

  it('keeps the keyboard focus on the choice after a save', async () => {
    mountPage({ 'PUT /shopify/settings': (c) => ({ ...SETTINGS, ...c.body }) });
    await ready();
    policy('hold-back').focus();
    choose(policy('hold-back'));
    await vi.waitFor(() => expect($('settings-status').textContent).toBe(ST.saved));
    expect(document.activeElement?.id).toBe('settings-policy-hold-back');
  });

  it('when the settings cannot be read, the section says so and the rest of the page still loads', async () => {
    mountPage({ 'GET /shopify/settings': () => ({ __status: 502, body: { error: { code: 'shopify_error', message: 'x' } } }) });
    await vi.waitFor(() => expect($('settings-status').textContent).toBe(ST.unavailable));
    expect($('settings-body').classList.contains('hidden')).toBe(true);
    expect($('settings-loading').classList.contains('hidden')).toBe(true);
    await vi.waitFor(() => expect($('products-body').textContent).toContain('Boho Kaftan'));
  });

  it('an older api that does not send the switch: the wordmark is shown as on', async () => {
    mountPage({ 'GET /shopify/settings': () => ({ incompleteProductData: 'let-through' }) });
    await ready();
    expect($('settings-wordmark').checked).toBe(true);
  });

  it('writes none of these words in the page itself: they come from the shared catalogue (D21)', () => {
    for (const words of [ST.title + '<', ST.incomplete.title, ST.incomplete.choices['let-through'].label, ST.incomplete.choices['hold-back'].label, ST.popup.wordmark, ST.saved, NT.heldBack, NT.heldBackSetting, NT.heldBackNext, NT.stretchAssumed, 'The rest of the fabric was kept', 'Held back by your setting']) {
      expect(template, words).not.toContain(words);
    }
  });
});

describe('admin page: fabric notices in the product list', () => {
  const VALIDATOR = 'Too big: expected number to be <=100';
  const CASES: Product[] = [
    { externalId: '1', name: 'Complete', status: 'active', notices: { defaulted: [], leftOut: [] } },
    { externalId: '2', name: 'No notices field', status: 'active' },
    { externalId: '3', name: 'Stretch left out', status: 'active', notices: { defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.stretchPct', reason: VALIDATOR }] } },
    { externalId: '4', name: 'No stretch given', status: 'active', notices: { defaulted: ['fabric.stretchPct', 'fabric.drape'], leftOut: [] } },
    { externalId: '5', name: 'Drape and unknown left out', status: 'active', notices: { defaulted: [], leftOut: [{ field: 'fabric.drape', reason: VALIDATOR }, { field: 'fabric.future', reason: VALIDATOR }, { field: 'constructor', reason: VALIDATOR }] } },
    { externalId: '6', name: 'Held back', status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct', 'fabric.drape'] }, notices: { defaulted: [], leftOut: [{ field: 'fabric.stretchPct', reason: VALIDATOR }] }, next: { key: 'chart', badge: 'Not ready yet', tone: 'critical', text: 'Add a size chart.', action: 'Add a size chart' } },
    { externalId: '7', name: 'Not ready, stretch missing', status: 'incomplete', notices: { defaulted: ['fabric.stretchPct'], leftOut: [] } },
    { externalId: '8', name: 'Every fabric part left out', status: 'active', notices: { defaulted: [], leftOut: Object.keys(NT.fabricRule).map((field) => ({ field, reason: VALIDATOR })) } },
  ];
  const mountCases = async () => {
    mountPage({ 'GET /v1/merchant/products': () => productsAnswer(CASES) });
    await vi.waitFor(() => expect($('products-body').querySelectorAll('tr').length).toBe(CASES.length));
  };
  const row = (p: Product) => Array.from($('products-body').querySelectorAll('tr')).find((tr) => tr.querySelector('b')!.textContent === p.name)!;
  const lines = (p: Product, kind: string) => Array.from(row(p).querySelectorAll(`[data-notice="${kind}"]`)).map((li) => li.textContent);

  it('says exactly what the web console says for every case (productNoticeLines of @curtain/schema)', async () => {
    await mountCases();
    for (const p of CASES) {
      const want = productNoticeLines(p);
      expect(lines(p, 'held-back'), p.name).toEqual(want.heldBack ? [`${want.heldBack} ${NT.heldBackSetting}`] : []);
      expect(lines(p, 'left-out'), p.name).toEqual(want.leftOut.map((l) => l.text));
      expect(lines(p, 'stretch-assumed'), p.name).toEqual(want.stretchAssumed ? [want.stretchAssumed] : []);
      const any = want.heldBack !== null || want.leftOut.length > 0 || want.stretchAssumed !== null;
      expect(row(p).querySelector('[data-notices]') !== null, p.name).toBe(any);
    }
    // The cases cover each kind of line at least once.
    expect(lines(CASES[2]!, 'left-out')[0]).toContain('so size advice assumes the fabric does not stretch');
    expect(lines(CASES[3]!, 'stretch-assumed')).toEqual([NT.stretchAssumed]);
    expect(lines(CASES[4]!, 'left-out')).toHaveLength(3);
    expect(lines(CASES[7]!, 'left-out')).toHaveLength(Object.keys(NT.fabricRule).length);
  });

  it('never shows the api’s own validator message', async () => {
    await mountCases();
    expect($('products-body').textContent).not.toContain('Too big');
  });

  it('a held-back product: the chip, what to add, the short next step, a link to the setting, and no misleading action', async () => {
    await mountCases();
    const held = row(CASES[5]!);
    expect(held.querySelector('.badge')!.textContent).toBe(NT.heldBack);
    expect(held.querySelector('.badge')!.classList.contains('badge-critical')).toBe(true);
    expect(held.querySelector('[data-notice="held-back"]')!.textContent).toContain('until you add or correct the fabric stretch and the drape.');
    expect(held.querySelector('.next-cell')!.textContent).toBe(NT.heldBackNext);
    expect(held.querySelector('.next-cell button')).toBeNull();
    const link = held.querySelector('[data-notice="held-back"] a')!;
    expect(link.textContent).toBe(NT.heldBackSetting);
    expect(link.getAttribute('href')).toBe('#settings');
    link.click();
    expect(document.activeElement?.id).toBe('h-settings');
    expect($('settings-held-now').textContent).toBe(heldNowText(1));
    // A product that is not held back keeps the api's own badge and next step.
    expect(row(CASES[0]!).querySelector('.badge')!.textContent).toBe('Ready');
  });
});

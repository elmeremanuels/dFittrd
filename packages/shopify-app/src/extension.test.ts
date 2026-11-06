/**
 * Static checks on the theme app extension: the Liquid block, snippet, locales and the schema
 * contract with the SDK (data attributes, no secrets, disclaimer wording).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { BLOCK_HANDLE, EXTENSION_HANDLE } from './deepLinks';

const root = new URL('../extensions/try-button/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const block = read(`blocks/${BLOCK_HANDLE}.liquid`);
const snippet = read('snippets/curtain-try-button.liquid');

function flattenKeys(o: unknown, prefix = ''): string[] {
  if (typeof o !== 'object' || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe('theme app extension', () => {
  it('shopify.extension.toml is a theme extension with the documented handle', () => {
    const toml = parse(read('shopify.extension.toml')) as Record<string, unknown>;
    expect(toml.type).toBe('theme');
    expect(toml.handle).toBe(EXTENSION_HANDLE);
    expect(typeof toml.name).toBe('string');
  });

  it('block schema: app block (target content), product template only, documented settings', () => {
    const schema = JSON.parse(/{% schema %}([\s\S]*?){% endschema %}/.exec(block)![1]!) as { target: string; enabled_on: { templates: string[] }; settings: Array<{ id?: string; type: string; default?: unknown }>; stylesheet: string; javascript?: string };
    expect(schema.target).toBe('content');
    expect(schema.enabled_on).toEqual({ templates: ['product'] });
    expect(schema.stylesheet).toBe('curtain-try.css');
    expect(schema.javascript).toBeUndefined(); // we load the SDK ourselves so data-shop/data-api are set
    const ids = schema.settings.map((s) => s.id).filter(Boolean);
    expect(ids).toEqual(['label', 'alignment', 'mode', 'size_option', 'show_hint', 'show_size', 'unstyled', 'shop_key', 'api_url']);
    const mode = schema.settings.find((s) => s.id === 'mode') as unknown as { options: Array<{ value: string; label: string }>; default: string };
    // STANDALONE.md §3: standalone (embed) is the default, the Curtain app is opt-in.
    expect(mode.options.map((o) => o.value)).toEqual(['embed', 'app']);
    expect(mode.default).toBe('embed');
    const sizeOption = schema.settings.find((s) => s.id === 'size_option') as unknown as { type: string; default: string };
    expect(sizeOption.type).toBe('text');
    expect(sizeOption.default).toBe('Size');
  });

  it('renders data-mode (embed unless the merchant chose app) and data-size-option (default Size)', () => {
    expect(block).toContain("setAttribute('data-mode', {{ pk_mode | json }})");
    expect(block).toContain("setAttribute('data-size-option', {{ pk_size_option | json }})");
    expect(block).toMatch(/if pk_mode != 'app'\s+assign pk_mode = 'embed'/);
    expect(block).toMatch(/if pk_size_option == blank\s+assign pk_size_option = 'Size'/);
    // the old app-only values are gone from the block
    expect(block).not.toMatch(/"value": "(auto|redirect|modal)"/);
  });

  it('size peek: "Show the shopper\'s size" setting (default on) renders data-peek, data-app and the per-button opt-out', () => {
    const schema = JSON.parse(/{% schema %}([\s\S]*?){% endschema %}/.exec(block)![1]!) as { settings: Array<{ id?: string; type: string; default?: unknown }> };
    const showSize = schema.settings.find((s) => s.id === 'show_size')!;
    expect(showSize.type).toBe('checkbox');
    expect(showSize.default).toBe(true);
    expect(block).toMatch(/assign pk_peek = 'on'\s+if block\.settings\.show_size == false or pk_mode == 'app'\s+assign pk_peek = 'off'/);
    expect(block).toContain("setAttribute('data-peek', {{ pk_peek | json }})");
    expect(block).toContain("setAttribute('data-app', {{ pk_app_url | json }})");
    expect(block).toContain('app.metafields.curtain.app_url');
    expect(block).toContain("replace_first: '//api.', '//app.'");
    expect(block).toContain('peek: pk_peek');
    expect(snippet).toContain(`{%- if peek == 'off' %} data-curtain-peek="off"{% endif %}`);
    type S = { curtain: { settings: { show_size: Record<string, string> } } };
    const enS = JSON.parse(read('locales/en.default.schema.json')) as S;
    const nlS = JSON.parse(read('locales/nl.schema.json')) as S;
    expect(enS.curtain.settings.show_size.label).toBe("Show the shopper's size on product pages");
    expect(enS.curtain.settings.show_size.info).toMatch(/cannot read/);
    expect(nlS.curtain.settings.show_size.label).toMatch(/maat van de shopper/);
  });

  it('locales: Experience + Size option name settings in en and nl', () => {
    type S = { curtain: { settings: { mode: Record<string, string>; size_option: Record<string, string> } } };
    const enS = JSON.parse(read('locales/en.default.schema.json')) as S;
    const nlS = JSON.parse(read('locales/nl.schema.json')) as S;
    expect(enS.curtain.settings.mode.label).toBe('Experience');
    expect(enS.curtain.settings.mode.embed).toBe('On the product page (no app needed)');
    expect(enS.curtain.settings.mode.app).toBe('Curtain app');
    expect(enS.curtain.settings.size_option.label).toBe('Size option name');
    expect(nlS.curtain.settings.mode.embed).toMatch(/geen app/i);
    expect(nlS.curtain.settings.size_option.label).toMatch(/maat/i);
  });

  it('hint: standalone wording by default, app wording only in app mode', () => {
    const en = JSON.parse(read('locales/en.default.json')) as { curtain: { try_button: Record<string, string> } };
    expect(en.curtain.try_button.hint).toMatch(/this device/i);
    expect(en.curtain.try_button.hint).not.toMatch(/app/i);
    expect(en.curtain.try_button.hint_app).toMatch(/Curtain app/);
    expect(snippet).toContain("assign pk_hint_key = 'curtain.try_button.hint'");
    expect(snippet).toContain("assign pk_hint_key = 'curtain.try_button.hint_app'");
    expect(snippet).toContain('{{ pk_hint_key | t }}');
  });

  it('renders the SDK contract: data-curtain-product={{ product.id }}, asset_url sdk.v1.js, data-shop + data-api, single load guard', () => {
    expect(snippet).toContain('data-curtain-product="{{ product.id }}"');
    expect(snippet).toContain('type="button"');
    expect(block).toMatch(/\{%-? render 'curtain-try-button'/);
    expect(block).toContain("{{ 'sdk.v1.js' | asset_url | json }}");
    expect(block).toContain("setAttribute('data-shop'");
    expect(block).toContain("setAttribute('data-api'");
    expect(block).toContain("setAttribute('data-locale'");
    expect(block).toContain("document.querySelector('script[data-shop][data-curtain-sdk]')");
    expect(block).toContain('app.metafields.curtain.public_key');
    expect(block).toContain('app.metafields.curtain.api_url');
    expect(block).toContain('{{ block.shopify_attributes }}');
    expect(block).toContain('request.design_mode');
  });

  it('never references a secret key, an external origin or storage', () => {
    for (const f of [block, snippet, read('assets/curtain-try.css')]) {
      expect(f).not.toMatch(/sk_(live|test)_/);
      expect(f).not.toMatch(/https?:\/\//);
      expect(f).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });

  it('locales: en.default + nl, same keys, estimate wording, D1 button copy', () => {
    const files = readdirSync(new URL('locales/', root)).sort();
    expect(files).toEqual(['en.default.json', 'en.default.schema.json', 'nl.json', 'nl.schema.json']);
    const en = JSON.parse(read('locales/en.default.json')) as { curtain: { try_button: Record<string, string> } };
    const nl = JSON.parse(read('locales/nl.json')) as { curtain: { try_button: Record<string, string> } };
    expect(flattenKeys(nl)).toEqual(flattenKeys(en));
    expect(en.curtain.try_button.label).toBe('Try it on');
    expect(nl.curtain.try_button.label).toBe('Try it on');
    expect(en.curtain.try_button.hint).toMatch(/estimate/i);
    expect(nl.curtain.try_button.hint).toMatch(/schatting/i);

    const enS = JSON.parse(read('locales/en.default.schema.json'));
    const nlS = JSON.parse(read('locales/nl.schema.json'));
    expect(flattenKeys(nlS)).toEqual(flattenKeys(enS));
    // every t: key used by the schema exists in the schema locale
    const keys = flattenKeys(enS);
    for (const m of block.matchAll(/"t:([a-z0-9_.]+)"/g)) expect(keys).toContain(m[1]!);
    // every | t key used by Liquid exists in the storefront locale
    const sf = flattenKeys(en);
    for (const m of [...block.matchAll(/'([a-z0-9_.]+)' \| t/g), ...snippet.matchAll(/'([a-z0-9_.]+)' \| t/g)]) expect(sf).toContain(m[1]!);
  });
});

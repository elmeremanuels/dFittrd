import { SHOPIFY_METAFIELD_DEFINITIONS, toShopifyMetafields, mockGarment } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { createAdminClient } from './graphql/client';
import { appDataMetafieldInputs, metafieldsSet, setAppDataMetafields, setProductMetafields, APP_DATA_NAMESPACE } from './graphql/metafields';
import {
  ensureMetafieldDefinitions,
  HEAVY_METAFIELD_KEYS,
  listMetafieldDefinitions,
  METAFIELD_DEFINITION_INPUTS,
  METAFIELD_KEYS,
  metafieldDefinitionInput,
  missingDefinitionKeys,
} from './metafieldDefinitions';
import { ACCESS_TOKEN, PRODUCT_GID, PRODUCT_ID, SHOP, fetchMock } from './test/fixtures';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

/** Contract 9 (schema): the exact key set of the `$app:curtain` namespace. */
const CONTRACT_KEYS = [
  'size_chart_type',
  'size_chart',
  'fabric',
  'flat_lay_photo',
  'category',
  'pattern_block',
  'ease',
  'length_cm',
  'sizing_notes',
  'true_to_size_score',
  'critical_fit_points',
  'stretch_zones',
  'style_tags',
  'primary_color_hex',
  'colorways',
  'subcategory',
  'brand',
];

describe('metafield definitions', () => {
  it('mirror the schema contract exactly (keys, namespace, owner, pin)', () => {
    expect([...METAFIELD_KEYS].sort()).toEqual([...CONTRACT_KEYS].sort());
    expect(METAFIELD_DEFINITION_INPUTS).toHaveLength(SHOPIFY_METAFIELD_DEFINITIONS.length);
    for (const input of METAFIELD_DEFINITION_INPUTS) {
      expect(input.namespace).toBe('$app:curtain');
      expect(input.ownerType).toBe('PRODUCT');
      expect(input.access).toEqual({ admin: 'MERCHANT_READ_WRITE', storefront: 'NONE' });
      expect(typeof input.pin).toBe('boolean');
    }
    expect([...HEAVY_METAFIELD_KEYS].sort()).toEqual(['category', 'fabric', 'flat_lay_photo', 'size_chart', 'size_chart_type']);
  });

  it('adds Shopify-side validations for the closed vocabularies', () => {
    const sct = metafieldDefinitionInput(SHOPIFY_METAFIELD_DEFINITIONS.find((d) => d.key === 'size_chart_type')!);
    expect(sct.validations).toEqual([{ name: 'choices', value: '["garment","body"]' }]);
    const tts = metafieldDefinitionInput(SHOPIFY_METAFIELD_DEFINITIONS.find((d) => d.key === 'true_to_size_score')!);
    expect(tts.validations).toEqual([
      { name: 'min', value: '0' },
      { name: 'max', value: '1' },
    ]);
    const fabric = metafieldDefinitionInput(SHOPIFY_METAFIELD_DEFINITIONS.find((d) => d.key === 'fabric')!);
    expect(fabric.validations).toBeUndefined();
  });

  it('ensureMetafieldDefinitions treats TAKEN as existing and aborts on other errors', async () => {
    const m = fetchMock().reply((call) => {
      const key = (call.body as { variables: { definition: { key: string } } }).variables.definition.key;
      if (key === 'size_chart') return { json: { data: { metafieldDefinitionCreate: { createdDefinition: null, userErrors: [{ field: ['definition', 'key'], message: 'Key is in use', code: 'TAKEN' }] } } } };
      return { json: { data: { metafieldDefinitionCreate: { createdDefinition: { id: `gid://shopify/MetafieldDefinition/${key}`, key }, userErrors: [] } } } };
    });
    const r = await ensureMetafieldDefinitions(client(m));
    expect(r.existing).toEqual(['size_chart']);
    expect(r.created).toHaveLength(SHOPIFY_METAFIELD_DEFINITIONS.length - 1);
    expect(m.calls).toHaveLength(SHOPIFY_METAFIELD_DEFINITIONS.length);

    const bad = fetchMock().reply({ json: { data: { metafieldDefinitionCreate: { createdDefinition: null, userErrors: [{ message: 'Access denied', code: 'INVALID' }] } } } });
    await expect(ensureMetafieldDefinitions(client(bad))).rejects.toThrow(/metafield definition size_chart_type: Access denied/);
  });

  it('listMetafieldDefinitions pages and missingDefinitionKeys reports drift', async () => {
    const m = fetchMock().data(
      { metafieldDefinitions: { pageInfo: { hasNextPage: true, endCursor: 'x' }, nodes: [{ id: '1', key: 'fabric', name: 'Fabric', type: { name: 'json' }, pinnedPosition: 1 }] } },
      { metafieldDefinitions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: '2', key: 'size_chart', name: 'Size chart', type: { name: 'json' }, pinnedPosition: null }] } },
    );
    const defs = await listMetafieldDefinitions(client(m));
    expect(defs.map((d) => d.key)).toEqual(['fabric', 'size_chart']);
    expect(defs[0]!.pinned).toBe(true);
    const missing = missingDefinitionKeys(defs);
    expect(missing).toHaveLength(METAFIELD_KEYS.length - 2);
    expect(missing).not.toContain('fabric');
  });
});

describe('metafieldsSet', () => {
  it('writes a full garment payload back as $app:curtain metafields', async () => {
    const m = fetchMock().reply((call) => {
      const mfs = (call.body as { variables: { metafields: Array<{ key: string; namespace: string; ownerType?: string }> } }).variables.metafields;
      return { json: { data: { metafieldsSet: { metafields: mfs.map((x) => ({ id: `gid://shopify/Metafield/${x.key}`, key: x.key, namespace: x.namespace, ownerType: 'PRODUCT' })), userErrors: [] } } } };
    });
    const r = await setProductMetafields(client(m), PRODUCT_ID, mockGarment('aalter-studio-1'));
    const expected = toShopifyMetafields(mockGarment('aalter-studio-1'), PRODUCT_GID);
    expect(r.metafields.map((x) => x.key)).toEqual(expected.map((x) => x.key));
    const sent = m.variables<{ metafields: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> }>().metafields;
    expect(sent.every((x) => x.ownerId === PRODUCT_GID && x.namespace === '$app:curtain')).toBe(true);
    expect(JSON.parse(sent.find((x) => x.key === 'size_chart')!.value)).toHaveLength(4);
    expect(sent.find((x) => x.key === 'size_chart_type')!.value).toBe('body');
  });

  it('batches more than 25 inputs and surfaces userErrors', async () => {
    const m = fetchMock().reply({ json: { data: { metafieldsSet: { metafields: [], userErrors: [] } } } });
    const inputs = Array.from({ length: 30 }, (_, i) => ({ ownerId: PRODUCT_GID, namespace: 'curtain', key: `k${i}`, type: 'single_line_text_field', value: 'v' }));
    await metafieldsSet(client(m), inputs);
    expect(m.calls).toHaveLength(2);
    expect(m.variables<{ metafields: unknown[] }>(0).metafields).toHaveLength(25);
    expect(m.variables<{ metafields: unknown[] }>(1).metafields).toHaveLength(5);

    const bad = fetchMock().reply({ json: { data: { metafieldsSet: { metafields: [], userErrors: [{ field: ['metafields', '0', 'value'], message: 'Value is invalid JSON', code: 'INVALID_VALUE' }] } } } });
    await expect(metafieldsSet(client(bad), inputs.slice(0, 1))).rejects.toThrow(/metafieldsSet: metafields.0.value: Value is invalid JSON/);
  });

  it('app-data metafields carry only the public key and origins, never a secret', async () => {
    expect(() => appDataMetafieldInputs('gid://shopify/AppInstallation/1', { publicKeyPrefix: 'sk_' + 'live_abcdefghijkl', apiUrl: 'https://api.curtain.fit' })).toThrow(/never sk_/);
    const inputs = appDataMetafieldInputs('gid://shopify/AppInstallation/1', { publicKeyPrefix: 'pk_' + 'live_abcdefghijkl', apiUrl: 'https://api.curtain.fit', appUrl: 'https://app.curtain.fit' });
    expect(inputs.map((i) => [i.namespace, i.key, i.type])).toEqual([
      [APP_DATA_NAMESPACE, 'public_key', 'single_line_text_field'],
      [APP_DATA_NAMESPACE, 'api_url', 'url'],
      [APP_DATA_NAMESPACE, 'app_url', 'url'],
    ]);

    const m = fetchMock().data({ currentAppInstallation: { id: 'gid://shopify/AppInstallation/77' } }, { metafieldsSet: { metafields: [{ id: 'm1', key: 'public_key', namespace: 'curtain', ownerType: 'APP_INSTALLATION' }], userErrors: [] } });
    const r = await setAppDataMetafields(client(m), { publicKeyPrefix: 'pk_' + 'test_abcdefghijkl', apiUrl: 'https://api.curtain.test' });
    expect(r.metafields[0]!.ownerType).toBe('APP_INSTALLATION');
    expect(m.variables<{ metafields: Array<{ ownerId: string }> }>(1).metafields[0]!.ownerId).toBe('gid://shopify/AppInstallation/77');
  });
});

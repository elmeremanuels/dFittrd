import { describe, expect, it } from 'vitest';
import { adminAppUrl, adminProductUrl, BLOCK_HANDLE, customInstallUrl, EXTENSION_HANDLE, themeEditorAddBlockUrl } from './deepLinks';
import { API_KEY, PRODUCT_GID, PRODUCT_ID, SHOP } from './test/fixtures';

describe('deep links', () => {
  it('theme editor link pre-adds the block to the product template', () => {
    const url = themeEditorAddBlockUrl({ shopDomain: SHOP, apiKey: API_KEY });
    expect(url).toBe(`https://${SHOP}/admin/themes/current/editor?template=product&addAppBlockId=${API_KEY}%2F${BLOCK_HANDLE}&target=mainSection`);
    expect(themeEditorAddBlockUrl({ shopDomain: SHOP, apiKey: API_KEY, template: 'index', target: 'newAppsSection' })).toContain('template=index&');
    expect(themeEditorAddBlockUrl({ shopDomain: SHOP, apiKey: API_KEY, target: 'sectionGroup:footer' })).toContain('target=sectionGroup%3Afooter');
    expect(BLOCK_HANDLE).toBe('try-it-on');
    expect(EXTENSION_HANDLE).toBe('try-button');
  });

  it('product and app urls', () => {
    expect(adminProductUrl(SHOP, PRODUCT_ID)).toBe(`https://${SHOP}/admin/products/${PRODUCT_ID}`);
    expect(adminProductUrl(SHOP, PRODUCT_GID)).toBe(`https://${SHOP}/admin/products/${PRODUCT_ID}`);
    expect(() => adminProductUrl(SHOP, '../x')).toThrow(/not a Shopify product id/);
    expect(adminAppUrl(SHOP, 'curtain')).toBe('https://admin.shopify.com/store/aalter-studio/apps/curtain');
    expect(customInstallUrl(SHOP, 'curtain')).toContain('https://admin.shopify.com/store/aalter-studio/oauth/install_custom_app?');
  });

  it('refuses non-Shopify hosts (no open redirects into the admin)', () => {
    expect(() => themeEditorAddBlockUrl({ shopDomain: 'evil.example', apiKey: API_KEY })).toThrow(/not a Shopify domain/);
    expect(() => adminAppUrl('evil.example/x', 'curtain')).toThrow(/not a Shopify domain/);
  });
});

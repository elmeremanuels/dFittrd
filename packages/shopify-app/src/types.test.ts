import { describe, expect, it } from 'vitest';
import { isShopifyDomain, normaliseShopDomain } from './types';

describe('shop domains', () => {
  it('normalises the forms App Bridge and merchants hand us', () => {
    expect(normaliseShopDomain('https://Aalter-Studio.myshopify.com/admin')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('aalter-studio.myshopify.com/')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('aalter-studio')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('  ')).toBeNull();
    expect(normaliseShopDomain('evil.example.com')).toBeNull();
    expect(normaliseShopDomain('x.myshopify.com.evil.example')).toBeNull();
    expect(normaliseShopDomain(undefined)).toBeNull();
  });

  it('isShopifyDomain is strict', () => {
    expect(isShopifyDomain('a.myshopify.com')).toBe(true);
    expect(isShopifyDomain('a.shopify.com')).toBe(true);
    expect(isShopifyDomain('A.myshopify.com')).toBe(false);
    expect(isShopifyDomain('-a.myshopify.com')).toBe(false);
    expect(isShopifyDomain('myshopify.com')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createParentChannel, envelope, originOf, parseParentMessage, resolveTargetOrigin } from '../protocol';

const SHOP = 'https://aalter-studio.example';
const allowed = [SHOP, 'https://aalter-studio.myshopify.com'];

describe('postMessage origin rules', () => {
  it('posts only to an allowed origin reported by the browser', () => {
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: `${SHOP}/products/linen?variant=2`, framed: true })).toBe(SHOP);
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: '', ancestorOrigins: [SHOP], framed: true })).toBe(SHOP);
  });

  it('refuses a referrer that is not in the allowed list', () => {
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: 'https://evil.example/x', framed: true })).toBeNull();
    // a look-alike host or another scheme is not the same origin
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: 'https://aalter-studio.example.evil.io/', framed: true })).toBeNull();
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: 'http://aalter-studio.example/', framed: true })).toBeNull();
  });

  it('the direct parent (ancestorOrigins) wins over the referrer', () => {
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: `${SHOP}/`, ancestorOrigins: ['https://evil.example'], framed: true })).toBeNull();
  });

  it('never posts when not framed, without allowed origins, or without a referrer', () => {
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: `${SHOP}/`, framed: false })).toBeNull();
    expect(resolveTargetOrigin({ allowedOrigins: [], referrer: `${SHOP}/`, framed: true })).toBeNull();
    expect(resolveTargetOrigin({ allowedOrigins: allowed, referrer: '', framed: true })).toBeNull();
    expect(resolveTargetOrigin({ allowedOrigins: ['*'], referrer: `${SHOP}/`, framed: true })).toBeNull();
  });

  it('originOf strips path and query and rejects other schemes', () => {
    expect(originOf('https://a.example:8443/p?q=1#h')).toBe('https://a.example:8443');
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('the channel posts the envelope to the exact target origin, never "*"', () => {
    const parent = { postMessage: vi.fn() };
    const ch = createParentChannel(parent, SHOP);
    expect(ch.post({ type: 'curtain:size-selected', productExternalId: 'p1', size: 'M' })).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith({ source: 'curtain', v: 1, type: 'curtain:size-selected', productExternalId: 'p1', size: 'M' }, SHOP);
    const none = createParentChannel(parent, null);
    expect(none.canPost).toBe(false);
    expect(none.post({ type: 'curtain:close' })).toBe(false);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  it('accepts curtain:context only from the parent window and the target origin', () => {
    const parent = {};
    const data = { ...envelope({ type: 'curtain:ready' }), type: 'curtain:context', locale: 'nl-NL', currentVariantSize: 'M' };
    const ok = parseParentMessage({ data, origin: SHOP, source: parent as MessageEventSource }, { targetOrigin: SHOP, parent });
    expect(ok).toEqual({ locale: 'nl-NL', currentVariantSize: 'M' });
    expect(parseParentMessage({ data, origin: 'https://evil.example', source: parent as MessageEventSource }, { targetOrigin: SHOP, parent })).toBeNull();
    expect(parseParentMessage({ data, origin: SHOP, source: {} as MessageEventSource }, { targetOrigin: SHOP, parent })).toBeNull();
    expect(parseParentMessage({ data, origin: SHOP, source: parent as MessageEventSource }, { targetOrigin: null, parent })).toBeNull();
    expect(parseParentMessage({ data: { ...data, v: 2 }, origin: SHOP, source: parent as MessageEventSource }, { targetOrigin: SHOP, parent })).toBeNull();
    expect(parseParentMessage({ data: { ...data, source: 'other' }, origin: SHOP, source: parent as MessageEventSource }, { targetOrigin: SHOP, parent })).toBeNull();
    const long = parseParentMessage({ data: { ...data, currentVariantSize: 'x'.repeat(65), locale: 42 }, origin: SHOP, source: parent as MessageEventSource }, { targetOrigin: SHOP, parent });
    expect(long).toEqual({ locale: null, currentVariantSize: null });
  });
});

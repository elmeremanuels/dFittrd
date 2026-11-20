import { afterEach, describe, expect, it } from 'vitest';
import { assertServerOnly, isBrowserLike, ServerOnlyViolation } from './serverOnly.js';

describe('server-only guard (D3)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('passes in Node', () => {
    expect(isBrowserLike()).toBe(false);
    expect(() => assertServerOnly()).not.toThrow();
  });

  it('throws when a window global exists', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => assertServerOnly()).toThrow(ServerOnlyViolation);
  });

  it('throws when a document global exists', () => {
    (globalThis as { document?: unknown }).document = {};
    expect(() => assertServerOnly()).toThrow(/server-only/);
  });

  it('the package entry point runs the guard on import', async () => {
    (globalThis as { window?: unknown }).window = {};
    const entry = './index.js';
    await expect(import(/* @vite-ignore */ entry)).rejects.toBeInstanceOf(ServerOnlyViolation);
  });
});

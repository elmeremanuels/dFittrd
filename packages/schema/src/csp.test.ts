import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { disableSchemaJit, isBrowserScope } from './csp';

afterEach(() => {
  z.config({ jitless: false });
});

describe('zod JIT and the CSP', () => {
  it('disableSchemaJit turns the JIT off and parsing still works', () => {
    disableSchemaJit();
    expect(z.config().jitless).toBe(true);
    const s = z.object({ a: z.number(), b: z.object({ c: z.string() }) });
    expect(s.safeParse({ a: 1, b: { c: 'x' } }).success).toBe(true);
    expect(s.safeParse({ a: 1, b: { c: 2 } }).success).toBe(false);
  });

  it('applies in a page or a worker, not in node', () => {
    expect(isBrowserScope({ document: {} })).toBe(true);
    expect(isBrowserScope({ importScripts: () => undefined })).toBe(true);
    expect(isBrowserScope({})).toBe(false);
    expect(isBrowserScope()).toBe(false);
  });

  it('is the first module the package index exports', async () => {
    const { readFileSync } = await import('node:fs');
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(index.split('\n').find((l) => l.startsWith('export'))).toBe("export * from './csp';");
  });
});

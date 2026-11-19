import { z } from 'zod';

/**
 * zod's JIT for object schemas, off in browsers. When it builds a `z.object(...)` zod probes
 * `new Function('')` to decide whether it may compile a fast parser. The fitting room's
 * Content-Security-Policy has no 'unsafe-eval' (apps/web/config/csp.ts), so the browser refuses the
 * probe and files a violation report on every page load. zod catches the refusal and uses its
 * interpreted parser, which is what `jitless` selects, so parsing does not change: only the violation
 * goes. The probe runs when a schema is BUILT, i.e. while this package's modules load, so the switch
 * must run first: this module is the first one `index.ts` exports. Node (the api) keeps the JIT.
 */
export function disableSchemaJit(): void {
  z.config({ jitless: true });
}

/** A browser page or worker, where the CSP applies (node has neither global). */
export function isBrowserScope(g: { document?: unknown; importScripts?: unknown } = globalThis as never): boolean {
  return typeof g.document !== 'undefined' || typeof g.importScripts === 'function';
}

if (isBrowserScope()) disableSchemaJit();

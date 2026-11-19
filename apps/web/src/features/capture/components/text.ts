/**
 * Small helpers between the catalogue (`@/strings`, section `capture`) and the capture screens.
 * Page side only: nothing the scan worker bundles imports this file.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import { appStrings } from '../../../strings';
import { ScanError } from '../scanSession';

/**
 * A catalogue string with `{name}` marks in it, with an element put at each mark:
 * `fill('Scan says {scan}', { scan: <strong>88 cm</strong> })`. A mark with no element stays as text.
 */
export function fill(text: string, slots: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/(\{[A-Za-z]+\})/)
    .filter((piece) => piece !== '')
    .map((piece, i) => {
      const name = /^\{([A-Za-z]+)\}$/.exec(piece)?.[1];
      return createElement(Fragment, { key: i }, name !== undefined && name in slots ? slots[name] : piece);
    });
}

/**
 * What to tell the shopper when a scan call failed. An error the worker sent with a code reads
 * from the catalogue; any other `Error` shows its own message, as before; anything else, `fallback`.
 */
export function scanErrorText(e: unknown, fallback: string): string {
  if (e instanceof ScanError && e.code) return appStrings().capture.scanErrors[e.code];
  return e instanceof Error ? e.message : fallback;
}

/**
 * Reading the closure and the garment tape back from a platform (Shopify metafields `closure` and
 * `garment_tape`, WooCommerce meta `_curtain_closure` and `_curtain_garment_tape`).
 *
 * The stored tape is the filled tape (`GarmentTape`, every value with its provenance), as the
 * "Garment measurements" form wrote it. On read it is matched against the product's CURRENT size
 * chart: rows of sizes the chart no longer has are dropped (with a warning), a product with no chart
 * at all gets no tape (with a warning), and every estimate is
 * filled again from the measured values, so a chart edited after the form was saved moves the
 * estimates with it. Measured values are never changed. Lenient like the other coercers: a bad
 * value is dropped with a warning, never thrown.
 */
import { GARMENT_CLOSURES, GarmentTapeSchema, type GarmentClosure, type GarmentTape, type TapeChartRow } from '../garmentTape';
import { refillGarmentTape } from '../garmentTapeForm';
import { coerceString, parseJsonish, warn, type WarningSink } from './common';

export const GARMENT_TAPE_INVALID_WARNING = 'not a valid garment tape: every value needs cm and a provenance, and every size one row';
/** A stored tape on a product without a size chart: it cannot be read (its rows are chart sizes), so it is left out. */
export const GARMENT_TAPE_NO_CHART_WARNING = 'the product has no size chart, so its garment measurements were left out';

export function coerceClosure(value: unknown, sink: WarningSink, source: string): GarmentClosure | undefined {
  const s = coerceString(value)?.toLowerCase();
  if (!s) return undefined;
  if ((GARMENT_CLOSURES as readonly string[]).includes(s)) return s as GarmentClosure;
  warn(sink, { source, path: 'closure', message: `expected one of ${GARMENT_CLOSURES.join(', ')}, got '${s}'` });
  return undefined;
}

export function coerceGarmentTape(value: unknown, chart: readonly TapeChartRow[] | undefined, sink: WarningSink, source: string): GarmentTape | undefined {
  const v = parseJsonish(value);
  if (v === undefined || v === null || v === '') return undefined;
  const parsed = GarmentTapeSchema.safeParse(v);
  if (!parsed.success) {
    // One fixed sentence (the WooCommerce PHP twin gives the same): the tape is written by our own form.
    warn(sink, { source, path: 'garmentTape', message: GARMENT_TAPE_INVALID_WARNING });
    return undefined;
  }
  // Without a chart the rows name sizes that are not there: the merchant PUT would refuse the whole
  // payload (garmentTapeChartIssues), and the engine places a tape row by its chart row. Left out.
  if (!chart || chart.length === 0) {
    warn(sink, { source, path: 'garmentTape', message: GARMENT_TAPE_NO_CHART_WARNING });
    return undefined;
  }
  const { garmentTape, droppedSizes } = refillGarmentTape(chart, parsed.data);
  if (droppedSizes.length > 0) {
    warn(sink, { source, path: 'garmentTape', message: droppedSizes.length === 1 ? `size ${droppedSizes[0]} is not in the size chart; its measurements were left out` : `sizes ${droppedSizes.join(', ')} are not in the size chart; their measurements were left out` });
  }
  return garmentTape;
}

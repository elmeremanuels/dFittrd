/**
 * Phase 0 blind tests (docs/ENGINE-HANDOFF.md §Phase 0):
 * - size test: two renders of the same product in two sizes, random order, no labels; the viewer
 *   picks the smaller one. Gate: five people who did not build it get at least 4 of 5 products right.
 * - fabric test: the same garment with linen and with silk parameters; the viewer picks the silk.
 *
 * Pure logic only: trial lists from a seed, response records, CSV, and the per-person summary.
 * Results stay in the browser (localStorage) until someone exports the CSV.
 */

export type BlindMode = 'size' | 'fabric';
export type Side = 'left' | 'right';

export interface BlindProduct {
  id: string;
  /** Size labels in chart order (smallest first). */
  sizes: readonly string[];
}

export interface BlindTrial {
  index: number;
  mode: BlindMode;
  productId: string;
  /** Size label (size mode) or fabric preset (fabric mode) shown on each side. */
  left: string;
  right: string;
  /** Where the answer is: the smaller size, or the silk. */
  answer: Side;
}

export interface BlindResponse {
  participant: string;
  mode: BlindMode;
  seed: number;
  trial: number;
  productId: string;
  left: string;
  right: string;
  answer: Side;
  chosen: Side;
  correct: boolean;
  responseMs: number;
  at: string;
}

/** Deterministic PRNG (same as the spike's `mulberry32`), so a seed reproduces the order. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** Size pairs per product: S–M and M–L (one step apart, the hard case) when present, else adjacent pairs around the middle. */
export function sizePairs(sizes: readonly string[]): [string, string][] {
  const has = (s: string) => sizes.includes(s);
  if (has('S') && has('M') && has('L')) return [['S', 'M'], ['M', 'L']];
  const pairs: [string, string][] = [];
  const mid = Math.floor((sizes.length - 1) / 2);
  for (const i of [mid - 1, mid]) if (i >= 0 && i + 1 < sizes.length) pairs.push([sizes[i]!, sizes[i + 1]!]);
  return pairs;
}

/**
 * The trial list for one participant: every product × pair once (fabric mode: every product twice,
 * silk once on each side), in shuffled order, each pair's sides drawn at random.
 */
export function makeTrials(mode: BlindMode, products: readonly BlindProduct[], seed: number): BlindTrial[] {
  const rand = mulberry32(seed);
  const raw: Omit<BlindTrial, 'index'>[] = [];
  for (const p of products) {
    if (mode === 'size') {
      for (const [small, large] of sizePairs(p.sizes)) {
        const smallLeft = rand() < 0.5;
        raw.push({ mode, productId: p.id, left: smallLeft ? small : large, right: smallLeft ? large : small, answer: smallLeft ? 'left' : 'right' });
      }
    } else {
      raw.push({ mode, productId: p.id, left: 'silk', right: 'linen', answer: 'left' });
      raw.push({ mode, productId: p.id, left: 'linen', right: 'silk', answer: 'right' });
    }
  }
  return shuffle(raw, rand).map((t, index) => ({ index, ...t }));
}

export function respond(trial: BlindTrial, ctx: { participant: string; seed: number; chosen: Side; responseMs: number; at: Date }): BlindResponse {
  return {
    participant: ctx.participant,
    mode: trial.mode,
    seed: ctx.seed,
    trial: trial.index,
    productId: trial.productId,
    left: trial.left,
    right: trial.right,
    answer: trial.answer,
    chosen: ctx.chosen,
    correct: ctx.chosen === trial.answer,
    responseMs: Math.max(0, Math.round(ctx.responseMs)),
    at: ctx.at.toISOString(),
  };
}

export const CSV_COLUMNS: readonly (keyof BlindResponse)[] = ['participant', 'mode', 'seed', 'trial', 'productId', 'left', 'right', 'answer', 'chosen', 'correct', 'responseMs', 'at'];

/** RFC 4180 field: quoted when it holds a comma, quote or line break; a leading = + - @ is prefixed with ' so spreadsheets do not run it. */
export function csvField(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly BlindResponse[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvField(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export interface ParticipantSummary {
  participant: string;
  mode: BlindMode;
  trials: number;
  correct: number;
  /** Products where every trial of this participant was right. */
  productsRight: number;
  products: number;
}

/** Per participant and mode: trials right, and products with all trials right (the "4 of 5 products" reading). */
export function summarise(rows: readonly BlindResponse[]): ParticipantSummary[] {
  const groups = new Map<string, BlindResponse[]>();
  for (const r of rows) {
    const k = `${r.participant}\u0000${r.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const perProduct = new Map<string, boolean>();
    for (const r of rs) perProduct.set(r.productId, (perProduct.get(r.productId) ?? true) && r.correct);
    return {
      participant: rs[0]!.participant,
      mode: rs[0]!.mode,
      trials: rs.length,
      correct: rs.filter((r) => r.correct).length,
      productsRight: [...perProduct.values()].filter(Boolean).length,
      products: perProduct.size,
    };
  });
}

/** Read the responses stored in localStorage (JSON); drops anything malformed. */
export function parseStored(raw: string | null): BlindResponse[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is BlindResponse => typeof r === 'object' && r !== null && typeof (r as BlindResponse).participant === 'string' && typeof (r as BlindResponse).correct === 'boolean');
  } catch {
    return [];
  }
}

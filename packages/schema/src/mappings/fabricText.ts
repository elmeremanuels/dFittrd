/**
 * Read fabric from free text (product titles, descriptions, care labels) in English and Dutch and
 * resolve it to fabric library ids: "100% linnen", "95% katoen 5% elastaan", "cotton jersey",
 * "Tencel". The result is prefill for the merchant to confirm, never a silent overwrite.
 */
import {
  FABRIC_BY_ID,
  fabricPayloadName,
  fabricTerms,
  isFabricConstructionId,
  isFabricFibreId,
  normaliseFabricText,
  resolveFabric,
  type FabricCompositionPart,
  type FabricConstructionId,
  type FabricFibreId,
  type FabricId,
  type ResolveFabricInput,
  type ResolvedFabric,
} from '../fabrics';

export interface FabricTextMatch {
  id: FabricId;
  /** The library term that matched (normalised). */
  term: string;
  /** Character offset in the normalised text. */
  index: number;
}

export interface ParsedFabricText {
  /** Fibre composition by library id; percentages as stated, or assumed (see `sharesAssumed`). */
  composition: Array<{ fibre: FabricFibreId; pct: number }>;
  /** First construction named in the text. */
  construction?: FabricConstructionId;
  /** Every library id found, in order of appearance, without duplicates. */
  ids: FabricId[];
  /** True when the text gave no percentages and the shares are our assumption. */
  sharesAssumed: boolean;
  matches: FabricTextMatch[];
}

/** Elastane share assumed when the text names elastane without a percentage (typical stretch woven). */
export const ASSUMED_ELASTANE_PCT = 3;

let lexicon: Array<{ term: string; id: FabricId; re: RegExp }> | undefined;

function getLexicon() {
  if (lexicon) return lexicon;
  lexicon = [...fabricTerms().entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([term, id]) => ({
      term,
      id,
      // Whole words only; allow a plural or Dutch adjective ending ("jerseys", "katoenen", "zijden").
      re: new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|en|n)?(?![a-z0-9])`, 'g'),
    }));
  return lexicon;
}

function findTerms(norm: string): FabricTextMatch[] {
  const taken = new Array<boolean>(norm.length).fill(false);
  const found: FabricTextMatch[] = [];
  for (const { term, id, re } of getLexicon()) {
    re.lastIndex = 0;
    for (let m = re.exec(norm); m; m = re.exec(norm)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      taken.fill(true, start, end);
      found.push({ id, term, index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

type Event = { kind: 'pct'; index: number; pct: number } | { kind: 'term'; index: number; match: FabricTextMatch };

interface Pairing {
  shares: Map<FabricFibreId, number>;
  construction?: FabricConstructionId;
  pairs: number;
  fibrePairs: number;
}

function pairPercentages(events: readonly Event[], pctFirst: boolean): Pairing {
  const out: Pairing = { shares: new Map(), pairs: 0, fibrePairs: 0 };
  const used = new Set<number>();
  let total = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind !== 'pct') continue;
    const j = pctFirst ? i + 1 : i - 1;
    const t = events[j];
    if (!t || t.kind !== 'term' || used.has(j)) continue;
    // A second block ("lining: 100% viscose") starts once the first one is complete.
    if (total >= 99.5) break;
    used.add(j);
    out.pairs++;
    const id = t.match.id;
    const fibre = isFabricFibreId(id) ? id : FABRIC_BY_ID[id].baseFibre;
    if (isFabricConstructionId(id)) out.construction ??= id;
    if (fibre) {
      out.fibrePairs++;
      out.shares.set(fibre, (out.shares.get(fibre) ?? 0) + e.pct);
      total += e.pct;
    }
  }
  return out;
}

/** Parse free text into library ids. Returns undefined when the text names no known fibre or fabric. */
export function parseFabricText(text: string): ParsedFabricText | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const norm = normaliseFabricText(text);
  const matches = findTerms(norm);
  if (!matches.length) return undefined;

  const events: Event[] = matches.map((match) => ({ kind: 'term' as const, index: match.index, match }));
  for (const m of norm.matchAll(/(?<![0-9.,])(\d{1,3}(?:[.,]\d+)?)\s*%/g)) {
    const pct = Number(m[1]!.replace(',', '.'));
    if (pct > 0 && pct <= 100) events.push({ kind: 'pct', index: m.index!, pct });
  }
  events.sort((a, b) => a.index - b.index);

  const pctFirst = pairPercentages(events, true);
  const nameFirst = pairPercentages(events, false);
  // "95% katoen" or "katoen 95%": keep the reading that ties more percentages to fibres; on a tie,
  // the order of the first two events decides.
  const firstIsPct = events[0]?.kind === 'pct';
  const better = (x: Pairing, y: Pairing) => x.fibrePairs > y.fibrePairs || (x.fibrePairs === y.fibrePairs && x.pairs > y.pairs);
  const pick = better(pctFirst, nameFirst) ? pctFirst : better(nameFirst, pctFirst) ? nameFirst : firstIsPct ? pctFirst : nameFirst;
  const shares = pick.shares;
  let construction = pick.construction;
  construction ??= matches.map((m) => m.id).find(isFabricConstructionId);

  let sharesAssumed = false;
  if (shares.size === 0) {
    const named = [...new Set(matches.map((m) => m.id).filter(isFabricFibreId))];
    if (!named.length && construction && FABRIC_BY_ID[construction].baseFibre) named.push(FABRIC_BY_ID[construction].baseFibre!);
    if (named.length === 1) shares.set(named[0]!, 100);
    else if (named.length > 1) {
      sharesAssumed = true;
      const others = named.filter((f) => f !== 'elastane');
      const elastane = named.length > others.length ? ASSUMED_ELASTANE_PCT : 0;
      if (elastane) shares.set('elastane', elastane);
      for (const f of others) shares.set(f, Math.round(((100 - elastane) / others.length) * 100) / 100);
    }
  }

  const out: ParsedFabricText = {
    composition: [...shares.entries()].map(([fibre, pct]) => ({ fibre, pct })),
    ids: [...new Set(matches.map((m) => m.id))],
    sharesAssumed,
    matches,
  };
  if (construction) out.construction = construction;
  return out;
}

/** Parse free text and resolve it against the library; explicit product values still win. */
export function fabricFromText(text: string, product: Omit<ResolveFabricInput, 'composition' | 'construction'> = {}): ResolvedFabric | undefined {
  const parsed = parseFabricText(text);
  if (!parsed) return undefined;
  const input: ResolveFabricInput = { ...product, composition: parsed.composition as FabricCompositionPart[] };
  if (parsed.construction) input.construction = parsed.construction;
  return resolveFabric(input);
}

/** Product fabric text resolved to the GarmentPayload `fabric` names (see `resolveFabricText`). */
export interface FabricTextPayload {
  /** `fabric.primary`: the construction named, else the fibre with the largest share (payload names: library ids, `tencel` for lyocell). */
  primary: string;
  /** `fabric.blend`, only when the text states the composition (percentages, or a fibre beside a construction). */
  blend?: Array<[string, number]>;
}

/**
 * Resolve product fabric text ("95% katoen, 5% elastaan", "Cotton jersey", "100% Linnen",
 * "Tencel™") to the `primary` and `blend` of a GarmentPayload `fabric` block, in library ids
 * (`fabricPayloadName`). Shares the text does not state are never invented: a blend whose shares
 * `parseFabricText` had to assume ("katoen met elastaan") is left out. Undefined when the text names
 * nothing in the library. The PHP plugin mirrors this (`Curtain\Fabric_Text`).
 */
export function resolveFabricText(text: string): FabricTextPayload | undefined {
  const parsed = parseFabricText(text);
  if (!parsed) return undefined;
  let top: { fibre: FabricFibreId; pct: number } | undefined;
  for (const part of parsed.composition) if (!top || part.pct > top.pct) top = part;
  const primaryId: FabricId = parsed.construction ?? top?.fibre ?? parsed.ids[0]!;
  const out: FabricTextPayload = { primary: fabricPayloadName(primaryId) };
  if (!parsed.sharesAssumed && parsed.composition.length) {
    const stated = /\d\s*%/.test(normaliseFabricText(text));
    const onlyThePrimary = parsed.composition.length === 1 && parsed.composition[0]!.fibre === primaryId;
    if (stated || !onlyThePrimary) out.blend = parsed.composition.map((c) => [fabricPayloadName(c.fibre), c.pct]);
  }
  return out;
}

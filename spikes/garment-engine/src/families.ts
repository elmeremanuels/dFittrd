/**
 * Cut families: a shop sells the same cut in many colours and prints. The engine builds the 3D asset
 * once per cut (the family's reference member) and only re-textures the other members (stage 4b,
 * `modal/stage4b_retexture.py`). This module groups a Shopify catalogue into such families.
 *
 * Two products are in one family when ALL of these hold:
 *   1. same `product_type`;
 *   2. same size option values (trimmed, upper case, order ignored);
 *   3. same title stem: the title's tokens with colour words, print words and variant codes (PWP1,
 *      PWD6) removed;
 *   4. same description key: the description's sentences without shop boilerplate (colour
 *      disclaimers, "X is not included", styling advice, model notes), lower case, quotes and
 *      punctuation dropped, with colour words, print words, variant codes and the product's own
 *      variant name removed. Numbers stay, so the printed measurements must be equal;
 *   4b. or, when the description keys differ: a similar description key (token-set Jaccard >=
 *      SIMILAR_DESCRIPTION_JACCARD) with the SAME measurement numbers, at least two of them. This
 *      absorbs one-word copy edits ("Best seller in store", "Crafted in a deep navy,"); the family
 *      records `textMatch: 'similar'` and the Jaccard per member, so a reviewer can see it;
 *   5. when main photos are available: a silhouette check (`familiesSilhouette.ts`) splits a text
 *      family whose members' main-photo silhouettes differ (mask IoU after scale normalisation).
 *
 * Per family a reference member is chosen (best photos: no model first, then the highest
 * resolution, then the most images). Every other member is compared with it on fabric and size
 * chart as `buildShopPayload` reads them; a member whose fabric or chart differs needs its own asset.
 *
 * Pure functions, no I/O. The CLI is `scripts/families-bohohippychic.ts`. Shop text is untrusted
 * data: it is tokenised and compared, never executed.
 */
import { buildShopPayload, htmlToLines, type ShopifyProduct } from './shop';
import { silhouetteIou, type Silhouette } from './familiesSilhouette';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Colour names, including the colourway names this shop uses (latte, espresso, mushroom, …). Words
 * that are also something else are handled separately: `denim` is a fabric (only a colour next to
 * another colour word, "Denim Blue"), and the shade modifiers below only count next to a colour.
 */
export const COLOUR_WORDS: ReadonlySet<string> = new Set([
  'black', 'white', 'ivory', 'cream', 'natural', 'ecru', 'beige', 'nude', 'oatmeal', 'sand', 'stone', 'taupe', 'pebble',
  'grey', 'gray', 'charcoal', 'silver', 'gold', 'golden', 'bronze', 'copper',
  'brown', 'chocolate', 'coffee', 'mocha', 'latte', 'espresso', 'cacao', 'cocoa', 'caramel', 'tan', 'camel', 'walnut', 'hazel', 'mushroom', 'khaki', 'olive',
  'red', 'crimson', 'scarlet', 'burgundy', 'wine', 'maroon', 'cherry', 'raspberry', 'berry', 'rust', 'terracotta', 'brick',
  'orange', 'tangerine', 'tangarine', 'coral', 'peach', 'apricot', 'mustard', 'yellow', 'lemon', 'ochre',
  'pink', 'blush', 'rose', 'fuchsia', 'magenta', 'salmon',
  'purple', 'plum', 'violet', 'lavender', 'lilac', 'orchid', 'mauve', 'grape', 'aubergine',
  'blue', 'navy', 'indigo', 'cobalt', 'cornflower', 'aqua', 'teal', 'turquoise', 'petrol', 'azure', 'cyan',
  'green', 'sage', 'mint', 'emerald', 'forest', 'jade', 'lime', 'pistachio', 'moss', 'gucci',
  'midnight', 'sky', 'ocean',
  'multi', 'multicolour', 'multicolor', 'rainbow',
]);

/** Shade words: removed only when they sit next to a colour word ("Light Grey", "Royal Blue", "Sea Green"). */
export const SHADE_MODIFIERS: ReadonlySet<string> = new Set([
  'light', 'dark', 'deep', 'soft', 'pale', 'pastel', 'bright', 'dusty', 'dusky', 'rich', 'royal', 'steel', 'sea', 'baby', 'hot', 'burnt',
  'warm', 'cool', 'ice', 'electric', 'meadow', 'antique', 'vintage', 'washed', 'denim',
]);

/** Print and colourway nouns: a print is a variant of the cut, not a different cut. */
export const PRINT_WORDS: ReadonlySet<string> = new Set([
  'print', 'printed', 'floral', 'florals', 'paisley', 'leopard', 'animal', 'stripe', 'stripes', 'striped', 'check', 'checked', 'gingham',
  'polka', 'dot', 'dots', 'spot', 'spots', 'tiedye', 'batik', 'ikat', 'aztec', 'mandala', 'botanical', 'tropical',
  'blossom', 'bloom', 'lagoon', 'sunset', 'sunrise', 'santorini', 'autumn', 'mosaic',
]);

/** Variant codes: two to four letters and one to three digits ("PWP1", "PWD6"). */
const VARIANT_CODE = /^[a-z]{2,4}\d{1,3}$/;

/**
 * Sentences that say nothing about the cut. The shop adds and drops them per colour ("Singlet is
 * not included" only where the photo shows one), so they must not split a family.
 */
export const BOILERPLATE_SENTENCES: readonly RegExp[] = [
  /\bnot included\b/i,
  /\bsold separately\b/i,
  /\bevery effort\b/i,
  /\bcolou?rs?\b[^.]*\b(accurate|accurately|vary|varies|differ|monitor|screen|display)/i,
  /\b(monitor|screen) settings\b/i,
  /^(style|pair|team|wear) (it|this|them|with|over|under)\b/i,
  /\bmodel (is|wears|wearing|stands)\b/i,
  /^colou?rs?\s*:/i,
];

// ---------------------------------------------------------------------------
// Text keys
// ---------------------------------------------------------------------------

/** Lower case, apostrophes dropped, split on everything but letters and digits. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\w)['’‘`](\w)/g, '$1$2')
    .replace(/tie[\s-]+dye/g, 'tiedye')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Which tokens are colour, print or code words (shade modifiers and `denim` only next to a colour). */
export function variantTokenMask(toks: readonly string[]): boolean[] {
  const mask = toks.map((t) => COLOUR_WORDS.has(t) || PRINT_WORDS.has(t) || VARIANT_CODE.test(t));
  // Grow runs of colour words over adjacent shade modifiers ("deep royal blue", "denim blue").
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < toks.length; i++) {
      if (mask[i] || !SHADE_MODIFIERS.has(toks[i]!)) continue;
      const nextToColour = (j: number) => j >= 0 && j < toks.length && mask[j] && (COLOUR_WORDS.has(toks[j]!) || SHADE_MODIFIERS.has(toks[j]!));
      if (nextToColour(i - 1) || nextToColour(i + 1)) {
        mask[i] = true;
        changed = true;
      }
    }
  }
  return mask;
}

export interface TitleParts {
  /** The title's tokens without colour, print and code words. */
  stem: string;
  /** The removed words, in title case order: the variant name ("Soft Pink", "PWP1"). */
  variant: string;
  /** The removed tokens (lower case), also removed from the description. */
  variantTokens: string[];
}

export function titleParts(title: string): TitleParts {
  const toks = tokens(title);
  const mask = variantTokenMask(toks);
  const variantTokens = toks.filter((_, i) => mask[i]);
  const stem = toks.filter((_, i) => !mask[i]).join(' ');
  // The variant name in the title's own spelling, for the report.
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const variant = words.filter((w) => variantTokens.includes(tokens(w).join(''))).join(' ');
  return { stem, variant, variantTokens };
}

function sentencesOf(html: string | null | undefined): string[] {
  return htmlToLines(html)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The description with everything that may differ between colours of one cut taken out. Two
 * members of a family have the same key. `ownVariant` are the member's own variant-name tokens.
 */
export function descriptionKey(html: string | null | undefined, ownVariant: readonly string[] = []): string {
  const own = new Set(ownVariant);
  const kept = sentencesOf(html).filter((s) => !BOILERPLATE_SENTENCES.some((re) => re.test(s)));
  const toks = tokens(kept.join(' '));
  const mask = variantTokenMask(toks);
  return toks.filter((t, i) => !mask[i] && !own.has(t)).join(' ');
}

/** The size option's values (option named like "size", else the first), trimmed, upper case, sorted. */
export function sizeValues(p: ShopifyProduct): string[] {
  const opt = p.options.find((o) => /size/i.test(o.name)) ?? p.options[0];
  return [...new Set((opt?.values ?? []).map((v) => v.trim().toUpperCase().replace(/\s+/g, ' ')))].sort();
}

/** The text part of the family key (rules 1–4). */
export function textFamilyKey(p: ShopifyProduct): string {
  const t = titleParts(p.title);
  return JSON.stringify([p.product_type, sizeValues(p), t.stem, descriptionKey(p.body_html, t.variantTokens)]);
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/**
 * Product types the engine can build a 3D asset for today: their products map to an engine category
 * (dress, top, outerwear, bottom) with an anchor subset and a control proxy. Accessories and body
 * care are not garments. `Clothing` is this shop's catch-all for tees, tops and dresses.
 */
export const ASSET_TYPES: ReadonlySet<string> = new Set(['Dresses', 'Tops', 'Pants', 'Skirts', 'Jackets & Knits', 'Clothing']);

/**
 * Garment types the engine cannot build yet, with the missing piece. They are counted in their own
 * bucket ("eligible once the category exists"), never in the asset-eligible savings.
 */
export const PENDING_ASSET_TYPES: Readonly<Record<string, string>> = {
  'Jumpsuits & Sets':
    'overalls, jumpsuits and pant suits span torso and legs: no engine category (the schema reads the type as "dress", which has no legs), no combined dress + bottom anchor subset, no control proxy with legs, and no validation product (export:phase0 --shop refuses them)',
};

/** Description keys of near-miss text families at or above this token-set Jaccard, with equal measurement numbers, are one cut. */
export const SIMILAR_DESCRIPTION_JACCARD = 0.9;
/** A similarity merge needs at least this many measurement numbers in the description (both sides equal). */
export const SIMILAR_MIN_NUMBERS = 2;

/** Silhouettes of one family whose IoU is below this are a different cut (set from the run on this shop, see families.json). */
export const SILHOUETTE_SPLIT_IOU = 0.6;

export interface FamilyInput {
  product: ShopifyProduct;
  /** Main-photo silhouette, when the photo was downloaded and a mask could be found. */
  silhouette?: Silhouette | null;
  /** From a by-eye classification of the main photo (images.json); undefined = not looked at. */
  mainOnModel?: boolean;
}

export interface FamilyMember {
  handle: string;
  title: string;
  /** Removed colour/print/code words: what makes this member a variant. */
  variant: string;
  reference: boolean;
  mainPhoto: { width: number; height: number; onModel: boolean | null } | null;
  images: number;
  /** Main-photo silhouette IoU against the reference (null: not checked). */
  silhouetteIou: number | null;
  /** Token-set Jaccard of this member's description key against the reference's; null when the keys are equal (rule 4), a number when rule 4b joined it. */
  descriptionJaccard: number | null;
  fabricDiffers: boolean;
  chartDiffers: boolean;
  /** The member needs its own full run (fabric or chart differs from the reference). */
  ownAsset: boolean;
  notes: string[];
}

export interface Family {
  id: string;
  cutName: string;
  productType: string;
  sizes: string[];
  assetEligible: boolean;
  /** Garment type the engine cannot build yet (PENDING_ASSET_TYPES): the missing piece. */
  pendingCategory?: string;
  /** 'exact': every member has the reference's description key; 'similar': at least one was joined by rule 4b. */
  textMatch: 'exact' | 'similar';
  reference: string;
  referenceWhy: string;
  /** Members split off this text family by the silhouette check go to a sibling family `<id>~2`, … */
  splitFromText: boolean;
  members: FamilyMember[];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

function titleCase(stem: string): string {
  return stem.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Photo ranking for the reference: known no-model first, then main-photo long edge, then image count, then handle. */
export function referenceOrder(a: FamilyInput, b: FamilyInput): number {
  const model = (x: FamilyInput) => (x.mainOnModel === false ? 0 : x.mainOnModel === undefined ? 1 : 2);
  const edge = (x: FamilyInput) => {
    const i = x.product.images[0];
    return i ? Math.max(i.width, i.height) * Math.min(i.width, i.height) : 0;
  };
  return model(a) - model(b) || edge(b) - edge(a) || b.product.images.length - a.product.images.length || a.product.handle.localeCompare(b.product.handle);
}

function referenceWhy(ref: FamilyInput, n: number): string {
  const i = ref.product.images[0];
  const model = ref.mainOnModel === false ? 'main photo without a model' : ref.mainOnModel === true ? 'main photo on a model (no member has one without)' : 'no member classified as without a model';
  return n === 1
    ? 'only member'
    : `${model}; main photo ${i ? `${i.width}×${i.height}` : 'missing'} (largest in the family, ties broken by image count, then handle); ${ref.product.images.length} images`;
}

/** Fabric as the payload reads it (fibres, blend, construction), for the comparison with the reference. */
function fabricSignature(p: ShopifyProduct): string {
  const f = buildShopPayload(p).payload.fabric;
  return f ? JSON.stringify(f) : 'none';
}

function chartSignature(p: ShopifyProduct): string {
  const pl = buildShopPayload(p).payload;
  return JSON.stringify([pl.sizeChartType ?? null, pl.sizeChart ?? null, pl.ease ?? null, pl.lengthCm ?? null]);
}

/** Greedy split of one text family by silhouette: a member joins the first cluster whose seed it matches. */
export function splitBySilhouette(inputs: readonly FamilyInput[], threshold = SILHOUETTE_SPLIT_IOU): FamilyInput[][] {
  const clusters: Array<{ seed: FamilyInput | null; members: FamilyInput[] }> = [];
  const unchecked: FamilyInput[] = [];
  for (const x of inputs) {
    if (!x.silhouette) {
      unchecked.push(x);
      continue;
    }
    const hit = clusters.find((c) => c.seed?.silhouette && silhouetteIou(c.seed.silhouette, x.silhouette!) >= threshold);
    if (hit) hit.members.push(x);
    else clusters.push({ seed: x, members: [x] });
  }
  // Members without a silhouette stay with the largest checked cluster (or form the family alone).
  if (!clusters.length) return [unchecked];
  clusters.sort((a, b) => b.members.length - a.members.length);
  clusters[0]!.members.push(...unchecked);
  return clusters.map((c) => c.members);
}

// ---------------------------------------------------------------------------
// Similar descriptions (rule 4b)
// ---------------------------------------------------------------------------

/** The description key of a product (rule 4), with its variant name removed. */
function productDescriptionKey(p: ShopifyProduct): string {
  return descriptionKey(p.body_html, titleParts(p.title).variantTokens);
}

/** Token-set Jaccard of two description keys (1 for two empty keys). */
export function descriptionJaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** The numbers of a description key in order: the printed measurements (and compositions). */
export function measurementNumbers(key: string): string[] {
  return key.split(' ').filter((t) => /\d/.test(t));
}

/** Rule 4b: two description keys of one type, size set and stem describe the same cut. */
export function similarDescriptions(a: string, b: string, minJaccard = SIMILAR_DESCRIPTION_JACCARD): boolean {
  const na = measurementNumbers(a);
  const nb = measurementNumbers(b);
  if (na.length < SIMILAR_MIN_NUMBERS || na.join(' ') !== nb.join(' ')) return false;
  return descriptionJaccard(a, b) >= minJaccard;
}

/**
 * Merges text groups (rule 1–4) that share type, sizes and stem and whose description keys are
 * similar (rule 4b). Complete linkage: a group joins a cluster only when it is similar to every group
 * already in it, so similarity never chains A~B~C into a merge of A and C. Order is preserved.
 */
export function mergeSimilarGroups<T>(groups: readonly T[][], productOf: (x: T) => ShopifyProduct, minJaccard = SIMILAR_DESCRIPTION_JACCARD): T[][] {
  const clusters: Array<{ stemKey: string; keys: string[]; members: T[] }> = [];
  for (const g of groups) {
    const p = productOf(g[0]!);
    const stemKey = JSON.stringify([p.product_type, sizeValues(p), titleParts(p.title).stem]);
    const key = productDescriptionKey(p);
    const hit = clusters.find((c) => c.stemKey === stemKey && c.keys.every((k) => similarDescriptions(k, key, minJaccard)));
    if (hit) {
      hit.keys.push(key);
      hit.members.push(...g);
    } else clusters.push({ stemKey, keys: [key], members: [...g] });
  }
  return clusters.map((c) => c.members);
}

export interface BuildFamiliesOptions {
  silhouetteThreshold?: number;
  /** Rule 4b threshold; `false` turns rule 4b off (exact description keys only). */
  similarJaccard?: number | false;
}

/** Groups the catalogue into cut families. Deterministic: same input, same ids and order. */
export function buildFamilies(inputs: readonly FamilyInput[], opts: BuildFamiliesOptions = {}): Family[] {
  const threshold = opts.silhouetteThreshold ?? SILHOUETTE_SPLIT_IOU;
  const byKey = new Map<string, FamilyInput[]>();
  for (const x of inputs) {
    const k = textFamilyKey(x.product);
    const list = byKey.get(k);
    if (list) list.push(x);
    else byKey.set(k, [x]);
  }
  const groups = opts.similarJaccard === false ? [...byKey.values()] : mergeSimilarGroups([...byKey.values()], (x) => x.product, opts.similarJaccard ?? SIMILAR_DESCRIPTION_JACCARD);
  const families: Family[] = [];
  const usedIds = new Set<string>();
  for (const group of groups) {
    const parts = group.length > 1 ? splitBySilhouette([...group].sort(referenceOrder), threshold) : [group];
    parts.forEach((part, partIndex) => {
      const sorted = [...part].sort(referenceOrder);
      const ref = sorted[0]!;
      const refP = ref.product;
      const stem = titleParts(refP.title).stem;
      let id = `${slug(refP.product_type)}/${slug(stem)}`;
      if (partIndex > 0) id += `~${partIndex + 1}`;
      for (let n = 2; usedIds.has(id); n++) id = `${slug(refP.product_type)}/${slug(stem)}-${n}${partIndex > 0 ? `~${partIndex + 1}` : ''}`;
      usedIds.add(id);
      const refFabric = sorted.length > 1 ? fabricSignature(refP) : '';
      const refChart = sorted.length > 1 ? chartSignature(refP) : '';
      const refKey = productDescriptionKey(refP);
      const members: FamilyMember[] = sorted.map((x) => {
        const p = x.product;
        const isRef = x === ref;
        const fabricDiffers = !isRef && fabricSignature(p) !== refFabric;
        const chartDiffers = !isRef && chartSignature(p) !== refChart;
        const iou = !isRef && x.silhouette && ref.silhouette ? Math.round(silhouetteIou(ref.silhouette, x.silhouette) * 1000) / 1000 : null;
        const key = isRef ? refKey : productDescriptionKey(p);
        const jaccard = key === refKey ? null : Math.round(descriptionJaccard(refKey, key) * 1000) / 1000;
        const notes: string[] = [];
        if (jaccard !== null) notes.push(`description differs from the reference (token Jaccard ${jaccard}, same measurements): joined by rule 4b`);
        if (!isRef && !x.silhouette) notes.push('silhouette not checked (no main photo or no mask)');
        if (fabricDiffers) notes.push('fabric differs from the reference: own asset');
        if (chartDiffers) notes.push('size chart differs from the reference: own asset');
        const img = p.images[0];
        return {
          handle: p.handle,
          title: p.title,
          variant: titleParts(p.title).variant,
          reference: isRef,
          mainPhoto: img ? { width: img.width, height: img.height, onModel: x.mainOnModel ?? null } : null,
          images: p.images.length,
          silhouetteIou: iou,
          descriptionJaccard: jaccard,
          fabricDiffers,
          chartDiffers,
          ownAsset: isRef || fabricDiffers || chartDiffers,
          notes,
        };
      });
      const pending = PENDING_ASSET_TYPES[refP.product_type];
      families.push({
        id,
        cutName: titleCase(stem) || refP.title,
        productType: refP.product_type,
        sizes: sizeValues(refP),
        assetEligible: ASSET_TYPES.has(refP.product_type),
        ...(pending ? { pendingCategory: pending } : {}),
        textMatch: members.every((m) => m.descriptionJaccard === null) ? 'exact' : 'similar',
        reference: refP.handle,
        referenceWhy: referenceWhy(ref, sorted.length),
        splitFromText: parts.length > 1,
        members,
      });
    });
  }
  families.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  return families;
}

/**
 * Near misses: products with the same type, sizes and title stem whose descriptions differ, so they
 * are in different families. A merchant can confirm them as one cut; the rules never merge them.
 */
export function nearMisses(families: readonly Family[]): Array<{ stem: string; productType: string; assetEligible: boolean; pending: boolean; families: string[]; products: number }> {
  const byStem = new Map<string, Family[]>();
  for (const f of families) {
    const k = JSON.stringify([f.productType, f.sizes, titleParts(f.members[0]!.title).stem]);
    byStem.set(k, [...(byStem.get(k) ?? []), f]);
  }
  return [...byStem.values()]
    .filter((fs) => fs.length > 1)
    .map((fs) => ({
      stem: titleParts(fs[0]!.members[0]!.title).stem,
      productType: fs[0]!.productType,
      assetEligible: fs[0]!.assetEligible,
      pending: fs[0]!.pendingCategory !== undefined,
      families: fs.map((f) => f.id),
      products: fs.reduce((n, f) => n + f.members.length, 0),
    }))
    .sort((a, b) => b.products - a.products || a.stem.localeCompare(b.stem));
}

export interface FamilyCounts {
  products: number;
  families: number;
  multiMemberFamilies: number;
  /** Members that only need stage 4b (re-texture), not a full run. */
  productsSaved: number;
  /** Full runs needed: one per family plus every member with its own asset. */
  fullRuns: number;
  silhouetteSplits: number;
  membersWithoutSilhouette: number;
  /** Members joined to their family by rule 4b (similar description), not by an equal key. */
  membersBySimilarity: number;
}

export function familyCounts(families: readonly Family[]): FamilyCounts {
  const members = families.flatMap((f) => f.members);
  const fullRuns = members.filter((m) => m.ownAsset).length;
  return {
    products: members.length,
    families: families.length,
    multiMemberFamilies: families.filter((f) => f.members.length > 1).length,
    productsSaved: members.length - fullRuns,
    fullRuns,
    silhouetteSplits: families.filter((f) => f.id.includes('~')).length,
    membersWithoutSilhouette: families.filter((f) => f.members.length > 1).flatMap((f) => f.members).filter((m) => !m.reference && m.silhouetteIou === null).length,
    membersBySimilarity: members.filter((m) => m.descriptionJaccard !== null).length,
  };
}

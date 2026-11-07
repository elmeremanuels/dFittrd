/**
 * From a `@curtain/schema` garment payload to what the pipeline uses: the size chart re-keyed by
 * anchor id as garment girths, the synthetic garment spec at the base size, and material.json from
 * the fabric library. Also the products the Phase 0 exporter takes (the spike's schema fixtures, or a
 * validated shop's drafts with their photo choice from `images.json`) and the neutral stage 2 prompt.
 */
import { FIT_POINT_TO_ANCHOR, type AnchorBreadth, type AnchorRing } from '@curtain/anchors';
import { FABRIC_LIBRARY_VERSION, duplicateSizeLabels, isFabricConstructionId, lookupFabricId, mockGarment, resolveFabric, sizeLabelKey, type GarmentPayload } from '@curtain/schema';
import type { Mannequin } from '@curtain/mannequin';
import type { GarmentSpec, SpikeCategory } from './garment';
import type { ProxyKind, ProxySpec } from './proxy';

/** The two Phase 0 spike products from the schema fixtures: a long-sleeved shirt dress (body chart) and a T-shirt (garment chart). */
export const SPIKE_PRODUCT_IDS = ['aalter-studio-2', 'monochrome-03'] as const;

/**
 * Fallback ease per category (cm) for a body chart whose product gives none for a point. Same
 * numbers as the fit engine's category defaults (`packages/fit-engine/src/constants.ts`).
 */
export const CATEGORY_DEFAULT_EASE: Readonly<Record<SpikeCategory, Partial<Record<'bust' | 'waist' | 'hip' | 'shoulder', number>>>> = {
  dress: { bust: 6, waist: 4, hip: 6, shoulder: 1 },
  top: { bust: 8, waist: 8, hip: 6, shoulder: 1 },
};

/** Girth points of the chart that are anchor rings. `shoulder` is a width in charts, not the shoulder ring girth, so it is not used as a girth. */
const GIRTH_POINTS = ['bust', 'waist', 'hip'] as const;
/** Width points of the chart: the chart's `shoulder` is the D15 breadth `shoulder_width` (R1), never the `shoulder` ring. */
const BREADTH_POINTS = ['shoulder'] as const;

export interface ChartRow {
  size: string;
  /** Garment girths per ring, cm. */
  rings: Partial<Record<AnchorRing, number>>;
  /** Rings whose value is body + the category default ease (no product ease given). */
  defaultEase: AnchorRing[];
  /** Garment widths per breadth anchor (`shoulder_width`: seam to seam across the back), cm. */
  breadths: Partial<Record<AnchorBreadth, number>>;
  /** Breadths whose value is body + the category default ease. */
  defaultEaseBreadths: AnchorBreadth[];
}

export interface GarmentChart {
  productId: string;
  category: SpikeCategory;
  type: 'body' | 'garment';
  rows: ChartRow[];
}

/** The size chart as garment girths per anchor ring. Throws on duplicate size labels (finding #2). */
export function garmentChart(p: GarmentPayload): GarmentChart {
  if (p.category !== 'dress' && p.category !== 'top') throw new Error(`spike supports dress and top, not ${p.category}`);
  const dup = duplicateSizeLabels(p.sizeChart);
  if (dup.length > 0) throw new Error(`duplicate size labels: ${dup.join(', ')}`);
  const category = p.category;
  const type = p.sizeChartType === 'garment' ? 'garment' : 'body';
  const rows = p.sizeChart.map((row) => {
    const rings: Partial<Record<AnchorRing, number>> = {};
    const defaultEase: AnchorRing[] = [];
    for (const point of GIRTH_POINTS) {
      const v = row[point];
      if (v === undefined) continue;
      const anchor = FIT_POINT_TO_ANCHOR[point] as AnchorRing;
      if (type === 'garment') rings[anchor] = v;
      else {
        const productEase = p.ease?.[point];
        if (productEase === undefined) defaultEase.push(anchor);
        rings[anchor] = v + (productEase ?? CATEGORY_DEFAULT_EASE[category][point] ?? 0);
      }
    }
    const breadths: Partial<Record<AnchorBreadth, number>> = {};
    const defaultEaseBreadths: AnchorBreadth[] = [];
    for (const point of BREADTH_POINTS) {
      const v = row[point];
      if (v === undefined) continue;
      const anchor = FIT_POINT_TO_ANCHOR[point] as AnchorBreadth;
      if (type === 'garment') breadths[anchor] = v;
      else {
        const productEase = p.ease?.[point];
        if (productEase === undefined) defaultEaseBreadths.push(anchor);
        breadths[anchor] = v + (productEase ?? CATEGORY_DEFAULT_EASE[category][point] ?? 0);
      }
    }
    return { size: row.size, rings, defaultEase, breadths, defaultEaseBreadths };
  });
  return { productId: p.id, category, type, rows };
}

export function chartRow(chart: GarmentChart, size: string): ChartRow {
  const row = chart.rows.find((r) => sizeLabelKey(r.size) === sizeLabelKey(size));
  if (!row) throw new Error(`size ${size} not in the chart of ${chart.productId}`);
  return row;
}

/** Synthetic garment spec at the base size. */
export function garmentSpec(p: GarmentPayload, baseSize = 'M'): GarmentSpec {
  const chart = garmentChart(p);
  const base = chartRow(chart, baseSize);
  const len = p.lengthCm ?? {};
  return {
    id: p.id,
    name: p.name,
    category: chart.category,
    colorHex: p.primaryColorHex,
    baseSize,
    rings: base.rings,
    ...(base.breadths.shoulder_width !== undefined ? { shoulderWidthCm: base.breadths.shoulder_width } : {}),
    shoulderToHemCm: len.shoulder_to_hem ?? (chart.category === 'dress' ? 105 : 64),
    sleeveCm: len.sleeve_length ?? 0,
    hemFlare: chart.category === 'dress' ? (p.patternBlock === 'a-line' ? 1.25 : 1.1) : 1,
  };
}

export function spikeProduct(id: (typeof SPIKE_PRODUCT_IDS)[number]): GarmentPayload {
  return mockGarment(id);
}

export interface MaterialJson {
  format: 'curtain.garment.material';
  formatVersion: 1;
  productId: string;
  fabricLibraryVersion: string;
  baseColorHex: string;
  fibres: { id: string; pct: number }[];
  construction: string | null;
  weightGsm: number;
  stretchPct: number;
  drape: number;
  bendStiffness: number;
  sheen: number;
  opacity: number;
  texture: string;
  simulation: Record<string, number>;
  provenance: Record<string, string>;
  unknownFibres: string[];
}

/** material.json: the product's fabric resolved through the `@curtain/schema` fabric library (stage 7 input). */
export function materialJson(p: GarmentPayload): MaterialJson {
  const f = p.fabric;
  // `primary` may name the construction ("denim") while `blend` holds the fibres (R3): keep it.
  const primaryId = lookupFabricId(f.primary);
  const r = resolveFabric({
    composition: (f.blend ?? [[f.primary, 100]]).map(([fibre, pct]) => ({ fibre, pct })),
    ...(primaryId && isFabricConstructionId(primaryId) ? { construction: primaryId } : {}),
    ...(f.weightGsm !== undefined ? { weightGsm: f.weightGsm } : {}),
    stretchPct: f.stretchPct,
    drape: f.drape,
    ...(f.sheen !== undefined ? { sheen: f.sheen } : {}),
    ...(f.opacity !== undefined ? { opacity: f.opacity } : {}),
  });
  return {
    format: 'curtain.garment.material',
    formatVersion: 1,
    productId: p.id,
    fabricLibraryVersion: FABRIC_LIBRARY_VERSION,
    baseColorHex: p.primaryColorHex,
    fibres: r.fibres,
    construction: r.construction ?? null,
    weightGsm: r.weightGsm,
    stretchPct: r.stretchPct,
    drape: r.drape,
    bendStiffness: r.bendStiffness,
    sheen: r.sheen,
    opacity: r.opacity,
    texture: r.texture,
    simulation: { ...r.simulation },
    provenance: { ...r.provenance },
    unknownFibres: r.unknown,
  };
}

// ---------------------------------------------------------------------------
// Products for the Phase 0 exporter: the spike's schema fixtures or a validated shop's drafts
// ---------------------------------------------------------------------------

/** Shops with a committed validation set under data/<shop>/ (products.json, images.json; images in raw/, gitignored). */
export const SHOPS = ['bohohippychic'] as const;
export type ShopId = (typeof SHOPS)[number];

export type ProductSource = { kind: 'spike' } | { kind: 'shop'; shop: ShopId; handle: string; product_type: string; data: string };

/** A product the exporter can write a job for. `id` names the job directory and prefixes the job id. */
export interface ResolvedProduct {
  id: string;
  payload: GarmentPayload;
  baseSize: string;
  source: ProductSource;
}

export function isSpikeProductId(id: string): id is (typeof SPIKE_PRODUCT_IDS)[number] {
  return (SPIKE_PRODUCT_IDS as readonly string[]).includes(id);
}

export function resolveSpikeProduct(id: string, baseSize?: string): ResolvedProduct {
  if (!isSpikeProductId(id)) throw new Error(`unknown product ${id}; the spike knows ${SPIKE_PRODUCT_IDS.join(', ')} (a shop product needs --shop <shop>)`);
  return { id, payload: spikeProduct(id), baseSize: baseSize ?? 'M', source: { kind: 'spike' } };
}

interface ShopProductsFile {
  products: { handle: string; productType: string; payload: GarmentPayload; baseSize?: string; selection?: { runnersUp?: { handle: string }[] } }[];
}

/** A product of a shop's committed `products.json` (the GarmentPayload v1 draft and our base size). */
export function shopProduct(shop: ShopId, productsJson: unknown, handle: string, baseSize?: string): ResolvedProduct {
  const file = productsJson as ShopProductsFile;
  if (!Array.isArray(file?.products)) throw new Error(`data/${shop}/products.json has no products array`);
  const entry = file.products.find((p) => p.handle === handle);
  if (!entry) {
    const runnerUp = file.products.some((p) => p.selection?.runnersUp?.some((r) => r.handle === handle));
    throw new Error(
      `${handle} is not one of the ${shop} validation products (${file.products.map((p) => p.handle).join(', ')})` +
        (runnerUp ? '; it is only listed as a runner-up, so it has no payload or image classification yet' : ''),
    );
  }
  const size = baseSize ?? entry.baseSize;
  if (!size) throw new Error(`${handle}: products.json gives no base size; pass --base-size`);
  return { id: handle, payload: entry.payload, baseSize: size, source: { kind: 'shop', shop, handle, product_type: entry.productType, data: `data/${shop}/products.json` } };
}

/** One image of a shop product as classified by hand in `images.json`. */
export interface ShopImage {
  position: number;
  role: string;
  onModel: boolean;
  background: string;
  garmentFullyVisible: boolean;
  notes?: string;
  url?: string;
  width?: number;
  height?: number;
  /** Path relative to data/<shop>/ when the image was downloaded, else null. */
  file: string | null;
  sha256: string | null;
}

export interface ShopPhotoChoice {
  front: ShopImage;
  /** null: no back photo, stage 1b invents the back (validation only, D13). */
  back: ShopImage | null;
  /** What the chosen front shows (the job's stage 1b `source_kind`). */
  sourceKind: 'on_model' | 'flat_lay';
  why: string[];
}

/** No model, plain background, garment fully visible: the D13 photo kind (flat-lay, hanger or ghost mannequin). */
const noModel = (i: ShopImage): boolean => !i.onModel && i.background === 'plain' && i.garmentFullyVisible;

/**
 * The front and back photo for stage 1b from `images.json`: per role a no-model photo first, else the
 * first photo of that role that shows the whole garment, else the first of that role. `override`
 * picks positions by hand.
 */
export function shopPhotoChoice(imagesJson: unknown, handle: string, override: { front?: number; back?: number } = {}): ShopPhotoChoice {
  const all = (imagesJson as { products?: Record<string, ShopImage[]> })?.products?.[handle];
  if (!Array.isArray(all) || !all.length) throw new Error(`images.json has no images for ${handle}`);
  const why: string[] = [];
  const pick = (role: 'front' | 'back'): ShopImage | null => {
    const wanted = override[role];
    if (wanted !== undefined) {
      const img = all.find((i) => i.position === wanted);
      if (!img) throw new Error(`${handle} has no image at position ${wanted}`);
      why.push(`${role}: image ${wanted} chosen by hand (${img.role}${img.onModel ? ', on model' : ', no model'})`);
      return img;
    }
    const ofRole = all.filter((i) => i.role === role);
    const img = ofRole.find(noModel) ?? ofRole.find((i) => i.garmentFullyVisible) ?? ofRole[0] ?? null;
    if (img) why.push(`${role}: image ${img.position} (${noModel(img) ? 'no model, plain background' : `on model${img.garmentFullyVisible ? ', garment fully visible' : ', garment partly hidden'}`})`);
    else why.push(`${role}: no ${role} image; stage 1b will INVENT it (validation only, D13)`);
    return img;
  };
  const front = pick('front');
  if (!front) throw new Error(`${handle} has no front image; stage 1b needs one`);
  const back = pick('back');
  return { front, back, sourceKind: front.onModel ? 'on_model' : 'flat_lay', why };
}

/** Bytes of a shop image as stored in raw/, or undefined when it is not there. */
export type ShopImageReader = (handle: string, image: ShopImage) => { bytes: Uint8Array; ext: string; file: string } | undefined;

/**
 * The chosen shop images as exporter photo inputs. Throws when an image is missing (with the command
 * that downloads it), when images.json has no sha256 for it, or when its bytes differ from the
 * COMMITTED sha256 in `images.json` (the shop changed or reordered it, so the hand classification may
 * describe another photo). Re-downloading never gets past this check; only a reviewed classification
 * and a rebuilt images.json do.
 */
export function shopPhotos(shop: ShopId, handle: string, choice: ShopPhotoChoice, read: ShopImageReader, sha: (b: Uint8Array) => string): { role: 'front' | 'back'; bytes: Uint8Array; ext: string; source: string }[] {
  const fetchHint = `run \`pnpm --filter @curtain/garment-spike shop:${shop} -- --fetch-images\` first (raw/ is gitignored; it checks the bytes against the committed images.json)`;
  const out: { role: 'front' | 'back'; bytes: Uint8Array; ext: string; source: string }[] = [];
  for (const role of ['front', 'back'] as const) {
    const img = choice[role];
    if (!img) continue;
    if (!img.sha256) throw new Error(`${shop} image ${handle} #${img.position} has no sha256 in data/${shop}/images.json, so its hand classification is not pinned to any bytes`);
    const got = read(handle, img);
    if (!got) throw new Error(`${shop} image ${handle} #${img.position} is not in data/${shop}/raw/; ${fetchHint}`);
    if (sha(got.bytes) !== img.sha256) {
      throw new Error(
        `${shop} image ${handle} #${img.position} (${got.file}) differs from the committed sha256 in images.json: the shop changed or reordered its photos, so the hand classification ` +
          `(${img.role}, ${img.onModel ? 'on model' : 'no model'}) may describe another photo. Do not re-fetch to get past this: look at the photos, update SHOP_IMAGE_CLASSIFICATION ` +
          `in src/shopSelection.ts, rebuild images.json with \`shop:${shop} -- --fetch --accept-image-changes\` and commit both`,
      );
    }
    out.push({ role, bytes: got.bytes, ext: got.ext, source: `${shop} ${got.file} (#${img.position}, ${img.role}, ${img.onModel ? 'on model' : 'no model'})` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video prompt: a neutral garment description, never the product title or the brand
// ---------------------------------------------------------------------------

/**
 * 0.2.0 (after run 13): the colour never comes from a word of the product name. Shop names such as "Azure Palm",
 * "Rosewater" or "Earthweave Rust" name a print or a collection, not the garment's colour: run 13's Qwen engine
 * read "blue" (from "Azure") and painted a solid blue dress, where the garment is a pastel tropical print on cream.
 * The colour is `primaryColorHex` (merchant data) or none; for shop photos stage 1b measures it from the garment
 * cut-out (`phase0_dress.garment_colour`) and puts it in its own instruction.
 */
export const PROMPT_VERSION = 'neutral-prompt-0.2.0';

/** Basic colour names and their sRGB, for the nearest-colour name of `primaryColorHex`. */
const BASIC_COLOURS: readonly [string, [number, number, number]][] = [
  ['black', [17, 17, 17]], ['charcoal grey', [64, 64, 64]], ['grey', [128, 128, 128]], ['light grey', [200, 200, 200]], ['white', [250, 250, 250]],
  ['cream', [242, 235, 221]], ['beige', [215, 196, 160]], ['camel', [193, 154, 107]], ['brown', [110, 70, 40]], ['burgundy', [107, 31, 42]],
  ['red', [200, 30, 40]], ['coral', [255, 110, 90]], ['orange', [235, 130, 30]], ['mustard yellow', [215, 170, 40]], ['yellow', [245, 220, 80]],
  ['olive green', [91, 107, 60]], ['green', [40, 140, 70]], ['sage green', [160, 180, 150]], ['teal', [20, 120, 120]], ['light blue', [150, 190, 230]],
  ['blue', [40, 90, 190]], ['navy blue', [30, 40, 85]], ['purple', [110, 60, 150]], ['lilac', [195, 170, 215]], ['pink', [235, 150, 175]],
];

export interface PromptColour {
  name: string | null;
  source: string;
}

/**
 * The garment's colour as a plain colour name: from `primaryColorHex` (merchant data), else none. Never from a word of
 * the product name (a print or collection name, see `PROMPT_VERSION`). With no colour the stage 2 prompt names none: the
 * pinned stills carry it, and stage 1b measures it from the shop photo's garment cut-out for its own instruction.
 */
export function promptColour(p: Pick<GarmentPayload, 'primaryColorHex'>): PromptColour {
  const hex = p.primaryColorHex as string | undefined;
  if (hex && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    let best = BASIC_COLOURS[0]!;
    let bestD = Infinity;
    for (const c of BASIC_COLOURS) {
      const d = (c[1][0] - rgb[0]!) ** 2 + (c[1][1] - rgb[1]!) ** 2 + (c[1][2] - rgb[2]!) ** 2;
      if (d < bestD) [best, bestD] = [c, d];
    }
    return { name: best[0], source: `primaryColorHex ${hex} → nearest basic colour` };
  }
  return {
    name: null,
    source: 'no primaryColorHex: no colour in the prompt (product-name words are print or collection names, never a colour); stage 1b measures it from the garment cut-out',
  };
}

/** Plain style words per kind; only these ever come from the product's subcategory or pattern block. */
const STYLE_WORDS: Readonly<Record<ProxyKind, readonly [RegExp, string][]>> = {
  dress: [[/shirt/i, 'shirt dress'], [/slip/i, 'slip dress'], [/wrap/i, 'wrap dress'], [/baby-?doll/i, 'babydoll dress'], [/empire/i, 'empire-waist dress'], [/a-?line/i, 'A-line dress'], [/shift/i, 'shift dress'], [/tier/i, 'tiered dress']],
  skirt: [[/a-?line/i, 'A-line skirt'], [/pencil/i, 'pencil skirt'], [/wrap/i, 'wrap skirt'], [/tier/i, 'tiered skirt'], [/pleat/i, 'pleated skirt']],
  trousers: [[/short/i, 'shorts'], [/jean|denim/i, 'jeans'], [/palazzo|wide/i, 'wide-leg trousers'], [/culotte/i, 'culottes'], [/flare|bootcut/i, 'flared trousers'], [/skinny|slim/i, 'slim trousers']],
  top: [[/t-?shirt|tee/i, 't-shirt'], [/blouse/i, 'blouse'], [/shirt/i, 'shirt'], [/cami/i, 'camisole'], [/tank/i, 'tank top'], [/jumper|sweater|knit/i, 'jumper']],
  outerwear: [[/cardi/i, 'cardigan'], [/blazer/i, 'blazer'], [/coat/i, 'coat'], [/kimono/i, 'kimono'], [/vest|gilet/i, 'vest'], [/jacket/i, 'jacket']],
};
const KIND_NOUN: Readonly<Record<ProxyKind, string>> = { dress: 'dress', skirt: 'skirt', trousers: 'trousers', top: 'top', outerwear: 'jacket' };

/** Always in the negative prompt: the first GPU run rendered the product name as text in a frame. */
export const NEGATIVE_BASE = [
  'text', 'letters', 'words', 'captions', 'typography', 'watermark', 'logo', 'label', 'brand name', 'signature',
  'blurry', 'distorted', 'deformed', 'extra limbs', 'people', 'face', 'hands of a person', 'busy background', 'flicker', 'static frame',
] as const;
/** Per kind: the garment the first GPU run drifted into must not appear. */
export const NEGATIVE_BY_KIND: Readonly<Record<ProxyKind, readonly string[]>> = {
  dress: ['trousers', 'pants', 'shorts', 'jumpsuit', 'two separate legs of fabric'],
  skirt: ['trousers', 'pants', 'shorts', 'jumpsuit', 'two separate legs of fabric'],
  trousers: ['dress', 'skirt', 'gown', 'one closed skirt between the legs'],
  top: ['dress', 'long skirt'],
  outerwear: ['dress', 'long skirt'],
};

export interface VideoPrompt {
  version: typeof PROMPT_VERSION;
  kind: ProxyKind;
  description: string;
  colour: PromptColour;
  turntable: string;
  motion: string;
  negative: string;
}

function lengthWord(m: Mannequin, kind: ProxyKind, hemY: number): string {
  const h = m.morphHeights;
  if (kind === 'trousers') return hemY <= h.ankle + 6 ? 'full-length' : hemY >= h.thigh - 8 ? '' : 'cropped';
  if (kind === 'top' || kind === 'outerwear') return hemY < h.thigh ? 'long' : hemY > h.waist ? 'cropped' : '';
  // Proxy 0.2.0 ends a printed flat-lay length higher than a vertical drop did (run 14's 91 cm: 9 cm above the knee): "above-knee", not a mini.
  if (hemY > h.knee + 16) return 'short';
  if (hemY > h.knee + 6) return 'above-knee';
  if (hemY >= h.knee - 4) return 'knee-length';
  if (hemY > h.ankle + 8) return 'midi';
  return 'ankle-length maxi';
}

function sleeveWord(m: Mannequin, kind: ProxyKind, sleeveCm: number, given: boolean): string {
  if (kind === 'skirt' || kind === 'trousers' || (!given && kind !== 'outerwear')) return '';
  if (sleeveCm <= 0) return 'sleeveless';
  if (sleeveCm >= m.morphHeights.wrist - 4) return 'long-sleeved';
  if (sleeveCm >= m.arms.left.upperArmCm - 2) return 'three-quarter-sleeved';
  return 'short-sleeved';
}

function fabricWords(mat: MaterialJson): string {
  const fibres = mat.fibres.filter((f) => f.pct >= 20).map((f) => f.id.replace(/_/g, ' '));
  const weight = mat.weightGsm < 140 ? 'lightweight' : mat.weightGsm > 250 ? 'heavy' : '';
  const hand = mat.drape >= 0.7 ? 'fluid' : mat.drape <= 0.35 ? 'crisp' : '';
  const adj = [weight, hand].filter(Boolean).join(', ');
  const what = [mat.construction ? mat.construction.replace(/_/g, ' ') : '', fibres.join(' and ')].filter(Boolean).join(' ');
  return `${adj ? `${adj} ` : ''}${what || 'woven'} fabric`;
}

/**
 * The stage 2 prompts: a neutral description from category, colour, length, sleeves and fabric, made
 * only of fixed vocabulary, so neither the product title nor the brand (nor any other shop text) can
 * reach the video model. The negative prompt bans text and logos, and the garment the run drifted into.
 */
export function videoPrompt(m: Mannequin, p: GarmentPayload, spec: Pick<ProxySpec, 'kind' | 'hemY' | 'sleeveCm'>): VideoPrompt {
  const kind = spec.kind;
  const colour = promptColour(p);
  const style = STYLE_WORDS[kind].find(([re]) => re.test(`${p.subcategory ?? ''} ${p.patternBlock ?? ''}`))?.[1] ?? KIND_NOUN[kind];
  const given = (p.lengthCm as Partial<Record<string, number>> | undefined)?.sleeve_length !== undefined;
  const words = [colour.name ?? '', lengthWord(m, kind, spec.hemY), sleeveWord(m, kind, spec.sleeveCm, given), style].filter(Boolean).join(' ');
  const plural = kind === 'trousers' && !/skirt|dress/.test(style);
  const shape =
    kind === 'dress' || kind === 'skirt'
      ? ', one closed skirt that falls from the waist to the hem and covers both legs'
      : kind === 'trousers'
        ? ', two separate trouser legs from the hip to the hem'
        : '';
  const description = `${plural ? '' : /^[aeiou]/i.test(words) ? 'an ' : 'a '}${words} in a ${fabricWords(materialJson(p))}${shape}`;
  const cap = description.charAt(0).toUpperCase() + description.slice(1);
  return {
    version: PROMPT_VERSION,
    kind,
    description,
    colour,
    turntable: `${cap}, dressed on a plain mid-grey studio mannequin, rotating slowly on a turntable, neutral soft studio light, plain light-grey seamless background, locked camera, sharp fabric detail.`,
    motion: `${cap}, dressed on a plain mid-grey studio mannequin that raises and lowers its arms, turns around and takes a step; the fabric moves naturally; neutral studio light, plain light-grey background, locked camera.`,
    negative: [...NEGATIVE_BASE, ...NEGATIVE_BY_KIND[kind]].join(', '),
  };
}

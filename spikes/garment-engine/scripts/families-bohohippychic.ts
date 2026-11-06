/**
 * Cut families for bohohippychic.com.au: the whole public catalogue grouped into families of one
 * cut in several colours or prints (src/families.ts), with a reference member per family.
 *
 *   pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch      # catalogue pages into raw/ (once)
 *   pnpm --filter @curtain/garment-spike families:bohohippychic -- --fetch  # + main photos for the silhouette check
 *   pnpm --filter @curtain/garment-spike families:bohohippychic             # offline: silhouettes from what raw/ has
 *
 * Options: --fetch (download the main photo of every member of a multi-member text family, as a
 * 200 px wide PNG from the Shopify CDN), --no-silhouette (text rules only), --threshold <iou>,
 * --out <file> (also write the result there, e.g. under out/ so a CI run uploads it).
 *
 * Reads  data/bohohippychic/raw/products-page<N>.json and raw/<handle>/main-w200.png (gitignored);
 *        raw/<handle>/main-mask.png (0/255 garment mask of the main photo, any size, made by a
 *        segmentation model elsewhere) wins over the border-colour mask when present.
 * Writes data/bohohippychic/families.json (text only: handles, titles, numbers; no image bytes).
 * Downloads are untrusted: JSON goes through JSON.parse, images through the PNG decoder with its
 * size checks, and nothing read from the shop is executed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { decodeAnyPng, maskFromPng } from '../src/evalPng';
import { ASSET_TYPES, BOILERPLATE_SENTENCES, PENDING_ASSET_TYPES, SILHOUETTE_SPLIT_IOU, SIMILAR_DESCRIPTION_JACCARD, SIMILAR_MIN_NUMBERS, buildFamilies, familyCounts, nearMisses, referenceOrder, textFamilyKey, type Family, type FamilyInput } from '../src/families';
import { SIL_H, SIL_W, maskSilhouette, photoSilhouette, silhouetteIou, type Silhouette } from '../src/familiesSilhouette';
import { SHOP, type ShopifyProduct } from '../src/shop';
import { SHOP_IMAGE_CLASSIFICATION } from '../src/shopSelection';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fetch: { type: 'boolean', default: false },
    'no-silhouette': { type: 'boolean', default: false },
    threshold: { type: 'string' },
    out: { type: 'string' },
  },
});

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(pkgDir, 'data', 'bohohippychic');
const rawDir = join(dataDir, 'raw');
const UA = "curtain-garment-validation/0.1 (with the shop owner's consent)";
const SIL_FILE = 'main-w200.png';
const MASK_FILE = 'main-mask.png';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const threshold = values.threshold !== undefined ? Number(values.threshold) : SILHOUETTE_SPLIT_IOU;
if (!(threshold > 0 && threshold < 1)) throw new Error(`--threshold ${values.threshold}: use a number between 0 and 1`);

function loadCatalogue(): { products: ShopifyProduct[]; pages: string[] } {
  if (!existsSync(rawDir)) throw new Error(`${relative(pkgDir, rawDir)} is missing; run \`shop:bohohippychic -- --fetch\` first`);
  const pages = readdirSync(rawDir)
    .filter((f) => /^products-page\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!pages.length) throw new Error(`no products-page<N>.json in ${relative(pkgDir, rawDir)}; run \`shop:bohohippychic -- --fetch\` first`);
  const byId = new Map<number, ShopifyProduct>();
  for (const f of pages) {
    const parsed = JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as { products: ShopifyProduct[] };
    for (const p of parsed.products) byId.set(p.id, p);
  }
  return { products: [...byId.values()], pages };
}

/** The main photo as a 200 px wide PNG (the CDN converts; the original is a JPEG we cannot decode without a dependency). */
function silhouetteUrl(src: string): string {
  const u = new URL(src);
  u.searchParams.set('width', '200');
  u.searchParams.set('format', 'png');
  return u.toString();
}

async function fetchMainPhoto(p: ShopifyProduct): Promise<void> {
  const img = p.images[0];
  if (!img) return;
  const file = join(rawDir, p.handle, SIL_FILE);
  if (existsSync(file)) return;
  const url = silhouetteUrl(img.src);
  if (new URL(url).hostname !== 'cdn.shopify.com') throw new Error(`${p.handle}: main photo is not on cdn.shopify.com (${url})`);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error(`${url}: not a PNG`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
}

interface SilRecord {
  silhouette: Silhouette | null;
  foregroundShare: number | null;
  source: 'mask' | 'photo' | null;
  reason?: string;
}

function readSilhouette(p: ShopifyProduct): SilRecord {
  const maskFile = join(rawDir, p.handle, MASK_FILE);
  if (existsSync(maskFile)) {
    try {
      const s = maskSilhouette(maskFromPng(decodeAnyPng(new Uint8Array(readFileSync(maskFile)))));
      return s ? { silhouette: s, foregroundShare: null, source: 'mask' } : { silhouette: null, foregroundShare: null, source: null, reason: `${MASK_FILE} is empty` };
    } catch (err) {
      return { silhouette: null, foregroundShare: null, source: null, reason: `${MASK_FILE}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const file = join(rawDir, p.handle, SIL_FILE);
  if (!existsSync(file)) return { silhouette: null, foregroundShare: null, source: null, reason: 'main photo not downloaded (run with --fetch)' };
  try {
    const r = photoSilhouette(decodeAnyPng(new Uint8Array(readFileSync(file))));
    return r.reason ? { silhouette: null, foregroundShare: r.foregroundShare, source: null, reason: r.reason } : { silhouette: r.silhouette, foregroundShare: r.foregroundShare, source: 'photo' };
  } catch (err) {
    return { silhouette: null, foregroundShare: null, source: null, reason: `decode failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function quantiles(xs: number[]): { n: number; min: number; p10: number; median: number; p90: number; max: number } | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => Math.round(s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))]! * 1000) / 1000;
  return { n: s.length, min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
}

/** One line per single-member family: id, product type, handle, asset eligible. */
function singleLine(f: Family): string {
  return JSON.stringify({ id: f.id, productType: f.productType, handle: f.reference, assetEligible: f.assetEligible });
}

async function main(): Promise<void> {
  const { products, pages } = loadCatalogue();

  // Text families first: only their members need a silhouette.
  const byText = new Map<string, ShopifyProduct[]>();
  for (const p of products) {
    const k = textFamilyKey(p);
    byText.set(k, [...(byText.get(k) ?? []), p]);
  }
  const needSil = [...byText.values()].filter((g) => g.length > 1).flat();
  const sil = new Map<string, SilRecord>();
  if (!values['no-silhouette']) {
    if (values.fetch) {
      let n = 0;
      for (const p of needSil) {
        await fetchMainPhoto(p);
        if (++n % 25 === 0) console.log(`[families] main photos ${n}/${needSil.length}`);
      }
    }
    for (const p of needSil) sil.set(p.handle, readSilhouette(p));
  }

  const inputs: FamilyInput[] = products.map((p) => {
    const cls = SHOP_IMAGE_CLASSIFICATION[p.handle]?.find((c) => c.position === (p.images[0]?.position ?? 1));
    const x: FamilyInput = { product: p, silhouette: sil.get(p.handle)?.silhouette ?? null };
    if (cls) x.mainOnModel = cls.onModel;
    return x;
  });
  const families = buildFamilies(inputs, { silhouetteThreshold: threshold });
  const counts = familyCounts(families);
  const eligible = families.filter((f) => f.assetEligible);
  const eligibleCounts = familyCounts(eligible);
  const pendingCounts = familyCounts(families.filter((f) => f.pendingCategory !== undefined));
  const misses = nearMisses(families);
  const missEligible = misses.filter((m) => m.assetEligible);
  const missPending = misses.filter((m) => m.pending);
  const missSavable = missEligible.reduce((n, m) => n + m.families.length - 1, 0);

  // Calibration of the silhouette threshold: IoU of members against their text family's reference,
  // and of references of different text families of the same product type (different cuts).
  const within: number[] = [];
  const across: number[] = [];
  const refs = new Map<string, Array<{ key: string; s: Silhouette }>>();
  for (const [key, group] of byText) {
    if (group.length < 2) continue;
    const ordered = group.map((p) => ({ product: p })).sort(referenceOrder);
    const ref = sil.get(ordered[0]!.product.handle)?.silhouette;
    if (!ref) continue;
    for (const o of ordered.slice(1)) {
      const s = sil.get(o.product.handle)?.silhouette;
      if (s) within.push(silhouetteIou(ref, s));
    }
    const type = ordered[0]!.product.product_type;
    refs.set(type, [...(refs.get(type) ?? []), { key, s: ref }]);
  }
  for (const list of refs.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) across.push(silhouetteIou(list[i]!.s, list[j]!.s));
  const silFailures = [...sil.entries()].filter(([, r]) => !r.silhouette).map(([handle, r]) => ({ handle, reason: r.reason ?? 'unknown' }));

  const out = {
    format: 'curtain.garment.families',
    formatVersion: 1,
    shop: SHOP,
    source: `https://${SHOP.domain}/products.json?limit=250&page=N (public storefront endpoint), pages ${pages.join(', ')}`,
    method: {
      rules: [
        'same product_type',
        'same size option values (trimmed, upper case, order ignored)',
        'same title stem: title tokens without colour words, print words and variant codes like PWP1 (src/families.ts COLOUR_WORDS, SHADE_MODIFIERS next to a colour, PRINT_WORDS, /^[a-z]{2,4}\\d{1,3}$/)',
        `same description key: sentences without shop boilerplate (${BOILERPLATE_SENTENCES.length} patterns: "not included", colour disclaimers, styling advice, model notes), lower case, punctuation dropped, colour/print/code words and the member's own variant name removed; numbers (measurements) kept`,
        `or (rule 4b) a similar description key: same type, sizes and title stem, the same numbers in the same order (at least ${SIMILAR_MIN_NUMBERS}), and token-set Jaccard >= ${SIMILAR_DESCRIPTION_JACCARD}; complete linkage, so similarity never chains. Absorbs one-phrase copy edits ("Best seller in store", "Crafted in a deep navy,"). Members joined this way carry descriptionJaccard and a note; families with one have textMatch "similar"`,
        `silhouette check on the main photo when downloaded: ${MASK_FILE} when present, else the foreground against the border colours (plain backdrops only: at most 4 border colours, subject not cut off at the top or sides), bounding box scaled to ${SIL_W}×${SIL_H}, IoU (mirror allowed) against the cluster seed; below ${threshold} = a different cut, the family is split (ids with ~2, ~3)`,
      ],
      reference: 'best photos: main photo classified as without a model first (images.json; the five validation products only), then the largest main photo (pixels), then the most images, then the handle',
      ownAsset: 'a member whose fabric or size chart (buildShopPayload: fabric, sizeChartType, sizeChart, ease, lengthCm) differs from the reference needs its own full run; every other member only needs stage 4b (re-texture)',
      assetEligible: `product types the engine builds assets for today: ${[...ASSET_TYPES].join(', ')}`,
      pendingCategory: Object.entries(PENDING_ASSET_TYPES).map(([type, missing]) => `${type}: eligible once the category exists (${missing}); counted in counts.pendingCategory, not in counts.assetEligible`),
      limits: [
        'Every main photo on this shop is on a model in a styled set (busy background, legs or head cut off), so no reference is "without a model" and the border-colour mask refuses the photos (silhouette.failedByReason). The silhouette check is implemented and tested on fixtures but splits nothing here; it needs plain-backdrop photos or garment masks from a segmentation model (main-mask.png, e.g. stage 1b Grounding DINO + SAM 2 on Modal).',
        `Rule 4b joins one-phrase copy edits only when the measurement numbers are equal and at least ${SIMILAR_MIN_NUMBERS}; copy without measurements, or rewritten more than that (e.g. one of the Earthweave tops), stays its own family. Such near misses cost a full run, never a wrong merge.`,
        'Title stems are over-stripped where a print word is also part of the name (Desert Bloom → "desert dress"); this only changes ids, since the description must still match.',
        'Size labels are compared as written: "L-XL" and "LG-XL" are different values.',
      ],
    },
    silhouette: {
      enabled: !values['no-silhouette'],
      threshold,
      photo: `${SIL_FILE}: the main photo at width 200 as PNG from the Shopify CDN, in raw/<handle>/ (gitignored)`,
      checkedMembers: [...sil.values()].filter((r) => r.silhouette).length,
      fromMask: [...sil.values()].filter((r) => r.source === 'mask').length,
      failed: silFailures.length,
      failedByReason: Object.entries(
        silFailures.reduce<Record<string, number>>((acc, f) => {
          const k = f.reason.split(':')[0]!;
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([reason, count]) => ({ reason, count })),
      failedExamples: silFailures.slice(0, 5),
      calibration: {
        withinTextFamily: quantiles(within),
        acrossFamiliesSameType: quantiles(across),
        note: 'withinTextFamily: members against their text family reference; acrossFamiliesSameType: references of different text families of one product type (different cuts). The threshold sits where few within-family pairs fall below it.',
      },
    },
    counts: {
      all: counts,
      assetEligible: eligibleCounts,
      pendingCategory: pendingCounts,
      note: 'assetEligible = types the engine can build today; pendingCategory = garment types it cannot build yet (no category or proxy), NOT included in assetEligible; productsSaved = members that only need stage 4b instead of a full run; fullRuns = one per family plus every member with ownAsset',
    },
    nearMisses: {
      note: 'Same product type, sizes and title stem, but description keys that are neither equal nor similar under rule 4b (different measurements, no measurements, or more rewritten copy), so different families. The rules never merge them. Some are one cut with rewritten copy (Earthweave Knit Top, Nomad Cotton Jacket), others are different cuts with a generic stem ("maxi dress" after removing print names); a merchant who confirms one cut saves one full run per extra family, so the savable number is an upper bound.',
      groups: misses.length,
      assetEligibleGroups: missEligible.length,
      assetEligibleRunsSavableIfConfirmed: missSavable,
      pendingCategoryGroups: missPending.length,
      list: misses,
    },
    families: families.filter((f) => f.members.length > 1),
    singleProductFamilies: '__SINGLES__',
  };
  const singles = families.filter((f) => f.members.length === 1).map((f) => `    ${singleLine(f)}`).join(',\n');
  const text = JSON.stringify(out, null, 2).replace('"__SINGLES__"', `[\n${singles}\n  ]`);
  JSON.parse(text); // still valid JSON
  writeFileSync(join(dataDir, 'families.json'), `${text}\n`);
  if (values.out) {
    const extra = resolve(values.out);
    mkdirSync(dirname(extra), { recursive: true });
    writeFileSync(extra, `${text}\n`);
    console.log(`[families] also wrote ${extra}`);
  }

  console.log(`[families] ${counts.products} products → ${counts.families} families (${counts.multiMemberFamilies} with more than one member); full runs ${counts.fullRuns}, saved ${counts.productsSaved}`);
  console.log(`[families] asset types: ${eligibleCounts.products} products → ${eligibleCounts.families} families; full runs ${eligibleCounts.fullRuns}, saved ${eligibleCounts.productsSaved}`);
  console.log(`[families] not buildable yet (${Object.keys(PENDING_ASSET_TYPES).join(', ')}): ${pendingCounts.products} products → ${pendingCounts.families} families; full runs ${pendingCounts.fullRuns}, saved ${pendingCounts.productsSaved} once the category exists`);
  console.log(`[families] joined by rule 4b (similar description, equal measurements): ${counts.membersBySimilarity} members (${eligibleCounts.membersBySimilarity} in asset types)`);
  console.log(`[families] near misses (same stem, different copy): ${missEligible.length} groups in asset types, ${missSavable} more runs saved at most if the merchant confirms them`);
  console.log(`[families] silhouettes: ${out.silhouette.checkedMembers} checked, ${silFailures.length} without a mask, ${counts.silhouetteSplits} splits at IoU < ${threshold}`);
  for (const f of families.filter((x) => x.members.length > 2).slice(0, 15)) {
    console.log(`[families] ${String(f.members.length).padStart(3)} × ${f.id} (reference ${f.reference})`);
  }
  console.log(`[families] wrote ${relative(pkgDir, join(dataDir, 'families.json'))}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

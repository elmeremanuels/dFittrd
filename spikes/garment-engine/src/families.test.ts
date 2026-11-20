import { describe, expect, it } from 'vitest';
import type { DecodedPng } from './evalPng';
import {
  ASSET_TYPES,
  PENDING_ASSET_TYPES,
  SIMILAR_DESCRIPTION_JACCARD,
  buildFamilies,
  descriptionJaccard,
  descriptionKey,
  familyCounts,
  measurementNumbers,
  mergeSimilarGroups,
  nearMisses,
  referenceOrder,
  similarDescriptions,
  sizeValues,
  splitBySilhouette,
  textFamilyKey,
  titleParts,
  tokens,
  type FamilyInput,
} from './families';
import { FAMILY_FIXTURES } from './familiesFixtures';
import { SIL_H, SIL_W, maskSilhouette, photoSilhouette, silhouetteIou } from './familiesSilhouette';
import { inferCategory } from '@curtain/schema';
import type { ShopifyProduct } from './shop';

const { earthweave, earthweaveNavy, pwp, guards } = FAMILY_FIXTURES;
const inputs = (ps: readonly ShopifyProduct[]): FamilyInput[] => ps.map((product) => ({ product }));

// --- synthetic product photos (plain backdrop) -------------------------------------------------------

type Shape = (x: number, y: number) => boolean;

function photo(shape: Shape, opts: { w?: number; h?: number; bg?: [number, number, number]; fg?: [number, number, number]; scale?: number; dx?: number; busy?: boolean } = {}): DecodedPng {
  const w = opts.w ?? 120, h = opts.h ?? 180;
  const bg = opts.bg ?? [236, 233, 228];
  const fg = opts.fg ?? [60, 90, 140];
  const s = opts.scale ?? 1, dx = opts.dx ?? 0;
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Shape coordinates in a unit box (0..1) centred in the frame, scaled by s.
      const u = (x - w / 2 - dx) / (w * 0.8 * s) + 0.5;
      const v = (y - h / 2) / (h * 0.8 * s) + 0.5;
      const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1 && shape(u, v);
      let c = inside ? fg : bg;
      if (!inside && opts.busy) c = [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256];
      data.set(c, (y * w + x) * 3);
    }
  }
  return { width: w, height: h, channels: 3, data };
}

/** A boxy top with wide sleeves. */
const TOP: Shape = (u, v) => (v < 0.75 && u > 0.2 && u < 0.8) || (v > 0.05 && v < 0.35 && u > 0.02 && u < 0.98);
/** Trousers: two legs from a waistband, narrower than the top's sleeves. */
const TROUSERS: Shape = (u, v) => (v < 0.15 && u > 0.3 && u < 0.7) || (u > 0.3 && u < 0.48) || (u > 0.52 && u < 0.7);

function silhouetteOf(img: DecodedPng) {
  const r = photoSilhouette(img);
  if (!r.silhouette) throw new Error(r.reason);
  return r.silhouette;
}

// --- text rules ---------------------------------------------------------------------------------

describe('text keys', () => {
  it('tokenises with apostrophes and case folded', () => {
    expect(tokens("Camis, tee’s & Dresses")).toEqual(['camis', 'tees', 'dresses']);
    expect(tokens("camis, tee's &amp; dresses")).toEqual(['camis', 'tees', 'amp', 'dresses']);
    expect(tokens('Tie-Dye Maxi')).toEqual(['tiedye', 'maxi']);
  });

  it('strips colour, shade, print and code words from titles', () => {
    expect(titleParts('Earthweave Knit Top Denim Blue')).toMatchObject({ stem: 'earthweave knit top', variant: 'Denim Blue' });
    expect(titleParts('Earthweave Knit Top Light Grey').stem).toBe('earthweave knit top');
    expect(titleParts('Earthweave Knit Top Gucci Green').stem).toBe('earthweave knit top');
    expect(titleParts('Bohemian Wanderer Patchwork Pants PWP4')).toMatchObject({ stem: 'bohemian wanderer patchwork pants', variant: 'PWP4' });
    expect(titleParts('Starlight Cotton Silver Grey Tee').stem).toBe('starlight cotton tee');
    // A shade word that is not next to a colour stays: "Light" here is part of the name.
    expect(titleParts('Light Breeze Blouse').stem).toBe('light breeze blouse');
    // `denim` is a fabric unless it sits next to a colour.
    expect(titleParts('Vintage Patchwork Floral Denim Pants').stem).toBe('vintage patchwork denim pants');
  });

  it('drops boilerplate sentences and the own variant name from the description', () => {
    const a = '<p>Relaxed fit. Length 53cm.</p><p>Colour: Coral</p><p>Singlet is not included.</p>';
    const b = '<p>Relaxed fit. Length 53cm.</p><p>We make every effort to present our product colours as accurately as possible.</p>';
    expect(descriptionKey(a, ['coral'])).toBe(descriptionKey(b, ['lilac']));
    expect(descriptionKey(a)).toBe('relaxed fit length 53cm');
    // Measurements stay in the key.
    expect(descriptionKey('<p>Relaxed fit. Length 55cm.</p>')).not.toBe(descriptionKey(a));
  });

  it('compares size option values as a set', () => {
    const p = { ...earthweave[0]!, options: [{ name: 'Size', values: ['s-m ', 'L-XL'] }] };
    expect(sizeValues(p)).toEqual(['L-XL', 'S-M']);
  });
});

// --- families on the fixtures -------------------------------------------------------------------

describe('cut families on bohohippychic fixtures', () => {
  it('groups the 14 Earthweave Knit Top colours into one family despite copy differences', () => {
    expect(earthweave).toHaveLength(14);
    const keys = new Set(earthweave.map(textFamilyKey));
    expect(keys.size).toBe(1);
    const fams = buildFamilies(inputs(earthweave));
    expect(fams).toHaveLength(1);
    const f = fams[0]!;
    expect(f.id).toBe('tops/earthweave-knit-top');
    expect(f.cutName).toBe('Earthweave Knit Top');
    expect(f.members).toHaveLength(14);
    // Every main photo is 800×1200 on a model; Steel Grey wins on image count (2).
    expect(f.reference).toBe('earthweave-knit-top-steel-grey');
    expect(f.members.filter((m) => m.ownAsset).map((m) => m.handle)).toEqual(['earthweave-knit-top-steel-grey']);
    expect(f.members.every((m) => !m.fabricDiffers && !m.chartDiffers)).toBe(true);
    expect(familyCounts(fams)).toMatchObject({ products: 14, families: 1, productsSaved: 13, fullRuns: 1 });
  });

  it('joins the one-phrase Navy copy edit by rule 4b (same measurements), and only with rule 4b on', () => {
    // Navy differs by "Crafted in a deep navy," and the Colour line; Length 53cm and Chest 126cm are equal.
    const fams = buildFamilies(inputs([...earthweave, earthweaveNavy]));
    expect(fams).toHaveLength(1);
    expect(fams[0]!.textMatch).toBe('similar');
    const navy = fams[0]!.members.find((m) => m.handle === 'earthweave-knit-top-navy')!;
    expect(navy.descriptionJaccard).toBeGreaterThanOrEqual(SIMILAR_DESCRIPTION_JACCARD);
    expect(navy.descriptionJaccard).toBeLessThan(1);
    expect(navy.notes.join(' ')).toMatch(/rule 4b/);
    expect(fams[0]!.members.filter((m) => m.handle !== 'earthweave-knit-top-navy').every((m) => m.descriptionJaccard === null)).toBe(true);
    expect(familyCounts(fams)).toMatchObject({ products: 15, families: 1, productsSaved: 14, membersBySimilarity: 1 });
    expect(nearMisses(fams)).toHaveLength(0);

    // Exact keys only: Navy is its own family and a near miss.
    const strict = buildFamilies(inputs([...earthweave, earthweaveNavy]), { similarJaccard: false });
    expect(strict).toHaveLength(2);
    expect(strict[1]!.members.map((m) => m.handle)).toEqual(['earthweave-knit-top-navy']);
    expect(strict.every((f) => f.textMatch === 'exact')).toBe(true);
    expect(nearMisses(strict)[0]).toMatchObject({ stem: 'earthweave knit top', products: 15, assetEligible: true, pending: false });
  });

  it('never joins by similarity when the measurements differ or are missing', () => {
    const navy = earthweaveNavy;
    const longer: ShopifyProduct = { ...navy, handle: 'earthweave-knit-top-navy-long', body_html: navy.body_html!.replace(/53\s*cm/i, '58cm') };
    expect(measurementNumbers(descriptionKey(longer.body_html))).not.toEqual(measurementNumbers(descriptionKey(navy.body_html)));
    expect(buildFamilies(inputs([...earthweave, longer]))).toHaveLength(2);

    // No numbers at all: copy that is 95 % equal is still two families.
    const a = 'relaxed boxy top with wide sleeves and a soft open knit for layering over camis and dresses every day';
    expect(similarDescriptions(a, `${a} best seller in store`)).toBe(false);
    const withNumbers = `${a} length 53cm chest 126cm`;
    expect(descriptionJaccard(withNumbers, `${withNumbers} best seller`)).toBeGreaterThanOrEqual(0.9);
    expect(similarDescriptions(withNumbers, `${withNumbers} best seller`)).toBe(true);
    expect(similarDescriptions(withNumbers, withNumbers.replace('126cm', '130cm'))).toBe(false);
  });

  it('does not chain similarity: a group joins only when it is similar to every group already in the cluster', () => {
    const groups = [['a'], ['b'], ['c']];
    const base = earthweave[0]!;
    const letters = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
    const words = (n: number) => Array.from({ length: 40 }, (_, i) => `word${letters(i + n)}`).join(' ');
    // a~b and b~c (40 of 44 tokens shared, 0.91), but a and c share only 38 of 48 (0.79).
    const body: Record<string, string> = { a: `<p>${words(0)} 53cm 126cm</p>`, b: `<p>${words(2)} 53cm 126cm</p>`, c: `<p>${words(4)} 53cm 126cm</p>` };
    const prod = (h: string): ShopifyProduct => ({ ...base, handle: h, title: 'Fixture Knit Top', body_html: body[h]! });
    expect(similarDescriptions(descriptionKey(body.a), descriptionKey(body.b))).toBe(true);
    expect(similarDescriptions(descriptionKey(body.a), descriptionKey(body.c))).toBe(false);
    expect(mergeSimilarGroups(groups, prod)).toEqual([['a', 'b'], ['c']]);
  });
  it('groups the PWP patchwork pants (variant codes) into one family', () => {
    expect(pwp).toHaveLength(7);
    const fams = buildFamilies(inputs(pwp));
    expect(fams).toHaveLength(1);
    expect(fams[0]!.id).toBe('pants/bohemian-wanderer-patchwork-pants');
    expect(fams[0]!.members.map((m) => m.variant).sort()).toEqual(['PWP1', 'PWP2', 'PWP3', 'PWP4', 'PWP5', 'PWP6', 'PWP7']);
    // Ties on resolution: the most images, then the handle.
    expect(fams[0]!.reference).toBe('bohemian-wanderer-patchwork-pants-pwp1');
    expect(familyCounts(fams).productsSaved).toBe(6);
  });

  it('counts jumpsuits and overalls in their own pending bucket, never as asset-eligible', () => {
    const base = earthweave[0]!;
    const overalls = ['Chocolate', 'Rust'].map((c): ShopifyProduct => ({ ...base, handle: `fixture-overalls-${c.toLowerCase()}`, title: `Fixture Overalls ${c}`, product_type: 'Jumpsuits & Sets' }));
    const fams = buildFamilies(inputs([...earthweave, ...overalls]));
    const jump = fams.find((f) => f.productType === 'Jumpsuits & Sets')!;
    expect(jump.assetEligible).toBe(false);
    expect(jump.pendingCategory).toMatch(/no engine category.*no control proxy with legs/);
    expect(ASSET_TYPES.has('Jumpsuits & Sets')).toBe(false);
    expect(Object.keys(PENDING_ASSET_TYPES)).toEqual(['Jumpsuits & Sets']);
    expect(familyCounts(fams.filter((f) => f.assetEligible))).toMatchObject({ products: 14, productsSaved: 13 });
    expect(familyCounts(fams.filter((f) => f.pendingCategory !== undefined))).toMatchObject({ products: 2, productsSaved: 1 });
    // Every asset type maps to a category the exporter and proxy.ts can build ("Clothing" by the title).
    for (const t of ASSET_TYPES) expect(['dress', 'top', 'outerwear', 'bottom'], t).toContain(inferCategory(t, '', t === 'Clothing' ? 'Starlight Cotton Tee' : undefined));
    // The schema would read a jumpsuit as a dress: a proxy without legs. That is why it is pending.
    expect(inferCategory('Jumpsuits & Sets', '')).toBe('dress');
  });

  it('does not merge different cuts that share a print name', () => {
    const fams = buildFamilies(inputs(guards));
    expect(fams).toHaveLength(4);
    expect(fams.every((f) => f.members.length === 1)).toBe(true);
  });

  it('flags a member whose fabric differs from the reference as its own asset', () => {
    // "indigo denim" loses `denim` next to a colour, so the description keys stay equal, but the
    // payload reads cotton denim from the first and plain cotton from the second.
    const base = earthweave[0]!;
    const a: ShopifyProduct = { ...base, handle: 'a-top', title: 'Fixture Top Indigo', body_html: '<p>Boxy fit. Length 53cm.</p><p>Material: 100% cotton, indigo denim</p>' };
    const b: ShopifyProduct = { ...base, handle: 'b-top', title: 'Fixture Top Rust', body_html: '<p>Boxy fit. Length 53cm.</p><p>Material: 100% cotton, rust</p>', images: [] };
    expect(textFamilyKey(a)).toBe(textFamilyKey(b));
    const [f] = buildFamilies(inputs([a, b]));
    expect(f!.reference).toBe('a-top');
    const other = f!.members.find((m) => m.handle === 'b-top')!;
    expect(other.fabricDiffers).toBe(true);
    expect(other.ownAsset).toBe(true);
    expect(familyCounts([f!]).productsSaved).toBe(0);
  });
});

// --- reference choice -----------------------------------------------------------------------------

describe('reference member', () => {
  it('puts a photo without a model before a larger photo on a model', () => {
    const [a, b] = earthweave;
    const big: FamilyInput = { product: { ...a!, images: [{ ...a!.images[0]!, width: 2000, height: 3000 }] }, mainOnModel: true };
    const flat: FamilyInput = { product: b!, mainOnModel: false };
    expect([big, flat].sort(referenceOrder)[0]).toBe(flat);
    const unknown: FamilyInput = { product: b! };
    expect([big, unknown].sort(referenceOrder)[0]).toBe(unknown);
  });
});

// --- silhouettes ----------------------------------------------------------------------------------

describe('silhouette check', () => {
  it('finds the subject on a plain backdrop and normalises scale and position', () => {
    const a = silhouetteOf(photo(TOP));
    const b = silhouetteOf(photo(TOP, { scale: 0.7, dx: 15, fg: [200, 60, 50] }));
    expect(a.width).toBe(SIL_W);
    expect(a.height).toBe(SIL_H);
    expect(silhouetteIou(a, b)).toBeGreaterThan(0.9);
    expect(silhouetteIou(a, silhouetteOf(photo(TROUSERS)))).toBeLessThan(0.6);
  });

  it('refuses a busy backdrop and a subject cut off at the top', () => {
    const busy = photoSilhouette(photo(TOP, { busy: true }));
    expect(busy.silhouette).toBeNull();
    expect(busy.reason).toMatch(/not a plain backdrop/);
    const cut = photoSilhouette(photo((u, v) => u > 0.4 && u < 0.6 && v < 0.7, { scale: 1.3 }));
    expect(cut.silhouette).toBeNull();
    expect(cut.reason).toMatch(/runs off the top or a side/);
  });

  it('accepts a garment mask made elsewhere', () => {
    const w = 40, h = 80;
    const data = new Uint8Array(w * h);
    for (let y = 10; y < 70; y++) for (let x = 10; x < 30; x++) data[y * w + x] = 1;
    const s = maskSilhouette({ width: w, height: h, data })!;
    expect(s.height).toBe(SIL_H);
    expect(silhouetteIou(s, s)).toBe(1);
  });

  it('splits a false merge: same copy, a top and trousers in the main photos', () => {
    const [a, b, c] = earthweave;
    const fams = buildFamilies([
      { product: a!, silhouette: silhouetteOf(photo(TOP)) },
      { product: b!, silhouette: silhouetteOf(photo(TOP, { scale: 0.8, fg: [30, 30, 30] })) },
      { product: c!, silhouette: silhouetteOf(photo(TROUSERS)) },
    ]);
    expect(fams).toHaveLength(2);
    expect(fams.map((f) => f.id).sort()).toEqual(['tops/earthweave-knit-top', 'tops/earthweave-knit-top~2']);
    const main = fams.find((f) => f.members.length === 2)!;
    expect(main.splitFromText).toBe(true);
    expect(main.members.find((m) => !m.reference)!.silhouetteIou).toBeGreaterThan(0.9);
    expect(fams.find((f) => f.members.length === 1)!.members[0]!.handle).toBe(c!.handle);
    expect(familyCounts(fams).silhouetteSplits).toBe(1);
  });

  it('keeps members without a silhouette with the largest checked cluster', () => {
    const [a, b, c] = earthweave;
    const parts = splitBySilhouette([
      { product: a!, silhouette: silhouetteOf(photo(TOP)) },
      { product: b!, silhouette: null },
      { product: c!, silhouette: silhouetteOf(photo(TOP, { scale: 0.9 })) },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(3);
  });
});

/**
 * Shop products in the Phase 0 exporter, from the committed validation set (data/bohohippychic/
 * products.json and images.json). The image bytes live in raw/, which is gitignored, so these tests
 * use stand-in bytes and an images.json copy whose sha256 values are those of the stand-ins.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exportJob, inputHash, sha256, type ExportOptions, type Phase0Manifest, type PhotoInput } from './exportJob';
import { shopPhotoChoice, shopPhotos, shopProduct, type ShopImage, type ShopImageReader } from './product';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic');
const productsJson = JSON.parse(readFileSync(join(dataDir, 'products.json'), 'utf8')) as { products: { handle: string; payload: { name: string; brand: string } }[] };
const imagesJson = JSON.parse(readFileSync(join(dataDir, 'images.json'), 'utf8')) as { products: Record<string, ShopImage[]> };
const HANDLES = productsJson.products.map((p) => p.handle);

/** Stand-in bytes for an image (a JPEG magic number and the position), and an images.json whose sha256 matches them. */
const fakeBytes = (handle: string, pos: number): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, pos, ...new TextEncoder().encode(handle)]);
const fakeReader: ShopImageReader = (handle, img) => ({ bytes: fakeBytes(handle, img.position), ext: 'jpg', file: `raw/${handle}/${String(img.position).padStart(2, '0')}.jpg` });
const patchedImages = {
  ...imagesJson,
  products: Object.fromEntries(Object.entries(imagesJson.products).map(([h, imgs]) => [h, imgs.map((i) => ({ ...i, sha256: sha256(fakeBytes(h, i.position)) }))])),
};

const SMALL = { frames: 8, width: 64, height: 112, motionFrames: 5 } as const;

function shopJob(handle: string, extra: Partial<ExportOptions> = {}): { manifest: Phase0Manifest; files: Map<string, Uint8Array | string> } {
  const product = shopProduct('bohohippychic', productsJson, handle);
  const choice = shopPhotoChoice(patchedImages, handle);
  const photos: PhotoInput[] = shopPhotos('bohohippychic', handle, choice, fakeReader, sha256);
  const files = new Map<string, Uint8Array | string>();
  const { manifest } = exportJob({ productId: handle, product, photos, onModel: { kind: choice.sourceKind }, ...SMALL, ...extra }, (p, d) => files.set(p, d));
  return { manifest, files };
}

describe('shop products: payload, chart and base size from products.json', () => {
  it('resolves every committed product with its base size; refuses unknown handles and names runners-up', () => {
    for (const h of HANDLES) {
      const p = shopProduct('bohohippychic', productsJson, h);
      expect(p.id).toBe(h);
      expect(p.source).toMatchObject({ kind: 'shop', shop: 'bohohippychic', handle: h });
      expect(p.baseSize).toBe(h === 'woodstock-wanderer-knit-cardi' ? 'S-M' : '12');
    }
    expect(shopProduct('bohohippychic', productsJson, 'azure-palm-baby-doll-dress', '14').baseSize).toBe('14');
    expect(() => shopProduct('bohohippychic', productsJson, 'no-such-dress')).toThrow(/not one of the bohohippychic validation products/);
    expect(() => shopProduct('bohohippychic', productsJson, 'seraphina-embroidered-mirror-work-maxi-dress')).toThrow(/runner-up/);
  });
});

describe('shop products: photo list from images.json', () => {
  it('picks a front and a back per product, on-model photos here (none of the five has a no-model photo)', () => {
    const azure = shopPhotoChoice(imagesJson, 'azure-palm-baby-doll-dress');
    expect([azure.front.position, azure.back?.position, azure.sourceKind]).toEqual([1, 4, 'on_model']);
    const palazzo = shopPhotoChoice(imagesJson, 'rosewater-palazzo-pants');
    expect(palazzo.front.position).toBe(2); // image 1 has the garment partly hidden
    for (const h of HANDLES) expect(shopPhotoChoice(imagesJson, h).back).not.toBeNull();
    expect(shopPhotoChoice(imagesJson, 'azure-palm-baby-doll-dress', { front: 3 }).front.position).toBe(3);
    expect(() => shopPhotoChoice(imagesJson, 'azure-palm-baby-doll-dress', { back: 9 })).toThrow(/no image at position 9/);
  });

  it('prefers a no-model photo (D13 kind) and invents nothing silently when a role is missing', () => {
    const imgs: ShopImage[] = [
      { position: 1, role: 'front', onModel: true, background: 'busy', garmentFullyVisible: true, file: null, sha256: null },
      { position: 2, role: 'front', onModel: false, background: 'plain', garmentFullyVisible: true, file: null, sha256: null },
    ];
    const c = shopPhotoChoice({ products: { x: imgs } }, 'x');
    expect([c.front.position, c.back, c.sourceKind]).toEqual([2, null, 'flat_lay']);
    expect(c.why.join(' ')).toMatch(/INVENT/);
  });

  it('tells you to fetch when raw/ lacks an image, and refuses an image that changed since images.json', () => {
    const choice = shopPhotoChoice(imagesJson, 'azure-palm-baby-doll-dress');
    expect(() => shopPhotos('bohohippychic', 'azure-palm-baby-doll-dress', choice, () => undefined, sha256)).toThrow(/shop:bohohippychic -- --fetch-images`/);
    expect(() => shopPhotos('bohohippychic', 'azure-palm-baby-doll-dress', choice, fakeReader, sha256)).toThrow(/differs from the committed sha256 in images.json/);
    // The fix it names is a reviewed classification, never a plain re-fetch (which used to rewrite the hash).
    expect(() => shopPhotos('bohohippychic', 'azure-palm-baby-doll-dress', choice, fakeReader, sha256)).toThrow(/Do not re-fetch.*SHOP_IMAGE_CLASSIFICATION.*--accept-image-changes/);
    // An image without a committed hash is not pinned: refused, not skipped.
    const unpinned = { ...choice, front: { ...choice.front, sha256: null } };
    expect(() => shopPhotos('bohohippychic', 'azure-palm-baby-doll-dress', unpinned, fakeReader, sha256)).toThrow(/no sha256 in data\/bohohippychic\/images.json/);
    const ok = shopPhotos('bohohippychic', 'azure-palm-baby-doll-dress', shopPhotoChoice(patchedImages, 'azure-palm-baby-doll-dress'), fakeReader, sha256);
    expect(ok.map((p) => [p.role, p.ext])).toEqual([['front', 'jpg'], ['back', 'jpg']]);
    expect(ok[0]!.source).toMatch(/raw\/azure-palm-baby-doll-dress\/01\.jpg/);
  });
});

describe('shop products: exported job', () => {
  it('writes a stage 1b job with the shop payload, base size, chart, source and a proxy control', () => {
    const { manifest: m, files } = shopJob('azure-palm-baby-doll-dress');
    expect(m.product_id).toBe('azure-palm-baby-doll-dress');
    expect(m.job_id).toMatch(/^azure-palm-baby-doll-dress-[0-9a-f]{12}$/);
    expect(m.base_size).toBe('12');
    expect(m.category).toBe('dress');
    expect(m.product_source).toMatchObject({ kind: 'shop', shop: 'bohohippychic', handle: 'azure-palm-baby-doll-dress' });
    expect(m.chart.rows.map((r) => r.size)).toEqual(['8', '10', '12', '14', '16']);
    expect(m.chart.rows.find((r) => r.size === '12')!.rings.chest).toBe(102); // AU 12 bust 95 + the printed 7 cm ease
    expect(m.stage1b?.source_kind).toBe('on_model');
    expect(m.stage1b?.invented_back).toBe(false);
    expect(m.stage1b?.views.map((v) => v.bare_mask)).toEqual(['dress/bare_mask_front.png', 'dress/bare_mask_back.png']);
    expect(files.has('dress/bare_mask_front.png')).toBe(true);
    expect(files.get('dress/source_front.jpg')).toEqual(fakeBytes('azure-palm-baby-doll-dress', 1));
    expect(m.control.mode).toBe('proxy');
    expect(m.control.proxy?.kind).toBe('dress');
    expect(m.synthetic).not.toBeNull(); // dresses have the synthetic garment (colour from the name: no primaryColorHex in the draft)
    expect(inputHash(m.hash_inputs)).toBe(m.input_hash);
  });

  it('exports trousers, a skirt and a cardigan without the synthetic garment (it exists for dresses and tops only)', () => {
    for (const h of ['rosewater-palazzo-pants', 'crimson-wildflower-maxi-skirt', 'woodstock-wanderer-knit-cardi']) {
      const { manifest: m } = shopJob(h);
      expect(m.synthetic, h).toBeNull();
      expect(m.control.proxy?.kind, h).toBe({ 'rosewater-palazzo-pants': 'trousers', 'crimson-wildflower-maxi-skirt': 'skirt', 'woodstock-wanderer-knit-cardi': 'outerwear' }[h]);
    }
    expect(() => shopJob('rosewater-palazzo-pants', { synthetic: true })).toThrow(/dresses and tops/);
  });

  it('never puts the product title, the brand or a distinctive word of the title into the prompts', () => {
    for (const { handle, payload } of productsJson.products) {
      const { manifest: m } = shopJob(handle);
      const text = `${m.prompt.turntable} ${m.prompt.motion} ${m.prompt.negative}`.toLowerCase();
      expect(text, handle).not.toContain(payload.name.toLowerCase());
      expect(text, handle).not.toContain(payload.brand.toLowerCase());
      for (const word of ['azure', 'palm', 'rosewater', 'palazzo', 'crimson', 'wildflower', 'woodstock', 'wanderer', 'boho', 'hippy', 'chic', 'baby doll']) {
        expect(text, `${handle}: ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
      expect(m.prompt.negative).toMatch(/\btext\b.*\bletters\b.*\bwords\b.*\bwatermark\b.*\blogo\b/);
    }
  });
});

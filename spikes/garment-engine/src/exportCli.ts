/**
 * Writes Phase 0 job directories for the Modal apps in spikes/garment-engine/modal/.
 *
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product aalter-studio-2 \
 *     --front ~/photos/front.jpg --back ~/photos/back.jpg [--detail ~/photos/collar.jpg ...]
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product <id> --on-model \
 *     --front ~/shop/front.jpg [--back ~/shop/back.jpg]
 *
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --shop bohohippychic --product azure-palm-baby-doll-dress
 *
 * --on-model (garment worn by a person) or --flat-lay: the front/back photos are shop photos, not
 * stills on our mannequin. Stage 1b (modal/stage1_dress.py) must dress our mannequin from them before
 * stage 2 runs; without --back it invents the back and every record says so (validation only, D13).
 *
 * --shop <shop> --product <handle>: a product of a validated shop (data/<shop>/products.json and
 * images.json, committed): payload, chart and base size from products.json, the front and back photo
 * chosen from images.json (a no-model photo first; --front-image N / --back-image N pick positions),
 * the image bytes from data/<shop>/raw/ (gitignored; `shop:<shop> -- --fetch-images` downloads them and
 * checks them against the committed sha256, which this exporter checks again). The
 * job is a stage 1b job: --on-model or --flat-lay follow from the chosen front photo.
 *
 * --shop <shop> --product <handle> --synthetic-photos: the same product (payload, chart, features, proxy,
 * prompt) with the spike's synthetic garment as the pinned stills instead of the shop photos: a dry run
 * of every non-GPU part for the product's garment kind without raw/ and without stage 1b. Written to
 * out/phase0-synthetic/<handle>/ unless --out is given, so it never mixes with a real job's GPU outputs.
 *
 * --control proxy (default) | bare: the control depth video shows our mannequin wearing a coarse proxy
 * garment from the category and chart (src/proxy.ts), or the bare mannequin. Recorded in the manifest
 * and input_hash.
 *
 * Output: spikes/garment-engine/out/phase0/<productId>/ (gitignored) unless --out is given.
 * Options: --frames 160 --width 480 --height 832 --motion-frames 81 --fps 16 --base-size M (spike) or
 *          the shop's base size --seed-video 43 --seed-recon 7 --no-synthetic --on-model --flat-lay
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_SEEDS, exportJob, sha256, type OnModelOptions, type PhotoInput } from './exportJob';
import { SHOPS, SPIKE_PRODUCT_IDS, resolveSpikeProduct, shopPhotoChoice, shopPhotos, shopProduct, type ResolvedProduct, type ShopId } from './product';
import { CONTROL_MODES, type ControlMode } from './proxy';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    product: { type: 'string', default: 'all' },
    shop: { type: 'string' },
    control: { type: 'string', default: 'proxy' },
    'front-image': { type: 'string' },
    'back-image': { type: 'string' },
    out: { type: 'string' },
    front: { type: 'string' },
    back: { type: 'string' },
    detail: { type: 'string', multiple: true },
    'synthetic-photos': { type: 'boolean', default: false },
    'no-synthetic': { type: 'boolean', default: false },
    'on-model': { type: 'boolean', default: false },
    'flat-lay': { type: 'boolean', default: false },
    frames: { type: 'string', default: '160' },
    width: { type: 'string', default: '480' },
    height: { type: 'string', default: '832' },
    'motion-frames': { type: 'string', default: '81' },
    fps: { type: 'string', default: '16' },
    'base-size': { type: 'string' },
    'seed-video': { type: 'string', default: String(DEFAULT_SEEDS.video) },
    'seed-recon': { type: 'string', default: String(DEFAULT_SEEDS.recon) },
  },
});

const int = (name: string, v: string | undefined): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got ${v}`);
  return n;
};

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const control = values.control as ControlMode;
if (!(CONTROL_MODES as readonly string[]).includes(control)) throw new Error(`--control must be ${CONTROL_MODES.join(' or ')}, got ${values.control}`);
if (values['on-model'] && values['flat-lay']) throw new Error('--on-model and --flat-lay exclude each other: say what the shop photos show');
let onModel: OnModelOptions | undefined = values['on-model'] ? { kind: 'on_model' } : values['flat-lay'] ? { kind: 'flat_lay' } : undefined;

const photo = (role: PhotoInput['role'], file: string): PhotoInput => ({ role, bytes: readFileSync(file), ext: extname(file).slice(1), source: basename(file) });
const photos: PhotoInput[] = [
  ...(values.front ? [photo('front', values.front)] : []),
  ...(values.back ? [photo('back', values.back)] : []),
  ...(values.detail ?? []).map((f) => photo('detail', f)),
];

const position = (name: string, v: string | undefined): number | undefined => (v === undefined ? undefined : int(name, v));

let products: ResolvedProduct[];
if (values.shop !== undefined) {
  const shop = values.shop as ShopId;
  if (!(SHOPS as readonly string[]).includes(shop)) throw new Error(`unknown shop ${values.shop}; known: ${SHOPS.join(', ')}`);
  if (values.product === 'all') throw new Error(`--shop ${shop} needs --product <handle>`);
  if (values.front || values.back) throw new Error('--shop takes its photos from data/<shop>/ (choose with --front-image/--back-image); --front and --back do not apply');
  const dataDir = join(pkgDir, 'data', shop);
  const rawDir = join(dataDir, 'raw');
  const product = shopProduct(shop, JSON.parse(readFileSync(join(dataDir, 'products.json'), 'utf8')), values.product, values['base-size']);
  if (values['synthetic-photos']) {
    if (onModel || values['front-image'] || values['back-image']) throw new Error('--synthetic-photos replaces the shop photos: --on-model, --flat-lay, --front-image and --back-image do not apply');
    console.log(`[export:phase0] ${product.id}: synthetic stills instead of the shop photos (a dry run without stage 1b; never a real job)`);
    products = [product];
  } else {
    const choice = shopPhotoChoice(JSON.parse(readFileSync(join(dataDir, 'images.json'), 'utf8')), product.id, { front: position('front-image', values['front-image']), back: position('back-image', values['back-image']) });
    if (!existsSync(join(rawDir, product.id))) {
      throw new Error(`data/${shop}/raw/${product.id}/ is missing (shop images are gitignored): run \`pnpm --filter @curtain/garment-spike shop:${shop} -- --fetch-images\` first`);
    }
    const shopPics = shopPhotos(shop, product.id, choice, (handle, img) => {
      const dir = join(rawDir, handle);
      const name = existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith(`${String(img.position).padStart(2, '0')}.`)) : undefined;
      return name ? { bytes: readFileSync(join(dir, name)), ext: extname(name).slice(1), file: `raw/${handle}/${name}` } : undefined;
    }, sha256);
    const kind = choice.sourceKind;
    if (onModel && onModel.kind !== kind) throw new Error(`--${onModel.kind === 'on_model' ? 'on-model' : 'flat-lay'} contradicts the chosen front photo (${kind}, from images.json)`);
    onModel = { kind };
    photos.push(...shopPics);
    for (const w of choice.why) console.log(`[export:phase0] ${product.id}: ${w}`);
    products = [product];
  }
} else {
  const ids = values.product === 'all' ? [...SPIKE_PRODUCT_IDS] : [values.product];
  if (ids.length > 1 && (values.front || values.back || values.detail)) throw new Error('photos belong to one product: pass --product <id> with --front/--back/--detail');
  products = ids.map((id) => resolveSpikeProduct(id, values['base-size']));
}

const root = values.out ? resolve(values.out) : join(pkgDir, 'out', values.shop !== undefined && values['synthetic-photos'] ? 'phase0-synthetic' : 'phase0');
for (const product of products) {
  const productId = product.id;
  const t0 = Date.now();
  const dir = join(root, productId);
  // Generated inputs only; stage outputs (stage1b/, stage2/, stage4/) that run_phase0.py downloads are kept.
  for (const sub of ['control', 'motion', 'photos', 'synthetic', 'dress']) rmSync(join(dir, sub), { recursive: true, force: true });
  const result = exportJob(
    {
      productId,
      product,
      control,
      frames: int('frames', values.frames),
      width: int('width', values.width),
      height: int('height', values.height),
      motionFrames: int('motion-frames', values['motion-frames']),
      fps: int('fps', values.fps),
      seeds: { video: int('seed-video', values['seed-video']), recon: int('seed-recon', values['seed-recon']) },
      photos,
      syntheticPhotos: values['synthetic-photos'],
      onModel,
      // Default: the synthetic dressed turntable where the spike has a synthetic garment (dresses and tops).
      ...(values['no-synthetic'] ? { synthetic: false } : {}),
    },
    (path, data) => {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
  );
  const m = result.manifest;
  console.log(
    `[export:phase0] ${productId}: job ${m.job_id}, ${m.camera.frames} turntable frames + ${m.clips.find((c) => c.kind === 'motion')!.frame_indices.length} motion frames at ${m.camera.width}×${m.camera.height}, ` +
      `control ${m.control.mode}${m.control.proxy ? ` (${String(m.control.proxy.kind)} proxy)` : ''}, ` +
      `photos ${m.photos.map((p) => `${p.role}${p.synthetic ? ' (synthetic)' : ''}${p.produced_by ? ` (stage 1b${p.invented ? ', INVENTED' : ''})` : ''}`).join(', ')}, ` +
      `${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MB, ${Date.now() - t0} ms → ${dir}`,
  );
  console.log(`[export:phase0] ${productId}: stage 2 prompt (neutral, no title or brand): "${m.prompt.description}"; colour ${m.prompt.colour.name ?? 'none'} (${m.prompt.colour.source})`);
  if (m.stage1b) {
    console.log(
      `[export:phase0] ${productId}: front/back are ${m.stage1b.source_kind} shop photos; run stage 1b before stage 2 ` +
        `(modal run spikes/garment-engine/modal/stage1_dress.py --job-dir ${dir}, or run_phase0.py --dress)` +
        (m.stage1b.invented_back ? '. No back photo: the back still will be INVENTED (validation only, D13)' : ''),
    );
  }
}

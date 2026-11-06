/**
 * Writes Phase 0 job directories for the Modal apps in spikes/garment-engine/modal/.
 *
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product aalter-studio-2 \
 *     --front ~/photos/front.jpg --back ~/photos/back.jpg [--detail ~/photos/collar.jpg ...]
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos
 *   pnpm --filter @curtain/garment-spike export:phase0 -- --product <id> --on-model \
 *     --front ~/shop/front.jpg [--back ~/shop/back.jpg]
 *
 * --on-model (garment worn by a person) or --flat-lay: the front/back photos are shop photos, not
 * stills on our mannequin. Stage 1b (modal/stage1_dress.py) must dress our mannequin from them before
 * stage 2 runs; without --back it invents the back and every record says so (validation only, D13).
 *
 * Output: spikes/garment-engine/out/phase0/<productId>/ (gitignored) unless --out is given.
 * Options: --frames 160 --width 480 --height 832 --motion-frames 81 --fps 16 --base-size M
 *          --seed-video 43 --seed-recon 7 --no-synthetic --on-model --flat-lay
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_SEEDS, exportJob, type PhotoInput } from './exportJob';
import { SPIKE_PRODUCT_IDS } from './product';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    product: { type: 'string', default: 'all' },
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
    'base-size': { type: 'string', default: 'M' },
    'seed-video': { type: 'string', default: String(DEFAULT_SEEDS.video) },
    'seed-recon': { type: 'string', default: String(DEFAULT_SEEDS.recon) },
  },
});

const int = (name: string, v: string | undefined): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got ${v}`);
  return n;
};

const ids = values.product === 'all' ? [...SPIKE_PRODUCT_IDS] : [values.product as (typeof SPIKE_PRODUCT_IDS)[number]];
for (const id of ids) if (!(SPIKE_PRODUCT_IDS as readonly string[]).includes(id)) throw new Error(`unknown product ${id}; the spike knows ${SPIKE_PRODUCT_IDS.join(', ')}`);
if (ids.length > 1 && (values.front || values.back || values.detail)) throw new Error('photos belong to one product: pass --product <id> with --front/--back/--detail');

if (values['on-model'] && values['flat-lay']) throw new Error('--on-model and --flat-lay exclude each other: say what the shop photos show');
const onModel = values['on-model'] ? { kind: 'on_model' as const } : values['flat-lay'] ? { kind: 'flat_lay' as const } : undefined;

const photo = (role: PhotoInput['role'], file: string): PhotoInput => ({ role, bytes: readFileSync(file), ext: extname(file).slice(1), source: basename(file) });
const photos: PhotoInput[] = [
  ...(values.front ? [photo('front', values.front)] : []),
  ...(values.back ? [photo('back', values.back)] : []),
  ...(values.detail ?? []).map((f) => photo('detail', f)),
];

const root = values.out ? resolve(values.out) : join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'phase0');
for (const productId of ids) {
  const t0 = Date.now();
  const dir = join(root, productId);
  // Generated inputs only; stage outputs (stage1b/, stage2/, stage4/) that run_phase0.py downloads are kept.
  for (const sub of ['control', 'motion', 'photos', 'synthetic', 'dress']) rmSync(join(dir, sub), { recursive: true, force: true });
  const result = exportJob(
    {
      productId,
      baseSize: values['base-size'],
      frames: int('frames', values.frames),
      width: int('width', values.width),
      height: int('height', values.height),
      motionFrames: int('motion-frames', values['motion-frames']),
      fps: int('fps', values.fps),
      seeds: { video: int('seed-video', values['seed-video']), recon: int('seed-recon', values['seed-recon']) },
      photos,
      syntheticPhotos: values['synthetic-photos'],
      onModel,
      synthetic: !values['no-synthetic'],
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
      `photos ${m.photos.map((p) => `${p.role}${p.synthetic ? ' (synthetic)' : ''}${p.produced_by ? ` (stage 1b${p.invented ? ', INVENTED' : ''})` : ''}`).join(', ')}, ` +
      `${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MB, ${Date.now() - t0} ms → ${dir}`,
  );
  if (m.stage1b) {
    console.log(
      `[export:phase0] ${productId}: front/back are ${m.stage1b.source_kind} shop photos; run stage 1b before stage 2 ` +
        `(modal run spikes/garment-engine/modal/stage1_dress.py --job-dir ${dir}, or run_phase0.py --dress)` +
        (m.stage1b.invented_back ? '. No back photo: the back still will be INVENTED (validation only, D13)' : ''),
    );
  }
}

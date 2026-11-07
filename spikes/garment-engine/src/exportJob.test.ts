import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath } from '@curtain/mannequin';
import { beforeAll, describe, expect, it } from 'vitest';
import { mockGarment } from '@curtain/schema';
import { EXPORT_VERSION, PINNED_MODELS, canonicalJson, controlFrame, depthRange, exportJob, inputHash, sha256, turntableClips, type ExportOptions, type Phase0Manifest } from './exportJob';
import { decodePng } from './exportPng';
import { NEGATIVE_BASE, SPIKE_PRODUCT_IDS, garmentSpec, promptColour } from './product';
import { render } from './raster';
import { MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

/** Small job: the same code path as the CLI at a size a unit test can afford. Also the source of the pytest fixture. */
const SMALL_JOB: ExportOptions = { productId: 'monochrome-03', frames: 8, width: 64, height: 112, motionFrames: 5, syntheticPhotos: true };

function run(options: ExportOptions): { manifest: Phase0Manifest; files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  const { manifest } = exportJob(options, (p, d) => files.set(p, d));
  return { manifest, files };
}

const bytesOf = (d: Uint8Array | string | undefined): Uint8Array => {
  if (d === undefined) throw new Error('missing file');
  return typeof d === 'string' ? new TextEncoder().encode(d) : d;
};

let job: ReturnType<typeof run>;
beforeAll(() => {
  job = run(SMALL_JOB);
});

describe('turntable clips', () => {
  it('splits a turn into two 4k+1 half turns pinned front→back and back→front', () => {
    const [a, b] = turntableClips(160);
    expect(a!.frame_indices).toHaveLength(81);
    expect(a!.frame_indices[0]).toBe(0);
    expect(a!.frame_indices[80]).toBe(80);
    expect([a!.first_photo, a!.last_photo]).toEqual(['front', 'back']);
    expect(b!.frame_indices[0]).toBe(80);
    expect(b!.frame_indices[79]).toBe(159);
    expect(b!.frame_indices[80]).toBe(0);
    expect([b!.first_photo, b!.last_photo]).toEqual(['back', 'front']);
    expect(() => turntableClips(100)).toThrow(/multiple of 8/);
  });
});

describe('control depth', () => {
  it('stays inside the physical and the declared range, and matches the silhouette', () => {
    const mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const body = buildMannequinMesh(mannequin);
    const path = turntablePath(mannequin, 'turntable_mid', { frames: 8 });
    const range = depthRange(body.positions, path.frames);
    expect(range.nearCm).toBeGreaterThan(path.radiusCm - 80);
    expect(range.farCm).toBeLessThan(path.radiusCm + 80);
    for (const f of [path.frames[0]!, path.frames[2]!, path.frames[4]!]) {
      const r = render([{ positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID }], f, 96, 160);
      const c = controlFrame(r, range.nearCm, range.farCm);
      let fg = 0, nearest = Infinity, nearestVis = 0, farthest = 0, farthestVis = 0;
      for (let k = 0; k < c.depthMm.length; k++) {
        expect(c.mask[k] === 255).toBe(c.depthMm[k]! > 0);
        expect(c.depthVis[k]! > 0).toBe(c.depthMm[k]! > 0);
        if (!c.mask[k]) continue;
        fg++;
        expect(c.depthMm[k]!).toBeGreaterThanOrEqual(range.nearCm * 10);
        expect(c.depthMm[k]!).toBeLessThanOrEqual(range.farCm * 10);
        if (c.depthMm[k]! < nearest) [nearest, nearestVis] = [c.depthMm[k]!, c.depthVis[k]!];
        if (c.depthMm[k]! > farthest) [farthest, farthestVis] = [c.depthMm[k]!, c.depthVis[k]!];
      }
      expect(fg).toBeGreaterThan(500);
      expect(nearestVis).toBeGreaterThan(farthestVis); // near is bright
    }
  });

  it('writes 16-bit depth in mm that decodes to the rendered depth', () => {
    const png = decodePng(bytesOf(job.files.get('control/depth_mm/0000.png')));
    expect(png.bitDepth).toBe(16);
    expect([png.width, png.height]).toEqual([64, 112]);
    const fg = [...png.data].filter((v) => v > 0);
    expect(fg.length).toBeGreaterThan(100);
    expect(Math.min(...fg)).toBeGreaterThanOrEqual(job.manifest.control.near_cm * 10);
    expect(Math.max(...fg)).toBeLessThanOrEqual(job.manifest.control.far_cm * 10);
  });
});

describe('job manifest', () => {
  it('lists photos by role, base size, chart, fabric, mannequin, seeds and pinned models', () => {
    const m = job.manifest;
    expect(m.format).toBe('curtain.phase0.job');
    expect(m.product_id).toBe('monochrome-03');
    expect(m.base_size).toBe('M');
    expect(m.photos.map((p) => [p.role, p.path, p.synthetic])).toEqual([
      ['front', 'photos/front.png', true],
      ['back', 'photos/back.png', true],
    ]);
    for (const p of m.photos) expect(p.sha256).toBe(sha256(bytesOf(job.files.get(p.path))));
    expect(m.chart.rows.map((r) => r.size)).toContain('M');
    expect(m.fabric.format).toBe('curtain.garment.material');
    expect(m.mannequin.glb_sha256).toBe(sha256(bytesOf(job.files.get('mannequin.glb'))));
    expect(m.seeds).toEqual({ video: 43, recon: 7 });
    expect(m.models).toEqual(PINNED_MODELS);
    expect(m.clips.map((c) => [c.id, c.frame_indices.length])).toEqual([['turntable_a', 5], ['turntable_b', 5], ['motion', 5]]);
    expect(m.job_id).toBe(`monochrome-03-${m.input_hash.slice(0, 12)}`);
    for (const dir of ['control/depth_mm', 'control/depth_vis', 'control/mask', 'synthetic/rgb', 'synthetic/garment_mask']) {
      for (let i = 0; i < 8; i++) expect(job.files.has(`${dir}/${String(i).padStart(4, '0')}.png`)).toBe(true);
    }
    for (let i = 0; i < 5; i++) expect(job.files.has(`motion/depth_vis/${String(i).padStart(4, '0')}.png`)).toBe(true);
  });

  it('input_hash is the hash of hash_inputs as a reader of manifest.json sees them, in any key order', () => {
    const parsed = JSON.parse(new TextDecoder().decode(bytesOf(job.files.get('manifest.json')))) as Phase0Manifest;
    expect(inputHash(parsed.hash_inputs)).toBe(parsed.input_hash);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":3}],"b":1}');
    const reversed = Object.fromEntries(Object.entries(parsed.hash_inputs).reverse());
    expect(inputHash(reversed)).toBe(parsed.input_hash);
  });

  it('is stable across runs (same hash, byte-identical files) and changes with the inputs it covers', () => {
    const again = run(SMALL_JOB);
    expect(again.manifest.input_hash).toBe(job.manifest.input_hash);
    expect([...again.files.keys()]).toEqual([...job.files.keys()]);
    for (const [p, d] of job.files) expect(sha256(bytesOf(again.files.get(p)))).toBe(sha256(bytesOf(d)));
    const seeds = run({ ...SMALL_JOB, synthetic: false, seeds: { video: 44, recon: 7 } }).manifest.input_hash;
    const noSynthetic = run({ ...SMALL_JOB, synthetic: false }).manifest.input_hash;
    expect(seeds).not.toBe(noSynthetic);
    expect(noSynthetic).not.toBe(job.manifest.input_hash);
  });

  it('requires merchant front and back photos unless asked for synthetic stills', () => {
    const png = new Uint8Array([1, 2, 3]);
    const base = { ...SMALL_JOB, syntheticPhotos: false, synthetic: false };
    expect(() => run({ ...base, photos: [{ role: 'front', bytes: png, ext: 'png', source: 'f.png' }] })).toThrow(/back photo is required/);
    expect(() => run({ ...base, photos: [{ role: 'front', bytes: png, ext: 'gif', source: 'f.gif' }] })).toThrow(/png, jpg or webp/);
    const details = Array.from({ length: 5 }, (_, i) => ({ role: 'detail' as const, bytes: png, ext: 'jpg', source: `d${i}.jpg` }));
    const pair = [{ role: 'front' as const, bytes: png, ext: 'jpeg', source: 'f.jpeg' }, { role: 'back' as const, bytes: new Uint8Array([4]), ext: 'png', source: 'b.png' }];
    expect(() => run({ ...base, photos: [...pair, ...details] })).toThrow(/at most 4 detail/);
    const ok = run({ ...base, photos: [...pair, details[0]!] });
    expect(ok.manifest.photos.map((p) => [p.role, p.path, p.synthetic, p.source])).toEqual([
      ['front', 'photos/front.jpg', false, 'f.jpeg'],
      ['back', 'photos/back.png', false, 'b.png'],
      ['detail', 'photos/detail_0.jpg', false, 'd0.jpg'],
    ]);
    expect(ok.files.get('photos/front.jpg')).toBe(png);
    // A different photo is a different job; the file name is not part of the hash.
    const renamed = run({ ...base, photos: [{ ...pair[0]!, source: 'other.jpeg' }, pair[1]!, details[0]!] });
    expect(renamed.manifest.input_hash).toBe(ok.manifest.input_hash);
    const otherBack = run({ ...base, photos: [pair[0]!, { ...pair[1]!, bytes: new Uint8Array([5]) }, details[0]!] });
    expect(otherBack.manifest.input_hash).not.toBe(ok.manifest.input_hash);
  });

  it('matches the pytest fixture the Modal helpers are tested against', () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'modal', 'tests', 'fixtures', 'manifest.json');
    const f = JSON.parse(readFileSync(fixture, 'utf8')) as Phase0Manifest;
    expect(f.input_hash).toBe(job.manifest.input_hash);
    expect(f.models).toEqual(PINNED_MODELS);
    expect(inputHash(f.hash_inputs)).toBe(f.input_hash);
  });
});

describe('control mode (proxy | bare)', () => {
  it('defaults to the proxy, records it in the manifest and in input_hash, and writes the proxy files', () => {
    const m = job.manifest;
    expect(m.exporter).toBe(`@curtain/garment-spike ${EXPORT_VERSION}`);
    expect(m.control.mode).toBe('proxy');
    expect(m.control.proxy?.kind).toBe('top');
    expect(m.control.proxy?.glb_sha256).toBe(sha256(bytesOf(job.files.get('control/proxy.glb'))));
    expect(m.control.proxy_mask_dir).toBe('control/proxy_mask');
    expect(m.motion.proxy_mask_dir).toBe('motion/proxy_mask');
    expect(m.clips.map((c) => c.proxy_mask_dir)).toEqual(['control/proxy_mask', 'control/proxy_mask', 'motion/proxy_mask']);
    expect(m.hash_inputs.control).toEqual({ mode: 'proxy', proxy: expect.objectContaining({ kind: 'top', version: 'control-proxy-0.3.0' }) });
    // The proxy geometry is hashed, not only its spec: a mesh change without a PROXY_VERSION bump
    // still changes input_hash and the job id (cached stage 2 outputs are keyed by the job id).
    expect((m.hash_inputs.control as { proxy: { glb_sha256: string } }).proxy.glb_sha256).toBe(m.control.proxy?.glb_sha256);
    const otherGeometry = { ...m.hash_inputs, control: { mode: 'proxy', proxy: { ...(m.hash_inputs.control as { proxy: object }).proxy, glb_sha256: '0'.repeat(64) } } };
    expect(inputHash(otherGeometry)).not.toBe(m.input_hash);
    for (let i = 0; i < 8; i++) expect(job.files.has(`control/proxy_mask/${String(i).padStart(4, '0')}.png`)).toBe(true);
    for (let i = 0; i < 5; i++) expect(job.files.has(`motion/proxy_mask/${String(i).padStart(4, '0')}.png`)).toBe(true);
  });

  it('bare renders the bare mannequin: no proxy files, another hash, a smaller silhouette', () => {
    const bare = run({ ...SMALL_JOB, control: 'bare' });
    expect(bare.manifest.control.mode).toBe('bare');
    expect(bare.manifest.control.proxy).toBeNull();
    expect(bare.manifest.control.proxy_mask_dir).toBeNull();
    expect([...bare.files.keys()].some((k) => k.includes('proxy'))).toBe(false);
    expect(bare.manifest.hash_inputs.control).toEqual({ mode: 'bare', proxy: null });
    expect(bare.manifest.input_hash).not.toBe(job.manifest.input_hash);
    const count = (f: Uint8Array | string | undefined) => [...decodePng(bytesOf(f)).data].filter((v) => v > 0).length;
    expect(count(job.files.get('control/mask/0000.png'))).toBeGreaterThan(count(bare.files.get('control/mask/0000.png')));
    // Synthetic stills and frames do not depend on the control mode.
    expect(sha256(bytesOf(bare.files.get('photos/front.png')))).toBe(sha256(bytesOf(job.files.get('photos/front.png'))));
    expect(() => run({ ...SMALL_JOB, control: 'depth' as never })).toThrow(/unknown control mode/);
  });
});

describe('garment segmentation inputs and the proxy length (export 0.3.0)', () => {
  const px = (f: Uint8Array | string | undefined): Uint8Array => Uint8Array.from(decodePng(bytesOf(f)).data);

  it('writes the bare mannequin silhouette per frame in proxy mode: what the bare control renders, and it covers the visible mannequin', () => {
    const m = job.manifest;
    expect(m.control.bare_mask_dir).toBe('control/bare_mask');
    expect(m.motion.bare_mask_dir).toBe('motion/bare_mask');
    const bare = run({ ...SMALL_JOB, control: 'bare' });
    expect(bare.manifest.control.bare_mask_dir).toBeNull();
    for (let i = 0; i < 8; i++) {
      const name = String(i).padStart(4, '0');
      const b = px(job.files.get(`control/bare_mask/${name}.png`));
      // Identical to the bare control's silhouette at the same camera.
      expect(sha256(b)).toBe(sha256(px(bare.files.get(`control/mask/${name}.png`))));
      const c = px(job.files.get(`control/mask/${name}.png`));
      const p = px(job.files.get(`control/proxy_mask/${name}.png`));
      for (let k = 0; k < b.length; k++) if (c[k] && !p[k]) expect(b[k]).toBe(255);
    }
    for (let i = 0; i < 5; i++) expect(job.files.has(`motion/bare_mask/${String(i).padStart(4, '0')}.png`)).toBe(true);
  });

  it('pins no still in the motion clip: the stills are drawn at the turntable camera, not the motion camera', () => {
    const motion = job.manifest.clips.find((c) => c.id === 'motion')!;
    expect([motion.first_photo, motion.last_photo]).toEqual([null, null]);
  });

  it('with synthetic stills, the proxy hem is the synthetic garment hem, also for a product without shoulder_to_hem', () => {
    const payload = mockGarment('aalter-studio-2');
    const mq = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const hps = mq.landmarks.hps[1];
    // With a chart length the synthetic stills still set the hem: the synthetic garment drops its 112 cm
    // vertically (run 11a: hem 26.6 cm above the floor), while a printed length is flat-lay (proxy 0.2.0).
    const own = run({ ...SMALL_JOB, productId: 'aalter-studio-2' }).manifest.control.proxy!;
    expect(own.length_source).toMatch(/synthetic stills/);
    expect(own.length_definition).toBe('drop');
    expect(hps - (own.hem_y_cm as number)).toBeCloseTo(112, 1);
    const { lengthCm: _drop, ...rest } = payload;
    const noLength = { ...rest } as typeof payload;
    const product = { id: payload.id, payload: noLength, baseSize: 'M', source: { kind: 'spike' as const } };
    const synth = garmentSpec(noLength, 'M').shoulderToHemCm;
    const withStills = run({ ...SMALL_JOB, productId: payload.id, product }).manifest.control.proxy!;
    expect(withStills.length_source).toMatch(/synthetic stills/);
    expect(hps - (withStills.hem_y_cm as number)).toBeCloseTo(synth, 1);
    // Merchant photos: the product's own rule (no length: pattern words or the knee), not the synthetic default.
    const photo = { role: 'front' as const, ext: 'png', bytes: new Uint8Array([1, 2, 3]), source: 'f.png' };
    const real = run({ productId: payload.id, product, frames: 8, width: 64, height: 112, motionFrames: 5, photos: [photo, { ...photo, role: 'back' as const, source: 'b.png' }] }).manifest.control.proxy!;
    expect(real.length_source).not.toMatch(/synthetic stills/);
  });
});

describe('stage 2 prompt', () => {
  it.each(SPIKE_PRODUCT_IDS)('%s: neutral description, no title or brand, negative against text and the wrong garment, hashed', (id) => {
    const p = mockGarment(id);
    const { manifest: m } = run({ ...SMALL_JOB, productId: id });
    const all = `${m.prompt.turntable} ${m.prompt.motion}`.toLowerCase();
    expect(all).not.toContain(p.name.toLowerCase());
    expect(all).not.toContain(p.brand.toLowerCase());
    expect(all).not.toContain('"');
    for (const w of NEGATIVE_BASE) expect(m.prompt.negative).toContain(w);
    if (m.prompt.kind === 'dress') expect(m.prompt.negative).toMatch(/\btrousers\b/);
    expect(m.hash_inputs.prompt).toEqual(m.prompt);
  });

  it('describes the garment from category, colour, length, sleeves and fabric', () => {
    expect(run({ ...SMALL_JOB, productId: 'aalter-studio-2' }).manifest.prompt.description).toBe(
      'a cream midi long-sleeved shirt dress in a lightweight cotton fabric, one closed skirt that falls from the waist to the hem and covers both legs',
    );
    expect(job.manifest.prompt.description).toBe('a black short-sleeved t-shirt in a crisp cotton fabric');
    expect(job.manifest.prompt.colour.source).toMatch(/primaryColorHex #111111/);
  });

  it('takes the colour from primaryColorHex only, never from a word of the product name', () => {
    expect(promptColour({ primaryColorHex: '#111111' }).name).toBe('black'); // a solid black dress
    expect(promptColour({ primaryColorHex: '' }).name).toBeNull();
    // A name word is a print or collection name: "Azure Palm" is a cream print, not blue (run 13).
    const azure = { primaryColorHex: '', name: 'Azure Palm Baby Doll Dress' };
    expect(promptColour(azure).name).toBeNull();
    const rosewater = { primaryColorHex: '#f2ebdd', name: 'Rosewater Blouse' };
    expect(promptColour(rosewater).name).toBe('cream');
  });
});

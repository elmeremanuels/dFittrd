import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBody, type Mannequin } from '@curtain/mannequin';
import { decodeRealisticBody, fitRealisticBody, fitTargetOf } from './realisticBody';
import { HAIR_COLOURS, HAIR_LENGTHS, HAIR_PALETTE, HAIR_TYPES, hairOf } from './hairOptions';
import { HAIR_TRIANGLE_BUDGET, buildHair, coilTexture, sculptedCoilTextures, sculptedLockTextures, strandTexture, textureBytes, type HairBodyInput, type HairBuild } from './realisticHair';
import { createHair, HAIR_OBJECT_NAME } from './realisticHairDraw';
import { realisticHairOf } from './mount';

const asset = decodeRealisticBody(readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)));
const BODY_ASSET_BYTES = readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)).byteLength;

const BODIES = {
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
} as const;

function bodyOf(b: (typeof BODIES)[keyof typeof BODIES]): { m: Mannequin; input: HairBodyInput } {
  const m = buildBody({ family: 'female', ...b });
  const fit = fitRealisticBody(asset, fitTargetOf(m));
  const y = (id: string): number => m.rings.find((r) => r.id === id)!.centre[1];
  return { m, input: { positions: fit.mesh.positions, indices: fit.mesh.indices, headWeight: asset.headWeight, armWeight: asset.armWeight, bodyVertexCount: asset.meta.bodyVertexCount, ringY: { shoulder: y('shoulder'), chest: y('chest'), underbust: y('underbust') } } };
}

const mid = bodyOf(BODIES.mid);

/** Every hair vertex, all parts. */
function* hairVertices(b: HairBuild): Generator<[number, number, number]> {
  for (const p of b.parts) for (let i = 0; i < p.positions.length; i += 3) yield [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!];
}

/**
 * An independent inside test against the drawn mesh itself (not the hair's own hull and table): the nearest body
 * vertex (head, neck and torso; the eyes are not body surface) and its area-weighted normal; a hair vertex is inside
 * when it lies behind that vertex's tangent plane by more than `tol` cm.
 */
function insideCounter(input: HairBodyInput): (p: [number, number, number], tol: number) => boolean {
  const P = input.positions, I = input.indices, n = input.bodyVertexCount;
  const N = new Float64Array(3 * n);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
    const vx = P[3 * c]! - P[3 * a]!, vy = P[3 * c + 1]! - P[3 * a + 1]!, vz = P[3 * c + 2]! - P[3 * a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      N[3 * v] = N[3 * v]! + nx;
      N[3 * v + 1] = N[3 * v + 1]! + ny;
      N[3 * v + 2] = N[3 * v + 2]! + nz;
    }
  }
  const CELL = 2;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (let i = 0; i < n; i++) {
    if (P[3 * i + 1]! < input.ringY.underbust - 16) continue;
    const k = key(P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  return (p, tol) => {
    let best = -1, bd = Infinity;
    const [cx, cy, cz] = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = (P[3 * i]! - p[0]) ** 2 + (P[3 * i + 1]! - p[1]) ** 2 + (P[3 * i + 2]! - p[2]) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
    if (best < 0) return false;
    const l = Math.hypot(N[3 * best]!, N[3 * best + 1]!, N[3 * best + 2]!) || 1;
    const s = ((p[0] - P[3 * best]!) * N[3 * best]! + (p[1] - P[3 * best + 1]!) * N[3 * best + 1]! + (p[2] - P[3 * best + 2]!) * N[3 * best + 2]!) / l;
    return s < -tol;
  };
}

const builds = new Map<string, HairBuild>();
const buildOf = (type: (typeof HAIR_TYPES)[number], length: (typeof HAIR_LENGTHS)[number]): HairBuild => {
  const k = `${type}/${length}`;
  let b = builds.get(k);
  if (!b) builds.set(k, (b = buildHair(mid.input, { type, length, hex: '#5c3d29' })));
  return b;
};

describe('hair choice (MountOptions.hair)', () => {
  it('takes the ten types, four lengths and the palette (or #rrggbb); anything else is bald', () => {
    expect(HAIR_TYPES).toEqual(['1', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C']);
    expect(HAIR_LENGTHS).toEqual(['short', 'chin', 'shoulder', 'long']);
    expect(HAIR_COLOURS).toEqual(['black', 'dark-brown', 'brown', 'light-brown', 'auburn', 'copper', 'dark-blonde', 'blonde', 'platinum', 'grey']);
    expect(hairOf({ type: '4C', length: 'long', colour: 'black' })).toEqual({ type: '4C', length: 'long', hex: HAIR_PALETTE.black });
    expect(hairOf({ type: '2B', length: 'chin', colour: '#AA3311' })).toEqual({ type: '2B', length: 'chin', hex: '#aa3311' });
    for (const bad of [undefined, null, 'long', {}, { type: '5A', length: 'long', colour: 'black' }, { type: '1', length: 'waist', colour: 'black' }, { type: '1', length: 'long', colour: 'green' }, { type: '1', length: 'long' }]) expect(hairOf(bad)).toBeNull();
  });

  it('is drawn only with the realistic body: with the procedural body (the default) the option changes nothing', () => {
    const hair = { type: '3A', length: 'shoulder', colour: 'auburn' } as const;
    expect(realisticHairOf({ bodyShape: 'realistic-spike', hair })).toEqual({ type: '3A', length: 'shoulder', hex: HAIR_PALETTE.auburn });
    expect(realisticHairOf({ hair })).toBeNull();
    expect(realisticHairOf({ bodyShape: 'procedural', hair })).toBeNull();
    expect(realisticHairOf({ bodyShape: 'realistic-spike' })).toBeNull();
  });

  it('the mount loads the hair code only by import(), only with a valid choice, and draws the AI passes without it', () => {
    const src = readFileSync(new URL('./mount.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import[^;]*['"]\.\/realisticHair(Draw)?['"]/m);
    expect(src).toMatch(/import\('\.\/realisticHairDraw'\)/);
    expect(src).toMatch(/const hair = realisticHairOf\(opts\);/);
    expect(src).toMatch(/if \(hair\) hair\.visible = false;/);
    // The group name the mount hides is the one the drawing module gives the hair.
    expect(src).toContain(`const HAIR_GROUP = '${HAIR_OBJECT_NAME}';`);
  });
});

describe('buildHair: every type in every length', () => {
  for (const type of HAIR_TYPES) {
    it(`${type}: short, chin, shoulder and long build within the body's own triangle count, finite, clear of the body and the face`, () => {
      const inside = insideCounter(mid.input);
      for (const length of HAIR_LENGTHS) {
        const b = buildOf(type, length);
        expect(b.triangles, `${type} ${length}`).toBeLessThanOrEqual(HAIR_TRIANGLE_BUDGET);
        expect(b.clumps, `${type} ${length}`).toBeGreaterThan(20);
        expect(b.parts.find((p) => p.kind === 'cap')!.indices.length).toBeGreaterThan(0);
        let n = 0, bad = 0, inFace = 0;
        const h = b.head;
        for (const p of hairVertices(b)) {
          n++;
          expect(Number.isFinite(p[0] + p[1] + p[2])).toBe(true);
          if (inside(p, 0.3)) bad++;
          // The face: in front of the eyes' plane, between the chin and the brows, inside the cheeks.
          if (p[2] > h.centre[2] + 4.5 && p[1] > h.chin + 1 && p[1] < h.centre[1] + 3 && Math.abs(p[0]) < 4.5) inFace++;
        }
        expect(inFace, `${type} ${length}: vertices over the face`).toBe(0);
        // Card corners may dip into the skin by a few mm where a card crosses a fold; at most 1 % of the vertices.
        expect(bad / n, `${type} ${length}: share of vertices inside the body`).toBeLessThan(0.01);
      }
    });
  }

  it('length is length for the hanging types, and also volume for the coily ones', () => {
    const minY = (b: HairBuild): number => Math.min(...[...hairVertices(b)].map((p) => p[1]));
    const reach = (b: HairBuild): number => Math.max(...[...hairVertices(b)].map((p) => Math.hypot(p[0] - b.head.centre[0], p[1] - b.head.centre[1], p[2] - b.head.centre[2])));
    const ring = mid.input.ringY;
    for (const type of ['1', '2B', '3A'] as const) {
      const ys = HAIR_LENGTHS.map((l) => minY(buildOf(type, l)));
      for (let i = 1; i < ys.length; i++) expect(ys[i]!, `${type}: ${HAIR_LENGTHS[i]} lower than ${HAIR_LENGTHS[i - 1]}`).toBeLessThan(ys[i - 1]!);
    }
    // Straight long hair rests on the back below the shoulders; curly hair of the same length ends higher (shrinkage).
    expect(minY(buildOf('1', 'long'))).toBeLessThan(ring.shoulder - 8);
    expect(minY(buildOf('3B', 'long'))).toBeGreaterThan(minY(buildOf('1', 'long')));
    // A long 4C is an afro: it reaches far out from the head, not down to the back.
    const r4 = HAIR_LENGTHS.map((l) => reach(buildOf('4C', l)));
    for (let i = 1; i < r4.length; i++) expect(r4[i]!).toBeGreaterThan(r4[i - 1]!);
    expect(r4[3]! - r4[0]!).toBeGreaterThan(8);
    expect(minY(buildOf('4C', 'long'))).toBeGreaterThan(ring.shoulder);
  });

  it('follows the head: on a petite and a tall body the hair sits on that body\'s head', () => {
    for (const b of [BODIES.petite, BODIES.tall, BODIES.full]) {
      const body = bodyOf(b);
      const h = buildHair(body.input, { type: '2A', length: 'shoulder', hex: '#000000' });
      const top = Math.max(...[...hairVertices(h)].map((p) => p[1]));
      expect(top).toBeGreaterThan(h.head.top);
      expect(top).toBeLessThan(h.head.top + 4);
      expect(h.head.top).toBeCloseTo(b.heightCm, 0);
      const inside = insideCounter(body.input);
      let n = 0, bad = 0;
      for (const p of hairVertices(h)) {
        n++;
        if (inside(p, 0.3)) bad++;
      }
      expect(bad / n).toBeLessThan(0.01);
    }
  });

  it('is the same hair for the same choice on the same body (seeded)', () => {
    const a = buildHair(mid.input, { type: '3B', length: 'chin', hex: '#000000' });
    const b = buildHair(mid.input, { type: '3B', length: 'chin', hex: '#ffffff' });
    const strands = (h: HairBuild): Float32Array => h.parts.find((p) => p.kind === 'strands')!.positions;
    expect(Buffer.from(strands(a).buffer).equals(Buffer.from(strands(b).buffer))).toBe(true);
  });
});

describe('bounds (D28)', () => {
  it('generated textures at most 256 KB together (RGBA8 with mips); no texture file', () => {
    const lock = sculptedLockTextures();
    const lockBytes = textureBytes(lock.albedo) + textureBytes(lock.normal);
    const coilBytes = Math.max(...(['3C', '4A', '4B', '4C'] as const).map((t) => {
      const c = sculptedCoilTextures(t);
      return textureBytes(c.albedo) + textureBytes(c.normal);
    }));
    expect(lockBytes + coilBytes).toBeLessThanOrEqual(256 * 1024);
    const cardBytes = textureBytes(strandTexture()) + Math.max(...(['3C', '4A', '4B', '4C'] as const).map((t) => textureBytes(coilTexture(t))));
    expect(cardBytes).toBeLessThanOrEqual(256 * 1024);
  });

  it('no more triangles than the body (27,036) and less code than the body asset', () => {
    expect(HAIR_TRIANGLE_BUDGET).toBe(asset.meta.triangleCount);
    const code = ['./hairOptions.ts', './realisticHair.ts', './realisticHairCards.ts', './realisticHairDraw.ts'].reduce((s, f) => s + readFileSync(new URL(f, import.meta.url)).byteLength, 0);
    expect(code).toBeLessThan(BODY_ASSET_BYTES);
  });

  it('WO-012: sculpted v2 uses opaque FrontSide solid locks with groove normal maps, zero SIMPLER across all 40, and preserves v1 strand-cards behind style option', () => {
    for (const type of HAIR_TYPES) {
      for (const length of HAIR_LENGTHS) {
        const b = buildOf(type, length);
        expect(b.style, `${type} ${length}`).toBe('sculpted');
        expect(b.simpler, `${type} ${length}`).toBeNull();
        expect(b.triangles, `${type} ${length}`).toBeLessThan(24_000);
      }
    }
    for (const type of ['1', '3B', '4C'] as const) {
      const v = createHair(mid.input, { type, length: 'long', hex: '#3b2a20' });
      expect(v.build.style).toBe('sculpted');
      for (const child of v.group.children) {
        const m = (child as unknown as { material: { type: string; alphaTest: number; transparent: boolean; side: number; alphaToCoverage: boolean; map: { anisotropy: number } | null; normalMap: { anisotropy: number } | null } }).material;
        expect(m.type).not.toBe('MeshPhysicalMaterial');
        expect(m.alphaTest).toBe(0);
        expect(m.transparent).toBe(false);
        expect(m.side).toBe(0); // THREE.FrontSide
        expect(m.alphaToCoverage).toBe(false);
        expect(m.normalMap).not.toBeNull();
        if (m.map) expect(m.map.anisotropy).toBe(1);
        if (m.normalMap) expect(m.normalMap.anisotropy).toBe(1);
      }
      v.dispose();
    }
    // Preserved v1 strand-cards option still works for CUR-31 / before-after comparison.
    const v1 = createHair(mid.input, { type: '3B', length: 'long', hex: '#a8512a' }, { style: 'strand-cards' });
    expect(v1.build.style).toBe('strand-cards');
    expect(v1.build.triangles).toBeLessThanOrEqual(HAIR_TRIANGLE_BUDGET);
    const strandMesh = v1.group.children.find((c) => c.name === `${HAIR_OBJECT_NAME}-strands`) as unknown as { material: { alphaTest: number } };
    expect(strandMesh.material.alphaTest).toBeGreaterThan(0);
    v1.dispose();
  });
});

describe('the hair is never sent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('building it (geometry, textures, three.js meshes) makes no request of any kind', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in the hair')));
    const xhr = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', xhr);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const v = createHair(mid.input, { type: '4C', length: 'long', hex: '#1f1b19' });
    expect(v.group.name).toBe(HAIR_OBJECT_NAME);
    expect(v.group.children.length).toBeGreaterThanOrEqual(3);
    expect(v.textureBytes).toBeLessThanOrEqual(256 * 1024);
    v.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('its modules hold no request, storage or message API', () => {
    for (const f of ['./hairOptions.ts', './realisticHair.ts', './realisticHairCards.ts', './realisticHairDraw.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|postMessage|document\.cookie/);
    }
  });
});

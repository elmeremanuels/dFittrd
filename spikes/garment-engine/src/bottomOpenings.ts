/**
 * Where a bottom does not go round the body, and how wide it is there.
 *
 * The chart rows of a skirt (waist, hip) are tape girths; a skirt whose cloth is open at the side has no tape girth at the
 * hip at all ("no girth"), which says nothing about how big it is or how far the opening runs. Run 15's maxi skirt is that
 * case: FASHN's stills draw the skirt narrower than our mannequin at the hip (the grey hip shows outside the skirt on both
 * sides), the video turns that into a wedge-shaped slit at the side, and stage 4t, which keeps the cloth outside the body,
 * carves the slit where the frames show the body. This module measures it, it repairs nothing:
 *
 * - `openingProfile`: horizontal slices of the cloth every `stepCm` from its top edge down to its hem; per slice the cloth's
 *   coverage round the vertical axis, every angular gap wider than `minGapCm` (where, chord across it), the girth with the
 *   gaps bridged (`tapeGirth` with no gap limit), the mannequin's own girth at that height, and the cloth's smallest
 *   radial clearance over the mannequin's analytic section. Openings are the gaps grouped over consecutive slices by side.
 * - `stillWidths`: in a pinned still (or a frame), the garment mask's width and the mannequin's width on the row of a given
 *   height at the axis, and how much of the mannequin shows outside the garment on either side. A closed skirt worn on the
 *   mannequin cannot be narrower than it; a still that is says the generator drew it so.
 *
 * Azimuth: degrees round +Y from the front (+Z), +90° at the mannequin's left (+X), as in the camera record.
 */
import { slice, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import type { Mask } from './evalPng';
import { densifyLoop, tapeGirth } from './tape';
import { topEdgePlane } from './waistband';
import type { PinholeCamera } from './views';

export const OPENINGS = { stepCm: 2, bins: 72, minGapCm: 4 } as const;
export const OPENINGS_VERSION = 'bottom-openings-0.1.0';

export interface SliceGap {
  /** Middle of the gap, degrees (0 front, +90 the mannequin's left, ±180 back). */
  midDeg: number;
  deg: number;
  /** Straight line across the gap between the cloth on either side, cm. */
  chordCm: number;
}

export interface OpeningSlice {
  yCm: number;
  /** Share of the angular bins with cloth. */
  coverage: number;
  /** Gaps wider than `minGapCm` (chord), widest first. */
  gaps: SliceGap[];
  /** Tape round the cloth with every gap bridged (as `tapeGirth` bridges: radius interpolated across the gap, convex hull), cm. */
  bridgedCm: number | null;
  /** The mannequin at this height: the torso, or both legs in one tape below the crotch, cm. */
  bodyCm: number | null;
  /** Smallest radial distance of the cloth outside the mannequin's analytic section (negative: inside), cm. */
  minClearanceCm: number | null;
}

export interface Opening {
  side: 'left' | 'right' | 'front' | 'back';
  /** Highest and lowest slice with this gap, cm above the floor (slices `stepCm` apart). */
  topCm: number;
  bottomCm: number;
  /** Widest chord of the gap, cm, and the height where it is. */
  maxChordCm: number;
  atCm: number;
}

export interface OpeningProfile {
  version: string;
  stepCm: number;
  minGapCm: number;
  /** Highest and lowest cloth, cm above the floor. */
  topEdgeCm: number;
  hemCm: number;
  /**
   * Heights between which a gap counts as an opening: from 1 cm above the hem's highest sector (the 90th percentile of the
   * lowest cloth per 10°) to 1 cm under the top edge's lowest point (`topEdgePlane`, sectors of an opening dropped).
   */
  rangeCm: [number, number];
  slices: OpeningSlice[];
  openings: Opening[];
}

const LOOSE = { maxGapCm: 1e6, maxGapDeg: 360, minCoverage: 0 } as const;
const r2 = (x: number): number => Math.round(x * 100) / 100 + 0;

function sideOf(midDeg: number): Opening['side'] {
  const a = ((midDeg + 540) % 360) - 180;
  if (Math.abs(a) <= 45) return 'front';
  if (Math.abs(a) >= 135) return 'back';
  return a > 0 ? 'left' : 'right';
}

/** Radius of an ellipse with half-axes a (x) and b (z) in the direction (dx, dz). */
function ellipseRadius(a: number, b: number, dx: number, dz: number): number {
  const t = Math.atan2(dz, dx);
  return (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
}

function bodySectionPoints(m: Mannequin, y: number, n = 96): Vec3[] {
  const pts: Vec3[] = [];
  const ring = (s: { a: number; b: number; cx: number; cz: number }): void => {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI;
      pts.push([s.cx + s.a * Math.cos(t), y, s.cz + s.b * Math.sin(t)]);
    }
  };
  const t = m.torsoAt(y);
  if (t) ring(t);
  for (const side of [1, -1] as const) {
    const l = m.legAt(y, side);
    if (l) ring(l);
  }
  return pts;
}

/** Signed radial clearance of point p over the nearest of the mannequin's torso and leg sections at its height (null: none). */
function clearance(m: Mannequin, p: Vec3): number | null {
  const [x, y, z] = p;
  const t = m.torsoAt(y);
  const secs = [t, m.legAt(y, 1), m.legAt(y, -1)].filter((s): s is NonNullable<typeof s> => s !== null);
  let best: number | null = null;
  for (const s of secs) {
    const dx = x - s.cx, dz = z - s.cz;
    const c = Math.hypot(dx, dz) - ellipseRadius(s.a, s.b, dx, dz);
    if (best === null || c < best) best = c;
  }
  return best;
}

function gapsOf(pts: readonly Vec3[], cx: number, cz: number, bins: number, minGapCm: number): { coverage: number; gaps: SliceGap[] } {
  const radii: number[][] = Array.from({ length: bins }, () => []);
  for (const p of pts) {
    const a = Math.atan2(p[0] - cx, p[2] - cz); // 0 = +Z (front), +π/2 = +X (left)
    const k = Math.min(bins - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * bins));
    radii[k]!.push(Math.hypot(p[0] - cx, p[2] - cz));
  }
  const r = radii.map((b) => (b.length ? b.sort((p, q) => p - q)[b.length >> 1]! : null));
  const filled = r.filter((x) => x !== null).length;
  const gaps: SliceGap[] = [];
  if (filled > 0 && filled < bins) {
    const start = r.findIndex((x) => x !== null);
    let run = 0;
    for (let k = 1; k <= bins; k++) {
      const i = (start + k) % bins;
      if (r[i] === null) { run++; continue; }
      if (run > 0) {
        const ra = r[(i - run - 1 + bins) % bins]!, rb = r[i]!;
        const dTheta = ((run + 1) * 2 * Math.PI) / bins; // centre of the last cloth bin to centre of the next
        const chord = Math.sqrt(Math.max(0, ra * ra + rb * rb - 2 * ra * rb * Math.cos(dTheta)));
        const first = (i - run + bins) % bins;
        const midDeg = (((first + run / 2) / bins) * 360 - 180 + 360) % 360;
        if (chord > minGapCm) gaps.push({ midDeg: r2(midDeg > 180 ? midDeg - 360 : midDeg), deg: r2((run * 360) / bins), chordCm: r2(chord) });
      }
      run = 0;
    }
  }
  gaps.sort((a, b) => b.chordCm - a.chordCm);
  return { coverage: r2(filled / bins), gaps };
}

export function openingProfile(mesh: Pick<Mesh, 'positions' | 'indices'>, m: Mannequin, o: { stepCm?: number; minGapCm?: number; bins?: number } = {}): OpeningProfile {
  const step = o.stepCm ?? OPENINGS.stepCm;
  const minGap = o.minGapCm ?? OPENINGS.minGapCm;
  const bins = o.bins ?? OPENINGS.bins;
  const P = mesh.positions;
  let top = -Infinity, bottom = Infinity;
  for (let k = 0; k < mesh.indices.length; k++) {
    const y = P[3 * mesh.indices[k]! + 1]!;
    if (y > top) top = y;
    if (y < bottom) bottom = y;
  }
  const slices: OpeningSlice[] = [];
  if (!Number.isFinite(top)) return { version: OPENINGS_VERSION, stepCm: step, minGapCm: minGap, topEdgeCm: NaN, hemCm: NaN, rangeCm: [NaN, NaN], slices, openings: [] };
  for (let y = Math.floor(top - 0.5); y > bottom + 0.5; y -= step) {
    const loops = slice(P, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] });
    const pts = loops.map((l) => densifyLoop(l)).flatMap((l) => l.points);
    if (pts.length < 3) continue;
    const t = m.torsoAt(y);
    const cx = t ? t.cx : 0, cz = t ? t.cz : 0;
    const centre: Vec3 = [cx, y, cz];
    const { coverage, gaps } = gapsOf(pts, cx, cz, bins, minGap);
    const bridged = tapeGirth(pts, centre, [1, 0, 0], [0, 0, 1], LOOSE);
    const bodyPts = bodySectionPoints(m, y);
    // Round the torso and both legs, as a tape would go (between the legs it bridges).
    const body = bodyPts.length ? tapeGirth(bodyPts, centre, [1, 0, 0], [0, 0, 1], LOOSE) : null;
    let minC: number | null = null;
    for (const p of pts) {
      const c = clearance(m, p);
      if (c !== null && (minC === null || c < minC)) minC = c;
    }
    slices.push({ yCm: y, coverage, gaps, bridgedCm: bridged ? r2(bridged.girthCm) : null, bodyCm: body ? r2(body.girthCm) : null, minClearanceCm: minC === null ? null : r2(minC) });
  }
  // Group the gaps of consecutive slices by side into openings, between the waistband and the hem only: above the lowest
  // point of the top edge (a band worn lower at the front) and below the highest point of the hem (a ragged hem) a gap is
  // the edge of the garment, not an opening.
  const { lo, hi } = bodyRange(mesh);
  type Open = Opening & { lastY: number };
  const openings: Open[] = [];
  const open = new Map<Opening['side'], Open>();
  for (const s of slices) {
    if (s.yCm > hi || s.yCm < lo) continue;
    const seen = new Set<Opening['side']>();
    for (const g of s.gaps) {
      const side = sideOf(g.midDeg);
      if (seen.has(side)) continue;
      seen.add(side);
      const cur = open.get(side);
      if (cur && cur.lastY - s.yCm <= step * 1.5) {
        cur.bottomCm = s.yCm;
        cur.lastY = s.yCm;
        if (g.chordCm > cur.maxChordCm) { cur.maxChordCm = g.chordCm; cur.atCm = s.yCm; }
      } else {
        if (cur) openings.push(cur);
        open.set(side, { side, topCm: s.yCm, bottomCm: s.yCm, maxChordCm: g.chordCm, atCm: s.yCm, lastY: s.yCm });
      }
    }
  }
  openings.push(...open.values());
  return {
    version: OPENINGS_VERSION,
    stepCm: step,
    minGapCm: minGap,
    topEdgeCm: r2(top),
    hemCm: r2(bottom),
    rangeCm: [r2(lo), r2(hi)],
    slices,
    openings: openings.map(({ lastY: _l, ...x }): Opening => x).sort((a, b) => b.topCm - b.bottomCm - (a.topCm - a.bottomCm)),
  };
}

function bodyRange(mesh: Pick<Mesh, 'positions' | 'indices'>): { lo: number; hi: number } {
  const tp = topEdgePlane(mesh);
  const hi = tp && tp.used.length ? Math.min(...tp.used.map((p) => p[1])) - 1 : Infinity;
  const P = mesh.positions;
  const sectors = 36;
  const low: number[] = new Array(sectors).fill(Infinity);
  let cx = 0, cz = 0;
  const n = P.length / 3;
  for (let i = 0; i < n; i++) { cx += P[3 * i]!; cz += P[3 * i + 2]!; }
  cx /= n || 1; cz /= n || 1;
  for (let k = 0; k < mesh.indices.length; k++) {
    const i = mesh.indices[k]!;
    const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!;
    const s = Math.min(sectors - 1, Math.floor(((Math.atan2(x - cx, z - cz) + Math.PI) / (2 * Math.PI)) * sectors));
    if (y < low[s]!) low[s] = y;
  }
  const f = low.filter(Number.isFinite).sort((a, b) => a - b);
  const lo = f.length ? f[Math.min(f.length - 1, Math.floor(0.9 * f.length))]! + 1 : -Infinity;
  return { lo, hi };
}

/** The slice nearest a height (the hip ring, say). */
export function sliceAt(p: OpeningProfile, yCm: number): OpeningSlice | null {
  let best: OpeningSlice | null = null;
  for (const s of p.slices) if (!best || Math.abs(s.yCm - yCm) < Math.abs(best.yCm - yCm)) best = s;
  return best && Math.abs(best.yCm - yCm) <= p.stepCm ? best : null;
}

export interface StillWidth {
  yCm: number;
  /** Pixel row of the height at the axis. */
  row: number;
  /** Widths at the axis's depth (cm per pixel from the camera distance), cm. */
  bodyCm: number;
  garmentCm: number | null;
  /** Mannequin outside the garment on the image's left and right, cm (0 when the garment covers that edge). */
  bodyOutsideLeftCm: number | null;
  bodyOutsideRightCm: number | null;
}

function project(cam: PinholeCamera, p: Vec3): [number, number, number] {
  const R = cam.R, t = cam.t;
  const x = R[0]! * p[0] + R[1]! * p[1] + R[2]! * p[2] + t[0]!;
  const y = R[3]! * p[0] + R[4]! * p[1] + R[5]! * p[2] + t[1]!;
  const z = R[6]! * p[0] + R[7]! * p[1] + R[8]! * p[2] + t[2]!;
  return [cam.fx * (x / z) + cam.cx, cam.fy * (y / z) + cam.cy, z];
}

/**
 * Garment against mannequin width on the row of each height, in one view. `body` is the mannequin's own silhouette in
 * that camera (rendered, not segmented); its run through the axis column is the torso (arms and hands are separate runs).
 */
export function stillWidths(garment: Mask, body: Mask, cam: PinholeCamera, heightsCm: readonly number[]): StillWidth[] {
  const out: StillWidth[] = [];
  const at = (mk: Mask, x: number, y: number): boolean => mk.data[y * mk.width + x]! > 0;
  for (const yCm of heightsCm) {
    const [u, v, depth] = project(cam, [0, yCm, 0]);
    const row = Math.round(v), cx = Math.round(u);
    if (row < 0 || row >= body.height || cx < 0 || cx >= body.width || !at(body, cx, row)) continue;
    let l = cx, r = cx;
    while (l > 0 && at(body, l - 1, row)) l--;
    while (r < body.width - 1 && at(body, r + 1, row)) r++;
    let gl = -1, gr = -1;
    for (let x = 0; x < garment.width; x++) if (at(garment, x, row)) { if (gl < 0) gl = x; gr = x; }
    const cmPerPx = depth / cam.fx;
    out.push({
      yCm,
      row,
      bodyCm: r2((r - l + 1) * cmPerPx),
      garmentCm: gl < 0 ? null : r2((gr - gl + 1) * cmPerPx),
      bodyOutsideLeftCm: gl < 0 ? null : r2(Math.max(0, gl - l) * cmPerPx),
      bodyOutsideRightCm: gl < 0 ? null : r2(Math.max(0, r - gr) * cmPerPx),
    });
  }
  return out;
}

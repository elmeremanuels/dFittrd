/**
 * Minimal QR encoder — byte mode, error-correction level L, versions 1–40.
 *
 * Only used as a fallback when the API response carries no `qrSvg`, so the
 * desktop modal still works. Deliberately small (≤ 2 KB gzipped, asserted in
 * size.test.ts). Output is a module matrix plus an SVG serialiser.
 */

// Level-L block structure for v1..v40 (ISO/IEC 18004 table 9).
const EC_PER_BLOCK = [
  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26,
  28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];
const NUM_BLOCKS = [
  1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
  16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

// GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);
const { floor, abs, max, min, ceil } = Math;
/** Chebyshev distance — the ring index inside a finder/alignment pattern. */
const ring = (dx: number, dy: number): number => max(abs(dx), abs(dy));

/** Reed–Solomon remainder of `data` divided by the degree-`ecLen` generator polynomial Π (x − α^i). */
function rsRemainder(data: ArrayLike<number>, ecLen: number): number[] {
  // Generator coefficients, highest degree first, with the leading 1 implicit.
  const gen = new Array<number>(ecLen).fill(0);
  gen[ecLen - 1] = 1;
  for (let i = 0, root = 1; i < ecLen; i++, root = mul(root, 2))
    for (let j = 0; j < ecLen; j++) gen[j] = mul(gen[j]!, root) ^ (j + 1 < ecLen ? gen[j + 1]! : 0);
  const rem = new Array<number>(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem.shift()!;
    rem.push(0);
    for (let j = 0; j < ecLen; j++) rem[j]! ^= mul(gen[j]!, factor);
  }
  return rem;
}

/** Data codewords available at level L: non-function modules (ISO 18004 table 1) / 8, minus EC codewords. */
function dataCodewords(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return floor(n / 8) - EC_PER_BLOCK[ver - 1]! * NUM_BLOCKS[ver - 1]!;
}

/** Centre coordinates of the alignment patterns for a version (annex E). */
function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const count = floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const out: number[] = [6];
  for (let p = size - 7; out.length < count; p -= step) out.splice(1, 0, p);
  return out;
}

/** The eight mask conditions (§7.8.2); a module is inverted where the condition evaluates to 0. */
function maskBit(m: number, x: number, y: number): number {
  const p = x * y;
  return [
    (x + y) % 2,
    y % 2,
    x % 3,
    (x + y) % 3,
    (floor(y / 2) + floor(x / 3)) % 2,
    (p % 2) + (p % 3),
    ((p % 2) + (p % 3)) % 2,
    (((x + y) % 2) + (p % 3)) % 2,
  ][m]!;
}

export interface QrMatrix {
  /** Modules per side (version × 4 + 17). */
  size: number;
  /** Row-major, 1 = dark. Index = y * size + x. */
  modules: Uint8Array;
  version: number;
  mask: number;
}

/** Encode `text` (UTF-8, byte mode, EC level L) into a module matrix. Throws if it does not fit in v40. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw Error('QR: too long');

  // --- bit stream (accumulated straight into codewords) ----------------------
  const data: number[] = [];
  let nbits = 0;
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--, nbits++) {
      if (nbits % 8 === 0) data.push(0);
      data[data.length - 1] = (data[data.length - 1]! << 1) | ((val >>> i) & 1);
    }
  };
  const cap = dataCodewords(ver);
  push(4, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, min(4, cap * 8 - nbits)); // terminator
  while (nbits % 8) push(0, 1);
  for (let pad = 0xec; data.length < cap; pad ^= 0xfd) data.push(pad); // 0xEC, 0x11, …

  // --- blocks + interleave --------------------------------------------------
  const nb = NUM_BLOCKS[ver - 1]!;
  const ec = EC_PER_BLOCK[ver - 1]!;
  const shortLen = floor(data.length / nb);
  const numLong = data.length % nb;
  const blocks: number[][] = [];
  for (let b = 0, off = 0; b < nb; b++) {
    const len = shortLen + (b < nb - numLong ? 0 : 1);
    blocks.push(data.slice(off, off + len));
    off += len;
  }
  const ecBlocks = blocks.map((b) => rsRemainder(b, ec));
  const codewords: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.length) codewords.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) codewords.push(b[i]!);

  // --- matrix ---------------------------------------------------------------
  const size = ver * 4 + 17;
  const mod = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size); // 1 = function pattern (not maskable)
  const set = (x: number, y: number, dark: number | boolean): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    mod[y * size + x] = dark ? 1 : 0;
    fn[y * size + x] = 1;
  };
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, !(i % 2));
    set(i, 6, !(i % 2));
  }
  // Finder patterns + separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = ring(dx, dy);
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  }
  // Alignment patterns.
  const ap = alignmentPositions(ver);
  const last = ap.length - 1;
  for (let i = 0; i < ap.length; i++)
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ap[i]! + dx, ap[j]! + dy, ring(dx, dy) !== 1);
    }
  // Format bits (drawn with mask 0 now to reserve the modules; redrawn after mask choice).
  const drawFormat = (mask: number): void => {
    const d = (1 << 3) | mask; // EC level L = 01
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    // Bit i sits beside the top-left finder (skipping the timing column) and again beside the other two.
    for (let i = 0; i < 15; i++) {
      const b = (f >>> i) & 1;
      set(i < 8 ? 8 : i === 8 ? 7 : 14 - i, i < 6 ? i : i < 8 ? i + 1 : 8, b);
      if (i < 8) set(size - 1 - i, 8, b);
      else set(8, size - 15 + i, b);
    }
    set(8, size - 8, true);
  };
  drawFormat(0);
  // Version bits.
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (v >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }
  // Data placement: two-column zigzag from the bottom-right, skipping the vertical timing column.
  let bi = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = (right + 1) & 2 ? vert : size - 1 - vert;
        const k = y * size + x;
        if (!fn[k] && bi < totalBits) {
          mod[k] = (codewords[bi >>> 3]! >>> (7 - (bi & 7))) & 1;
          bi++;
        }
      }
  }

  // --- mask selection ---------------------------------------------------------
  const applyMask = (m: number): void => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fn[y * size + x] && !maskBit(m, x, y)) mod[y * size + x] = mod[y * size + x]! ^ 1;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
    applyMask(m); // undo (XOR)
  }
  applyMask(best);
  drawFormat(best);
  return { size, modules: mod, version: ver, mask: best };
}

/** ISO 18004 §7.8.3 penalty score (lower is better). */
function penalty(mod: Uint8Array, size: number): number {
  let score = 0;
  const lines: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    let col = '';
    for (let x = 0; x < size; x++) {
      row += mod[y * size + x];
      col += mod[x * size + y];
    }
    lines.push(row, col);
  }
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) || []) score += run.length - 2; // 3 + (len − 5)
    score += 40 * (line.match(/(?=10111010000|00001011101)/g) || []).length; // finder-like runs (overlapping)
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const v = mod[k]!;
      dark += v;
      if (
        x + 1 < size &&
        y + 1 < size &&
        v === mod[k + 1] &&
        v === mod[k + size] &&
        v === mod[k + size + 1]
      )
        score += 3;
    }
  const totalMods = size * size;
  score += (ceil(abs(dark * 20 - totalMods * 10) / totalMods) - 1) * 10;
  return score;
}

export interface QrSvgOptions {
  /** Module colour. Default ink `#1A1612`. */
  fg?: string;
  /** Background colour. Default white. */
  bg?: string;
  /** Quiet zone in modules. Default 4 (the spec minimum). */
  quiet?: number;
}

/** Render `text` as a crisp, self-contained SVG string (viewBox in module units). */
export function qrToSvg(text: string, opts: QrSvgOptions = {}): string {
  const { fg = '#1A1612', bg = '#FFFFFF', quiet = 4 } = opts;
  const { size, modules } = encodeQr(text);
  let d = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (modules[y * size + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const s = size + quiet * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`
  );
}

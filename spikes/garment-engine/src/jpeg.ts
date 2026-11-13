/**
 * Baseline JPEG encoder (ITU T.81, JFIF), dependency-free, for the stage 4t texture atlas inside
 * garment.glb (glTF 2.0 core allows image/jpeg). 8-bit RGB in, YCbCr 4:2:0 out, the standard
 * Annex K quantisation and Huffman tables, quality scaled as in the IJG library. Deterministic: same
 * pixels and quality, same bytes. Not fast and not optimised (no progressive mode, no optimised
 * Huffman tables); KTX2 for the shipped bundle stays a TODO (docs/ENGINE-HANDOFF.md §Stage 8).
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58,
  59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

// Annex K.3 Huffman tables: code counts per length 1..16, then the symbols.
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

interface HuffTable {
  code: Uint16Array;
  size: Uint8Array;
}

function buildHuffman(bits: readonly number[], vals: readonly number[]): HuffTable {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]!; i++) {
      const v = vals[k++]!;
      code[v] = c;
      size[v] = len;
      c++;
    }
    c <<= 1;
  }
  return { code, size };
}

function scaledTable(base: readonly number[], quality: number): Uint8Array {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  // Stored in zig-zag order (DQT), applied in natural order.
  const natural = base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
  return Uint8Array.from(ZIGZAG.map((n) => natural[n]!));
}

const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
  return t;
})();

/** 8×8 forward DCT (separable), output scaled as T.81 A.3.3 (×1/4 · C(u) · C(v)). */
function fdct(block: Float64Array, out: Float64Array, tmp: Float64Array): void {
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * COS[x * 8 + u]!;
      tmp[y * 8 + u] = s / 2;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u]! * COS[y * 8 + v]!;
      out[v * 8 + u] = s / 2;
    }
  }
}

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(code: number, size: number): void {
    for (let i = size - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.n++;
      if (this.n === 8) {
        this.bytes.push(this.acc);
        if (this.acc === 0xff) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush(): number[] {
    if (this.n > 0) this.write((1 << (8 - this.n)) - 1, 8 - this.n);
    return this.bytes;
  }
}

const category = (v: number): number => {
  let a = Math.abs(v);
  let c = 0;
  while (a) {
    c++;
    a >>= 1;
  }
  return c;
};

export interface RgbImage {
  width: number;
  height: number;
  /** RGB, 8-bit, row-major. */
  data: Uint8Array;
}

export function encodeJpeg(img: RgbImage, quality = 88): Uint8Array {
  const { width: W, height: H, data } = img;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1 || W > 65535 || H > 65535) throw new Error(`bad JPEG size ${W}×${H}`);
  if (data.length !== W * H * 3) throw new Error('JPEG input is not RGB');
  const qY = scaledTable(LUMA_Q, quality);
  const qC = scaledTable(CHROMA_Q, quality);
  const qYn = new Float64Array(64), qCn = new Float64Array(64);
  for (let k = 0; k < 64; k++) {
    qYn[ZIGZAG[k]!] = qY[k]!;
    qCn[ZIGZAG[k]!] = qC[k]!;
  }
  const dcY = buildHuffman(DC_LUMA_BITS, DC_LUMA_VALS), acY = buildHuffman(AC_LUMA_BITS, AC_LUMA_VALS);
  const dcC = buildHuffman(DC_CHROMA_BITS, DC_CHROMA_VALS), acC = buildHuffman(AC_CHROMA_BITS, AC_CHROMA_VALS);

  // Colour conversion (JFIF), level shift by −128.
  const Y = new Float64Array(W * H), Cb = new Float64Array(W * H), Cr = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[3 * i]!, g = data[3 * i + 1]!, b = data[3 * i + 2]!;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const out = new BitWriter();
  const block = new Float64Array(64), coef = new Float64Array(64), tmp = new Float64Array(64);
  const preds = [0, 0, 0];
  const encodeBlock = (q: Float64Array, dc: HuffTable, ac: HuffTable, comp: number): void => {
    fdct(block, coef, tmp);
    const zz = new Int32Array(64);
    for (let k = 0; k < 64; k++) zz[k] = Math.round(coef[ZIGZAG[k]!]! / q[ZIGZAG[k]!]!);
    const diff = zz[0]! - preds[comp]!;
    preds[comp] = zz[0]!;
    const c = category(diff);
    out.write(dc.code[c]!, dc.size[c]!);
    if (c) out.write(diff < 0 ? diff + (1 << c) - 1 : diff, c);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = zz[k]!;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        out.write(ac.code[0xf0]!, ac.size[0xf0]!);
        run -= 16;
      }
      const cat = category(v);
      const sym = (run << 4) | cat;
      out.write(ac.code[sym]!, ac.size[sym]!);
      out.write(v < 0 ? v + (1 << cat) - 1 : v, cat);
      run = 0;
    }
    if (run > 0) out.write(ac.code[0]!, ac.size[0]!);
  };
  const px = (plane: Float64Array, x: number, y: number): number => plane[Math.min(H - 1, y) * W + Math.min(W - 1, x)]!;
  for (let my = 0; my < H; my += 16) {
    for (let mx = 0; mx < W; mx += 16) {
      for (const [ox, oy] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = px(Y, mx + ox + x, my + oy + y);
        encodeBlock(qYn, dcY, acY, 0);
      }
      for (const [plane, comp] of [[Cb, 1], [Cr, 2]] as const) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const sx = mx + 2 * x, sy = my + 2 * y;
          block[y * 8 + x] = (px(plane, sx, sy) + px(plane, sx + 1, sy) + px(plane, sx, sy + 1) + px(plane, sx + 1, sy + 1)) / 4;
        }
        encodeBlock(qCn, dcC, acC, comp);
      }
    }
  }
  const scan = out.flush();

  const bytes: number[] = [];
  const u16 = (v: number): void => {
    bytes.push((v >> 8) & 0xff, v & 0xff);
  };
  const marker = (m: number): void => {
    bytes.push(0xff, m);
  };
  marker(0xd8); // SOI
  marker(0xe0); // APP0 JFIF
  u16(16);
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0);
  u16(1);
  u16(1);
  bytes.push(0, 0);
  marker(0xdb); // DQT
  u16(2 + 2 * 65);
  bytes.push(0, ...qY, 1, ...qC);
  marker(0xc0); // SOF0
  u16(17);
  bytes.push(8);
  u16(H);
  u16(W);
  bytes.push(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  marker(0xc4); // DHT
  const tables: [number, readonly number[], readonly number[]][] = [[0x00, DC_LUMA_BITS, DC_LUMA_VALS], [0x10, AC_LUMA_BITS, AC_LUMA_VALS], [0x01, DC_CHROMA_BITS, DC_CHROMA_VALS], [0x11, AC_CHROMA_BITS, AC_CHROMA_VALS]];
  u16(2 + tables.reduce((n, [, b, v]) => n + 1 + 16 + v.length + 0 * b.length, 0));
  for (const [id, b, v] of tables) bytes.push(id, ...b, ...v);
  marker(0xda); // SOS
  u16(12);
  bytes.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);
  const head = Uint8Array.from(bytes);
  const result = new Uint8Array(head.length + scan.length + 2);
  result.set(head, 0);
  result.set(scan, head.length);
  result[result.length - 2] = 0xff;
  result[result.length - 1] = 0xd9; // EOI
  return result;
}

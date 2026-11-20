// Generates the PWA icons (SVG + PNG) without any image library: a coral disc with a cream
// "fitting-room" door arch on cream/ink backgrounds. Deterministic; safe to re-run.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const CORAL = [0xff, 0x5a, 0x3c];
const CREAM = [0xf5, 0xef, 0xe7];
const INK = [0x1a, 0x16, 0x12];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Curtain">
  <rect width="512" height="512" rx="112" fill="#F5EFE7"/>
  <circle cx="256" cy="256" r="176" fill="#FF5A3C"/>
  <path d="M176 352V236a80 80 0 0 1 160 0v116z" fill="#F5EFE7"/>
  <rect x="236" y="300" width="40" height="52" rx="6" fill="#1A1612"/>
</svg>
`;
writeFileSync(join(out, 'icon.svg'), svg);

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size, maskable) {
  const s = size / 512;
  const bg = maskable ? CORAL : CREAM;
  const disc = maskable ? CREAM : CORAL;
  const door = maskable ? CORAL : CREAM;
  return png(size, (px, py) => {
    const x = px / s;
    const y = py / s;
    const dx = x - 256;
    const dy = y - 256;
    const inDisc = dx * dx + dy * dy <= 176 * 176;
    if (!inDisc) return bg;
    // door arch: rectangle 176..336 x 236..352 plus semicircle centre (256,236) r 80
    const inArch = (x >= 176 && x <= 336 && y >= 236 && y <= 352) || (y < 236 && dx * dx + (y - 236) * (y - 236) <= 80 * 80);
    if (inArch) {
      if (x >= 236 && x <= 276 && y >= 300 && y <= 352) return INK;
      return door;
    }
    return disc;
  });
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
]) {
  const file = join(out, name);
  if (!existsSync(file) || process.argv.includes('--force')) writeFileSync(file, icon(size, maskable));
}
console.log(`icons written to ${out}`);

/**
 * Colour helpers of the e2e tests: sRGB to CIELAB (D65) and the CIEDE2000 difference, plus the
 * comparison of two screenshots in a blank page of the browser under test (no PNG decoder in Node).
 */
import type { Page } from '@playwright/test';

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

export function labOf(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 (Sharma, Wu, Dalal 2005), kL = kC = kH = 1. */
export function deltaE2000(a: Lab, b: Lab): number {
  const rad = Math.PI / 180;
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (x: number, y: number): number => (x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / rad + 360) % 360);
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * rad);
  const lBarP = (L1 + L2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP /= 2;
    else hBarP = (hBarP + (hBarP < 360 ? 360 : -360)) / 2;
  }
  const t = 1 - 0.17 * Math.cos((hBarP - 30) * rad) + 0.24 * Math.cos(2 * hBarP * rad) + 0.32 * Math.cos((3 * hBarP + 6) * rad) - 0.2 * Math.cos((4 * hBarP - 63) * rad);
  const sL = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hBarP - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dLp / sL) ** 2 + (dCp / sC) ** 2 + (dHp / sH) ** 2 + rT * (dCp / sC) * (dHp / sH));
}

export const deltaEHex = (a: string, b: string): number => deltaE2000(labOf(hexToRgb(a)), labOf(hexToRgb(b)));

export interface ShotDiff {
  /** Pixels of the pictures. */
  total: number;
  /** Pixels where a channel differs by more than the threshold (with `keepA`: only those of that kind in A). */
  changed: number;
  /** With `keepA`: the changed pixels of another kind in A (0 otherwise). */
  changedElsewhere: number;
  /** Median colour of picture B over the changed pixels (null when nothing changed). */
  medianB: Rgb | null;
  /** The same pixels in picture A. */
  medianA: Rgb | null;
  /** 10th and 90th percentile of the changed pixels of B, by lightness (the spread of the shading). */
  p10B: Rgb | null;
  p90B: Rgb | null;
}

/**
 * Compare two PNG screenshots of the same element, in `decoder` (a blank page: the page under test
 * is not touched and sees no request). The changed pixels are where the two pictures differ.
 * `keepA` keeps only the changed pixels that are bare body in A, where A is the picture in the
 * standard colour (a see-through garment over the body changes too, and is not skin): `grey` for
 * the 3D view's neutral grey mannequin, `warm` for the 2D figure's standard skin colour.
 */
export function diffShots(decoder: Page, a: Buffer, b: Buffer, { threshold = 10, keepA = null }: { threshold?: number; keepA?: 'grey' | 'warm' | null } = {}): Promise<ShotDiff> {
  return decoder.evaluate(
    async ({ a, b, threshold, keepA }) => {
      const load = async (b64: string): Promise<ImageData> => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [ia, ib] = [await load(a), await load(b)];
      if (ia.width !== ib.width || ia.height !== ib.height) throw new Error(`pictures differ in size: ${ia.width}x${ia.height} and ${ib.width}x${ib.height}`);
      const pa: [number, number, number][] = [];
      const pb: [number, number, number][] = [];
      let elsewhere = 0;
      for (let i = 0; i < ia.data.length; i += 4) {
        const d = Math.max(Math.abs(ia.data[i]! - ib.data[i]!), Math.abs(ia.data[i + 1]! - ib.data[i + 1]!), Math.abs(ia.data[i + 2]! - ib.data[i + 2]!));
        if (d <= threshold) continue;
        const [r, g, bl] = [ia.data[i]!, ia.data[i + 1]!, ia.data[i + 2]!];
        const kept = keepA === 'grey' ? Math.max(r, g, bl) - Math.min(r, g, bl) <= 6 : keepA === 'warm' ? r - bl > 30 && r > g && g > bl : true;
        if (!kept) elsewhere += 1;
        else {
          pa.push([ia.data[i]!, ia.data[i + 1]!, ia.data[i + 2]!]);
          pb.push([ib.data[i]!, ib.data[i + 1]!, ib.data[i + 2]!]);
        }
      }
      const lum = (p: [number, number, number]): number => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      const at = (list: [number, number, number][], q: number): [number, number, number] | null => {
        if (!list.length) return null;
        const sorted = [...list].sort((x, y) => lum(x) - lum(y));
        return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      };
      const median = (list: [number, number, number][]): [number, number, number] | null => {
        if (!list.length) return null;
        const ch = (k: number): number => list.map((p) => p[k]!).sort((x, y) => x - y)[Math.floor(list.length / 2)]!;
        return [ch(0), ch(1), ch(2)];
      };
      return { total: ia.width * ia.height, changed: pb.length, changedElsewhere: elsewhere, medianB: median(pb), medianA: median(pa), p10B: at(pb, 0.1), p90B: at(pb, 0.9) };
    },
    { a: a.toString('base64'), b: b.toString('base64'), threshold, keepA },
  );
}

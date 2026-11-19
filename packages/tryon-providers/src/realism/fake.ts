/**
 * Test and development provider for the realism layer: makes a "photo" from the colour pass in
 * process (a little noise and light), and can be told to lie in the ways the checks must catch
 * (move the hem, recolour, draw the neighbouring size, repaint the backdrop). Zero cost, nothing
 * leaves the process.
 */
import { DISCLAIMER } from '../types.js';
import type { RealismCapabilities, RealismInput, RealismOutput, RealismProvider } from './provider.js';
import type { RgbaImage } from './passes.js';

export type FakeRealismMode = 'faithful' | 'move-hem' | 'recolour' | 'neighbour-size' | 'repaint-backdrop' | 'widen' | 'relight';

export interface FakeRealismConfig {
  mode?: FakeRealismMode;
  /** For `relight`: brightness factor on the figure (default 0.93). */
  light?: number;
  /** For `move-hem` / `widen`: how many cm. Default 4. */
  cm?: number;
  costUsd?: number;
  /** Return an image of other dimensions. */
  wrongSize?: boolean;
}

/** Deterministic noise in −a..a. */
function noise(i: number, a: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 2 * a - a);
}

export class FakeRealismProvider implements RealismProvider {
  readonly name = 'fake-realism';
  readonly models = ['fake-realism-v0'] as const;
  readonly capabilities: RealismCapabilities = { structure: ['img2img', 'depth', 'normal', 'mask'], region: 'local', retentionHours: 0, trainsOnInputs: false };
  readonly calls: RealismInput[] = [];
  constructor(private readonly config: FakeRealismConfig = {}) {}

  estimateCostUsd(): number {
    return this.config.costUsd ?? 0;
  }

  async enhance(input: RealismInput): Promise<RealismOutput> {
    this.calls.push(input);
    const p = input.passes;
    const { width: w, height: h } = p;
    const src = p.colour.data;
    const out = new Uint8Array(src);
    const fig = p.figureMask.data, gar = p.garmentMask.data;
    const mode = this.config.mode ?? 'faithful';
    const span = (() => {
      let top = -1, bottom = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fig[y * w + x]! >= 128) { if (top < 0) top = y; bottom = y; }
      return { top, bottom };
    })();
    const pxPerCm = (span.bottom - span.top + 1) / p.meta.statureCm;
    const shift = Math.round((this.config.cm ?? 4) * pxPerCm);
    // The garment's colour in the middle column (unshaded), for the pixels a lie adds.
    const garmentPx = (() => {
      const x = w >> 1;
      for (let y = 0; y < h; y++) if (gar[y * w + x]! >= 128) return [src[4 * (y * w + x)]!, src[4 * (y * w + x) + 1]!, src[4 * (y * w + x) + 2]!] as const;
      return [128, 128, 128] as const;
    })();
    const paint = (i: number, rgb: readonly number[]): void => {
      out[4 * i] = rgb[0]!;
      out[4 * i + 1] = rgb[1]!;
      out[4 * i + 2] = rgb[2]!;
      out[4 * i + 3] = 255;
    };
    if (mode === 'move-hem') {
      // Garment pixels pulled down by `shift` rows: the hem (and the garment's lower part) moves.
      for (let y = h - 1; y >= 0; y--)
        for (let x = 0; x < w; x++) {
          const ys = y - shift;
          if (ys >= 0 && gar[ys * w + x]! >= 128) paint(y * w + x, [src[4 * (ys * w + x)]!, src[4 * (ys * w + x) + 1]!, src[4 * (ys * w + x) + 2]!]);
        }
    } else if (mode === 'widen') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (gar[i]! < 128) continue;
          const own = [src[4 * i]!, src[4 * i + 1]!, src[4 * i + 2]!];
          for (let d = 1; d <= shift; d++) {
            if (x - d >= 0 && gar[i - d]! < 128) paint(i - d, own);
            if (x + d < w && gar[i + d]! < 128) paint(i + d, own);
          }
        }
    } else if (mode === 'recolour') {
      for (let i = 0; i < w * h; i++) if (gar[i]! >= 128) paint(i, [src[4 * i + 2]!, src[4 * i]!, src[4 * i + 1]!]);
    } else if (mode === 'neighbour-size' && p.neighbour) {
      const nb = p.neighbour.garmentMask.data;
      const skin = (() => {
        for (let i = 0; i < w * h; i++) if (fig[i]! >= 128 && gar[i]! < 128) return [src[4 * i]!, src[4 * i + 1]!, src[4 * i + 2]!];
        return [200, 170, 150];
      })();
      const bd = [src[0]!, src[1]!, src[2]!];
      for (let i = 0; i < w * h; i++) {
        if (nb[i]! >= 128) paint(i, garmentPx);
        else if (gar[i]! >= 128) paint(i, fig[i]! >= 128 ? skin : bd);
      }
    } else if (mode === 'relight') {
      const k = this.config.light ?? 0.93;
      for (let i = 0; i < w * h; i++) if (fig[i]! >= 128) paint(i, [src[4 * i]! * k, src[4 * i + 1]! * k, src[4 * i + 2]! * k].map(Math.round));
    } else if (mode === 'repaint-backdrop') {
      for (let i = 0; i < w * h; i++) if (fig[i]! < 128) paint(i, [90 + ((i / w) % 60), 110, 140]);
    }
    // "Realism": a little deterministic grain and light on the figure only (the backdrop stays flat).
    for (let i = 0; i < w * h; i++) {
      if (fig[i]! < 128) continue;
      for (let c = 0; c < 3; c++) out[4 * i + c] = Math.max(0, Math.min(255, out[4 * i + c]! + noise(i * 3 + c, 3)));
    }
    const image: RgbaImage = this.config.wrongSize ? { width: w - 8, height: h, data: new Uint8Array((w - 8) * h * 4) } : { width: w, height: h, data: out };
    return { image, provider: this.name, model: this.models[0], costUsd: this.estimateCostUsd(), latencyMs: 0, retention: { vendorDeletesAfterHours: 0, trainedOn: false }, region: 'local', disclaimer: DISCLAIMER };
  }
}

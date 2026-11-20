/**
 * The AI realism layer's provider contract (D22, docs/research/ai-realism-layer.md §3). A provider
 * gets the 3D view's render passes and a prompt, never a person photo (AGENTS.md hard rule 1): the
 * input's only `kind` is `'renderPasses'`. Adapters are server-only like the rest of this package,
 * and their model ids are checked against the banned-model list (rule 6) when they are chosen.
 */
import type { Retention } from '../types.js';
import { DISCLAIMER, type Disclaimer } from '../types.js';
import type { RenderPasses, RgbaImage } from './passes.js';

export type StructureControl = 'img2img' | 'depth' | 'normal' | 'canny' | 'mask' | 'reference';

export interface RealismCapabilities {
  structure: readonly StructureControl[];
  /** Processing region as the vendor documents it ('eu', 'us', 'au', 'unspecified', 'local'). */
  region: string;
  /** Vendor retention of inputs and outputs, hours (null: unknown; 0: deleted on completion). */
  retentionHours: number | null;
  trainsOnInputs: boolean;
}

/** The encoded passes, as a vendor HTTP API takes them (PNG bytes). */
export interface EncodedPasses {
  colour: Uint8Array;
  depth: Uint8Array;
  normal: Uint8Array;
  garmentMask: Uint8Array;
}

export interface RealismInput {
  /** The only kind there is. Never add a photo kind. */
  kind: 'renderPasses';
  passes: RenderPasses;
  png: EncodedPasses;
  prompt: string;
  /** Image-to-image strength (denoise), 0–1; low keeps the structure. */
  strength: number;
  seed?: number;
}

export interface RealismOutput {
  image: RgbaImage;
  provider: string;
  model: string;
  costUsd: number;
  latencyMs: number;
  retention: Retention;
  region: string;
  disclaimer: Disclaimer;
}

export interface RealismProvider {
  readonly name: string;
  readonly models: readonly string[];
  readonly capabilities: RealismCapabilities;
  estimateCostUsd(input: Pick<RealismInput, 'passes'>): number;
  enhance(input: RealismInput, signal?: AbortSignal): Promise<RealismOutput>;
}

export { DISCLAIMER };

/** Words for the prompt: keep everything the estimate says; make it look like a photo. */
export function realismPrompt(garment: { category: string; colourName?: string | undefined; fabric?: string | undefined }): string {
  const what = [garment.colourName, garment.fabric, garment.category === 'bottom' ? 'skirt or trousers' : garment.category].filter(Boolean).join(' ');
  return [
    `Photorealistic studio photograph of a person wearing this ${what}.`,
    'Keep the garment exactly as drawn: the same outline, the same hem length, the same waist position, the same fit and the same colour.',
    'Keep the pose, the body shape and the framing. Keep the plain cream background.',
    'Neutral, generic face. No logos, no text, no accessories.',
  ].join(' ');
}

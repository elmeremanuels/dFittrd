/**
 * The realism pipeline (D22): guard the passes, call the provider, check the result, return the
 * image or a refusal. Every outcome carries the "AI-enhanced estimate" label code and the estimate
 * disclaimer (AGENTS.md hard rule 3). Nothing is stored.
 */
import { TryOnError } from '../errors.js';
import { findBanned } from '../registry.js';
import { DISCLAIMER, type Disclaimer } from '../types.js';
import { encodeMask, encodeRgba, fitToPasses } from './codec.js';
import { checkFidelity, type FidelityReport, type FidelityThresholds } from './fidelity.js';
import { checkRenderPasses, type PassIssue, type RenderPasses, type RgbaImage } from './passes.js';
import type { RealismOutput, RealismProvider } from './provider.js';

/** The label code of every AI image; the words are in the client catalogues (D21). */
export const AI_ENHANCED_LABEL = 'ai-enhanced-estimate' as const;

export type RealismOutcome =
  | { status: 'ok'; image: RgbaImage; png: Uint8Array; report: FidelityReport; provider: string; model: string; costUsd: number; latencyMs: number; region: string; label: typeof AI_ENHANCED_LABEL; disclaimer: Disclaimer }
  | { status: 'refused'; stage: 'passes'; issues: PassIssue[]; label: typeof AI_ENHANCED_LABEL; disclaimer: Disclaimer }
  | { status: 'refused'; stage: 'checks'; report: FidelityReport; provider: string; model: string; costUsd: number; label: typeof AI_ENHANCED_LABEL; disclaimer: Disclaimer };

/** Rule 6 for the realism providers: a provider whose name or model is on the banned list is never used. */
export function assertRealismProviderAllowed(p: Pick<RealismProvider, 'name' | 'models'>): void {
  for (const id of [p.name, ...p.models]) {
    const b = findBanned(id);
    if (b) throw new TryOnError('config', false, `realism provider "${p.name}" uses banned model "${id}" (${b})`, { provider: p.name });
  }
}

export interface RunRealismOptions {
  passes: RenderPasses;
  provider: RealismProvider;
  prompt: string;
  strength?: number;
  seed?: number;
  thresholds?: Partial<FidelityThresholds>;
  maxCostUsd?: number;
  signal?: AbortSignal;
}

export async function runRealism(opts: RunRealismOptions): Promise<RealismOutcome> {
  const base = { label: AI_ENHANCED_LABEL, disclaimer: DISCLAIMER } as const;
  const { passes, provider } = opts;
  assertRealismProviderAllowed(provider);
  const issues = checkRenderPasses(passes);
  if (issues.length) return { status: 'refused', stage: 'passes', issues, ...base };
  const cost = provider.estimateCostUsd({ passes });
  if (opts.maxCostUsd !== undefined && cost > opts.maxCostUsd) throw new TryOnError('budget', false, `realism render would cost ${cost} USD, above ${opts.maxCostUsd}`, { provider: provider.name });
  const png = {
    colour: await encodeRgba(passes.colour),
    depth: await encodeMask(passes.depth),
    normal: await encodeRgba(passes.normal),
    garmentMask: await encodeMask(passes.garmentMask),
  };
  const out: RealismOutput = await provider.enhance(
    { kind: 'renderPasses', passes, png, prompt: opts.prompt, strength: opts.strength ?? 0.35, ...(opts.seed !== undefined ? { seed: opts.seed } : {}) },
    opts.signal,
  );
  const image = await fitToPasses(out.image, passes.width, passes.height);
  const report = checkFidelity(passes, image, opts.thresholds);
  if (!report.ok) return { status: 'refused', stage: 'checks', report, provider: out.provider, model: out.model, costUsd: out.costUsd, ...base };
  return { status: 'ok', image, png: await encodeRgba(image), report, provider: out.provider, model: out.model, costUsd: out.costUsd, latencyMs: out.latencyMs, region: out.region, ...base };
}

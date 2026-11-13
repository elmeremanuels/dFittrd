/**
 * The capture pipeline names seasons with spaces ('warm autumn'); the taste engine's colour
 * harmony table uses camelCase keys ('trueAutumn'). This is the only place that maps them.
 */
import { isSeason, isUndertone, type Season, type Undertone } from '@curtain/taste-engine';
import type { Season as CaptureSeason } from '@/features/capture/types';

const CAPTURE_TO_TASTE: Record<CaptureSeason, Season> = {
  'light spring': 'lightSpring',
  'warm spring': 'trueSpring',
  'bright spring': 'brightSpring',
  'light summer': 'lightSummer',
  'cool summer': 'trueSummer',
  'soft summer': 'softSummer',
  'soft autumn': 'softAutumn',
  'warm autumn': 'trueAutumn',
  'deep autumn': 'deepAutumn',
  'deep winter': 'deepWinter',
  'cool winter': 'trueWinter',
  'bright winter': 'brightWinter',
};

export function seasonKey(captureSeason: string | null | undefined): Season | null {
  if (!captureSeason) return null;
  if (isSeason(captureSeason)) return captureSeason;
  return CAPTURE_TO_TASTE[captureSeason as CaptureSeason] ?? null;
}

/** The colour-match target: the confirmed/estimated season, else the undertone, else null. */
export function colourTarget(season: string | null, undertone: string | null): Season | Undertone | null {
  if (season && isSeason(season)) return season;
  if (undertone && isUndertone(undertone)) return undertone;
  return null;
}

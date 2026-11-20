/**
 * Swipe events — exactly the shapes in docs/research/taste-engine-spec.md §Types.
 * Swipes sync to `POST /v1/swipes` (no body data ever travels with them).
 */
import { z } from 'zod';

export const SWIPE_ACTIONS = ['love', 'pass', 'save', 'less'] as const;
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];
export const SwipeActionSchema = z.enum(SWIPE_ACTIONS);

export const PASS_REASONS = ['fit', 'price', 'colour', 'style', 'unknown'] as const;
export type PassReason = (typeof PASS_REASONS)[number];
export const PassReasonSchema = z.enum(PASS_REASONS);

export const SwipeEventSchema = z.object({
  /** Garment id (= GarmentPayload.id, shop-scoped external id). */
  itemId: z.string().min(1).max(128),
  action: SwipeActionSchema,
  /** Unix epoch milliseconds at swipe time. */
  at: z.number().int().nonnegative(),
  /** Size recommended by the fit engine at swipe time, null when nothing fit / no fit result. */
  sizeAtSwipe: z.string().max(16).nullable(),
  fitScore: z.number().min(0).max(1).nullable(),
  /** Inferred pass reasons; only set for `pass`. */
  reasons: z.array(PassReasonSchema).max(5).optional(),
  /** Position of this card in the deal sequence (drives penalty-memory expiry). */
  dealIndex: z.number().int().nonnegative(),
});
export type SwipeEvent = z.infer<typeof SwipeEventSchema>;

/** Learning rates per action (taste-engine-spec.md §applySwipe), exported so the UI can explain them. */
export const SWIPE_LEARNING_RATE: Record<SwipeAction, number> = { love: 0.12, save: 0.18, pass: 0.06, less: 0.2 };
export const SWIPE_SIGN: Record<SwipeAction, 1 | -1> = { love: 1, save: 1, pass: -1, less: -1 };

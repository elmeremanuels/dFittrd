# @paskamer/taste-engine

Pure TypeScript swipe learning and colour harmony for the Paskamer deck (handoff §5,
`docs/research/taste-engine-spec.md`). Zero runtime dependencies; the only import is **types**
from `@paskamer/schema` (`GarmentPayload`, `SwipeEvent`, `SwipeAction`, `PassReason`, `TasteAxis`).
Every function is pure: it returns new objects (structural sharing allowed) and never mutates its
inputs. The UI keeps `TasteState` in context + IndexedDB (`taste`, `outbox`); it is plain JSON
(no Sets/Maps) and round-trips through `JSON.stringify`.

```sh
pnpm --filter @paskamer/taste-engine typecheck   # tsc --noEmit
pnpm --filter @paskamer/taste-engine test        # vitest: spec vectors 1–16, colour, colour harmony
pnpm --filter @paskamer/taste-engine build       # tsup → dist/index.{js,cjs,d.ts}
pnpm --filter @paskamer/taste-engine lint        # eslint flat config
```

## Public API

```ts
import {
  emptyState, applyOnboardingVibes, featurize, styleMatch,
  applySwipe, inferPassReasons, drainOutbox, ackOutbox,
  penalty, addPenalty, tickPenalties,
  rankDeck, dealNext, scoreItem,
  styleDna,
  colourMatch, colourMatchScore, colourChipLabel, deltaE2000, hexToLab, SEASON_TABLE,
} from '@paskamer/taste-engine';
```

### State and types (`types.ts`)

| export | meaning |
|---|---|
| `TasteProfile` v1 | `axes` (0..1 per axis, init 0.5, always centred on 0.5), `silhouette` (-1..1), `colour`/`fabric`/`cut` affinities (-1..1, absent = 0), `price { lovedPrices (last 50), p80 }`, `swipeCount`, `explorationBonus` (0..0.3) |
| `TasteState` | `profile`, `penalties: PenaltyEntry[]`, `events` (ring buffer, 500), `seen: Record<itemId, dealIndex>` (`SEEN_FOREVER` = -1 for love/save/less), `dealIndex`, `outbox: OutboxEntry[]`, `loveCounts` (love/save per dominant axis, feeds the novelty term) |
| `ItemFeatures` | `axes`, `silhouette`, `hue: HueBin`, `fabric`, `cut`, `priceEur` |
| `PenaltyEntry` | `{ hue, fabric, cut, remainingCards, strength }` |
| `OutboxEntry` | `SwipeEvent` (wire type from schema) or `SaveOutboxEntry { type:'save', itemId, size }`; `isSaveOutboxEntry()` discriminates |
| `FitResultLike` | `{ recommendedSize: string \| null; score: number \| null }` — `@paskamer/fit-engine`'s `FitResult` is structurally assignable; the taste engine does not depend on that package |
| `DeckGarment` | the garment fields the engine reads (`id`, `category`, `priceEur`, `primaryColorHex`, `patternBlock`, `fabric.primary`, optional `ease`, `styleTags`); a full `GarmentPayload` is assignable |
| constants | `AXES` (fixed radar order, identical to schema `TASTE_AXES`), `HUE_BINS`, `SILHOUETTES`, `EVENTS_RING_SIZE` 500, `LOVED_PRICES_KEEP` 50, `PENALTY_CARDS` 50, `PENALTY_MAX_STRENGTH` 2, `RESURFACE_AFTER` 200, `WARM_UP_SWIPES` 20, `WARM_UP_MULTIPLIER` 1.5, `EXPLORATION_EVERY` 5 |

### Functions

- `emptyState()` / `emptyProfile()` — the spec's `S0`.
- `applyOnboardingVibes(state, vibes)` — `'Bohemian' | 'Minimal' | 'Classic' | 'Avant-Garde' | 'Sporty'` → that axis = 0.75; `'Eclectic'` → every axis = max(axis, 0.6) and `explorationBonus` 0.2. No centring; idempotent; unknown strings ignored.
- `featurize(garment)` — merchant `styleTags` when present, else the patternBlock + fabric tables (`PATTERN_BLOCK_AXES`, `FABRIC_AXES`) clamped to [0,1]; silhouette from `easeTotal` (bust+waist+hip, resolved `garment.ease → BLOCK_EASE → CATEGORY_EASE`, the fit engine's order): <6 fitted, 6–14 regular, 15–24 relaxed, >24 oversized; hue bin from hex→HSL (`hueBin`).
- `styleMatch(axes, v)` — Σ axes·v / Σ v, 0.5 when Σ v = 0.
- `applySwipe(state, garment, fit | null, action, now) → { state, event }` — learning rates love .12 / save .18 / pass .06 / less .20, ×1.5 while `swipeCount < 20`; pass reasons gate which dimensions move (`fit`/`price` only → nothing; `colour` → colour; `style` → axes, cut, silhouette; `unknown` → everything at ηe/2); axes centred after each update; affinities ±2ηe; love/save record the price (p80 = nearest-rank 80th percentile once ≥ 5); `less` writes penalty memory; `save` also pushes a `{type:'save'}` outbox marker (the caller adds the item to the wardrobe; **love never does**). The event is appended to `events` (ring 500) and `outbox`.
- `inferPassReasons(profile, features, fit)` — `fit` (no size or score < 0.5), `price` (> 1.25·p80), `colour` (swipeCount ≥ 10 and affinity ≤ −0.2), `style` (swipeCount ≥ 10 and styleMatch < 0.35), else `['unknown']`.
- `drainOutbox(state)` / `ackOutbox(state, count)` — for the sync layer (`POST /v1/swipes` takes the `SwipeEvent`s; save markers go to the wardrobe route). Nothing in the outbox contains body data.
- `penalty(penalties, features)` — Σ 0.35·strength (hue+fabric+cut match) / 0.12·strength (exactly two). `addPenalty`, `tickPenalties` are the building blocks.
- `rankDeck(catalog, state, fitFor, n = catalog.length) → { deck, notInYourSize, ranked }` — candidates = not seen, or passed ≥ 200 deals ago; items whose `fitFor(g).recommendedSize === null` are counted in `notInYourSize` and never shown. `base = .40·styleMatch + .20·(colour+1)/2 + .10·(fabric+1)/2 + .10·(cut+1)/2 + .15·fit.score + .05·priceFit`; `score = base − penalty + explorationBonus·novelty`; sort desc, ties by catalogue order. Deal rules from `state.dealIndex`: every 5th deal (`dealIndex % 5 === 4`) takes the best item whose dominant axis ≠ the user's top axis; a diversity pass defers a card sharing (hue, category) with the previous one by one position. `ranked` exposes every candidate's `base`, `penalty`, `novelty`, `score` for the UI/debug.
- `dealNext(catalog, state, fitFor) → { state, card, notInYourSize }` — deals one card (`rankDeck(..., 1)`), then `dealIndex += 1` and every penalty entry loses one card. Call it once per card shown; swipes do not tick penalties.
- `styleDna(profile)` — radar axes in fixed order, archetype (argmax) with copy `Free Spirit / Modern Minimalist / Timeless Classic / Avant-Garde / Athleisure`, `percent = round(axes[argmax]·100)`, subtitle `Refined by ${swipeCount} swipes`.

### Colour harmony (`colourHarmony.ts`)

- `hexToLab(hex)` — sRGB (D65) → CIELAB. `chroma`, `hueAngle` helpers.
- `deltaE2000(lab1, lab2)` — CIEDE2000 (Sharma, Wu & Dalal 2005; the reference pairs are in the tests).
- `SEASON_TABLE` / `SEASONS` — twelve seasons (Light/True/Bright Spring, Light/True/Soft Summer, Soft/True/Deep Autumn, Deep/True/Bright Winter), each with a label, family, dominant undertone (`warm | cool | neutral` — the soft seasons are `neutral`) and eight representative swatches including the season's best neutrals. Terracotta `#C97A4F` is a True Autumn swatch by construction.
- `colourMatch(garmentHex, season | undertone) → { score, label, deltaE, nearestSwatch, undertone, lab }` and `colourMatchScore(...) → 0..1`:
  - against a **season**: `0.7 · paletteProximity(min ΔE2000 to the season's swatches)` (1 at ΔE ≤ 8, 0 at ΔE ≥ 40) `+ 0.3 · undertoneAgreement(season undertone)`;
  - against a bare **undertone**: `undertoneAgreement` alone — `warmth = cos(h° − 60°)` weighted by chroma (achromatic colours, C* < 8, are 0.5 for everyone); warm → 0.5 + 0.5·warmth, cool → 0.5 − 0.5·warmth, neutral → 1 − 0.5·|warmth| (never below 0.5: nothing clashes with a neutral undertone).
  - chip label: ≥ 0.66 `'Great with your undertone'`, ≤ 0.34 `'Clashes'`, else `'Neutral'`. Tunables are exported as `COLOUR_MATCH`.
  - The season / undertone is the capture pipeline's on-device *estimate* (DECISIONS.md D5), confirmed by the user; this module never sees a photo.

## Typical flow in the app

```ts
let state = applyOnboardingVibes(emptyState(), chips);            // onboarding
const fitFor = (g) => computeFit(g, userBody);                      // @paskamer/fit-engine, on-device
const dealt = dealNext(catalog, state, fitFor);                     // one card shown
state = dealt.state;
const { state: next, event } = applySwipe(state, dealt.card.garment, dealt.card.fit, 'love', Date.now());
state = next;                                                        // persist to IndexedDB
const { entries, state: drained } = drainOutbox(state);             // batch to POST /v1/swipes
```

## Spec deviations and interpretations

All sixteen vectors reproduce the spec's numbers exactly (±0.001). Points the spec leaves open, resolved here:

1. **Silhouette ease defaults** — the spec says "category defaults from the fit engine when absent". The fit engine resolves `garment.ease → BLOCKS.ease → CATEGORY_EASE`, so `easeTotal` follows that order (block table `BLOCK_EASE` added). The fit engine's `skip` lists are not applied: a skipped point still contributes its default to the silhouette sum.
2. **Novelty ties** — "the axis with the fewest love/save events": on a fresh state (or any tie) every axis with the minimum count qualifies, so an Eclectic onboarding bonus lifts all items until a preference emerges instead of only bohemian-dominant ones.
3. **Exploration fallback** — when no candidate has a dominant axis different from the user's top axis, the exploration deal takes the top item.
4. **Diversity + exploration** — when an exploration pick shares (hue, category) with the previous card, the next item in rank order is dealt instead (the pick keeps its position for the following deal).
5. **`dealNext` / `dealIndex`** — `applySwipe` records `state.dealIndex` at swipe time (as the spec writes it); in the app the deal increments first, so a card dealt at index *k* is logged with `dealIndex k+1`. Re-surfacing and penalty expiry only need the index to be monotonic.
6. **Subtitle** — kept literally as `Refined by ${swipeCount} swipes` (so `Refined by 1 swipes`); pluralise in the UI if wanted.
7. **Malformed hex** — `hueBin` returns `'neutral-light'` and `colourMatch` returns `0.5 / 'Neutral'` instead of throwing; garment colours are schema-validated upstream so this is defensive only.
8. **Rounding** — profile numbers are stored at 4 dp (spec); scores from `rankDeck` are not rounded.

# Taste engine v1 — specification and test vectors

> Implementation spec for packages/taste-engine, derived from handoff §5.

## Taste engine v1 — pure TypeScript spec (`src/taste/`)

All functions are pure and return new state objects (structural sharing allowed); the UI stores `TasteState` in context + IndexedDB. Rounding: 4 dp for profile numbers.

### Types
```ts
type Axis = 'bohemian'|'minimal'|'classic'|'avantGarde'|'sporty';          // TasteRadial axes, fixed order
type Silhouette = 'fitted'|'regular'|'relaxed'|'oversized';
type HueBin = 'red'|'orange'|'yellow'|'green'|'teal'|'blue'|'purple'|'pink'|'neutral-light'|'neutral-dark'|'black'|'white';
interface TasteProfile {
  version: 1;
  axes: Record<Axis, number>;                  // 0..1, init 0.5
  silhouette: Record<Silhouette, number>;      // -1..1, init 0
  colour: Partial<Record<HueBin, number>>;     // -1..1, absent = 0
  fabric: Partial<Record<string, number>>;     // -1..1
  cut: Partial<Record<string, number>>;        // patternBlock → -1..1
  price: { lovedPrices: number[] /* last 50 */; p80: number|null };
  swipeCount: number;
  explorationBonus: number;                    // 0..0.3, init 0
}
interface PenaltyEntry { hue: HueBin; fabric: string; cut: string; remainingCards: number; strength: number }
type Action = 'love'|'pass'|'save'|'less';
type PassReason = 'fit'|'price'|'colour'|'style'|'unknown';
interface SwipeEvent { itemId: string; action: Action; at: number; sizeAtSwipe: string|null; fitScore: number|null; reasons?: PassReason[]; dealIndex: number }
interface TasteState { profile: TasteProfile; penalties: PenaltyEntry[]; events: SwipeEvent[] /* ring buffer, max 500 */; seen: Record<string, number> /* itemId → dealIndex */; dealIndex: number; outbox: SwipeEvent[] /* to sync */ }
interface ItemFeatures { axes: Record<Axis, number>; silhouette: Silhouette; hue: HueBin; fabric: string; cut: string; priceEur: number }
```

### `featurize(garment): ItemFeatures`
- `axes`: use merchant `styleTags` (0..1 per axis) when present; else sum the table below per axis and clamp to [0,1]:
  - patternBlock → wrap {bohemian .5, classic .3}; a-line {classic .4, bohemian .2}; sheath|column {classic .5, minimal .4}; bodycon {avantGarde .2, sporty .2}; bias {minimal .5, classic .2}; oversized|boxy {avantGarde .4, minimal .3}; straight {classic .4, minimal .3}; wide-leg {bohemian .3, avantGarde .2}; skinny {sporty .3}; shirt {classic .5, minimal .2}; t-shirt {sporty .4, minimal .3}; trapeze|tent {avantGarde .4, bohemian .2}; unknown {}
  - fabric.primary → linen {bohemian .4}; silk {minimal .3, classic .2}; denim {classic .2, sporty .3}; wool {classic .3}; cashmere {classic .3, minimal .2}; tencel|modal {minimal .3}; cotton {sporty .1, minimal .1}; jersey {sporty .4}; technical {sporty .6}; leather {avantGarde .3}
  - Examples: Linen Wrap Dress → {bohemian .9, classic .3, others 0}; Silk Slip (bias) → {minimal .8, classic .4}; Denim Straight Jeans → {classic .6, minimal .3, sporty .3}.
- `silhouette`: `easeTotal = ease.bust+ease.waist+ease.hip` (category defaults from the fit engine when absent): <6 fitted, 6–14 regular, 15–24 relaxed, >24 oversized. Wrap dress (18) → relaxed.
- `hue`: hex → HSL. l ≥ 0.90 → white; l < 0.12 → black; s < 0.15 → l < 0.5 ? neutral-dark : neutral-light; else by hue: red [345,15), orange [15,45), yellow [45,70), green [70,160), teal [160,200), blue [200,260), purple [260,300), pink [300,345). `#C97A4F` → orange; `#EAEAEA` → white; `#1E2B4D` → blue.
- `fabric = fabric.primary`, `cut = patternBlock`, `priceEur`.

### `styleMatch(axes, v) = Σ_a axes[a]·v[a] / Σ_a v[a]` (0..1; 0.5 = neutral; if Σv = 0 → 0.5).

### `applyOnboardingVibes(state, vibes: string[])`
Map 'Bohemian'→bohemian, 'Minimal'→minimal, 'Classic'→classic, 'Avant-Garde'→avantGarde, 'Sporty'→sporty: each selected axis = 0.75 (others stay 0.5). 'Eclectic' → every axis = max(axis, 0.6) and `explorationBonus = 0.2`. No centering here. Idempotent.

### `applySwipe(state, garment, fit: FitResult|null, action, now): { state, event }`
Learning rate `η` per action: love 0.12, save 0.18, pass 0.06, less 0.20; sign +1 for love/save, −1 for pass/less; warm-up multiplier ×1.5 while `swipeCount < 20`. `ηe = η·(warm-up)`.
1. `f = featurize(garment)`; `reasons` (pass only) = inferPassReasons (below).
2. Which dimensions update:
   - love/save/less: all dimensions.
   - pass: if `reasons ⊆ {fit, price}` → **no profile change** (the user did not reject the style); if includes `colour` → colour only; if includes `style` → axes, cut, silhouette; `unknown` → all at ηe/2.
3. Axes: `axes[a] += sign·ηe·v[a]` for each a with v[a] > 0; clamp [0,1]; then **centre**: subtract `(mean(axes) − 0.5)` from every axis and clamp again (keeps the radar relative).
4. Affinities (colour[f.hue], fabric[f.fabric], cut[f.cut], silhouette[f.silhouette]): `+= sign·2ηe`, clamp [−1,1].
5. Price: love/save push `priceEur` to `lovedPrices` (keep last 50), `p80` = nearest-rank 80th percentile when ≥5 entries.
6. `less` additionally updates penalty memory (below). `save` additionally appends `{type:'save', itemId, size}` to `outbox` and the caller adds the item to the wardrobe. **`love` does not add to the wardrobe** (§5).
7. `swipeCount += 1`, `seen[itemId] = dealIndex`, event `{itemId, action, at: now, sizeAtSwipe: fit?.recommendedSize ?? null, fitScore: fit?.score ?? null, reasons, dealIndex}` pushed to `events` (ring 500) and `outbox`.

### `inferPassReasons(profile, f, fit): PassReason[]` (evaluated at swipe time, in this order, may return several)
- `fit` if `fit && (fit.recommendedSize === null || fit.score < 0.5)`
- `price` if `p80 !== null && f.priceEur > 1.25·p80`
- `colour` if `swipeCount ≥ 10 && (colour[f.hue] ?? 0) ≤ −0.2`
- `style` if `swipeCount ≥ 10 && styleMatch(axes, f.axes) < 0.35`
- else `['unknown']`.

### Penalty memory (§5 'less like this')
- On `less`: key = (f.hue, f.fabric, f.cut). If an identical triple exists → `remainingCards = 50`, `strength = min(2, strength + 0.5)`; else push `{…, remainingCards: 50, strength: 1}`.
- On every **deal** (`dealNext`, i.e. each card shown): every entry `remainingCards -= 1`; entries at 0 are dropped. Swipes do not decrement; deals do (one deal per shown card, so in practice one per swipe).
- `penalty(f) = Σ entries`: all three match → `0.35·strength`; exactly two match → `0.12·strength`; otherwise 0.

### `rankDeck(catalog, state, fitFor: (g) => FitResult, n): { deck: Garment[], notInYourSize: number }`
1. Candidates: catalog items not in `seen` (an item passed ≥ 200 deals ago becomes eligible again; loved/saved/less items never return), and whose `fitFor(g).recommendedSize !== null` (unbuyable items are counted in `notInYourSize`, never shown).
2. `base = 0.40·styleMatch + 0.20·(colour[hue]+1)/2 + 0.10·(fabric+1)/2 + 0.10·(cut+1)/2 + 0.15·fit.score + 0.05·priceFit`, where `priceFit = p80 === null ? 0.5 : price ≤ p80 ? 1 : max(0, 1 − (price − p80)/p80)`.
3. `score = base − penalty(f) + explorationBonus·novelty`, novelty = 1 if the item's dominant axis (argmax v) is the axis with the fewest love/save events so far, else 0.
4. Sort by score desc, ties by catalog order (deterministic, no RNG).
5. Deal rules: every 5th deal (`dealIndex % 5 === 4`) takes the best item whose dominant axis ≠ the user's top axis (exploration); otherwise the top item. A diversity pass prevents two consecutive deals sharing the same (hue, category) by deferring the second by one position. Re-rank after every swipe (catalog ≤ a few thousand items; O(n log n) on-device).

### Style DNA display
TasteRadial axes = `profile.axes` in fixed order; archetype label = argmax axis mapped to copy (bohemian→'Free Spirit', minimal→'Modern Minimalist', classic→'Timeless Classic', avantGarde→'Avant-Garde', sporty→'Athleisure'), % = `round(axes[argmax]·100)`; subtitle = `Refined by ${swipeCount} swipes`. No fabricated numbers.

### Test vectors (vitest)
Fresh state `S0`: axes all 0.5, affinities empty, swipeCount 0, dealIndex 0.
1. **Onboarding** `['Bohemian','Avant-Garde']` → axes {bohemian .75, avantGarde .75, others .5}; `['Eclectic']` → all .6, explorationBonus .2; applying twice equals applying once.
2. **featurize(WRAP)** → axes {bohemian .9, classic .3, minimal 0, avantGarde 0, sporty 0}, hue 'orange', fabric 'linen', cut 'wrap', silhouette 'relaxed'. featurize(JEANS) → {classic .6, minimal .3, sporty .3}, hue 'blue'. Hex '#EAEAEA' → 'white'.
3. **love WRAP from S0** with fit {recommendedSize 'M', score 1} (ηe = 0.18): raw axes bohemian 0.662, classic 0.554 → centred: bohemian **0.6188**, classic **0.5108**, minimal/avantGarde/sporty **0.4568**; colour.orange 0.36, fabric.linen 0.36, cut.wrap 0.36, silhouette.relaxed 0.36; swipeCount 1; event `{action:'love', sizeAtSwipe:'M', fitScore:1}`; wardrobe/outbox unchanged except the event.
4. **save WRAP from S0** (ηe = 0.27): bohemian 0.6782, classic 0.5162, others 0.4352; colour.orange 0.54; outbox contains `{type:'save', itemId:'aalter-studio-1', size:'M'}`.
5. **pass with fit score 0.2** from S0 → reasons `['fit']`, profile deep-equals S0 except swipeCount 1 and seen; event logged with reasons.
6. **pass for colour**: state with swipeCount 12, colour.blue −0.3, pass JEANS (fit 1, no p80) → reasons `['colour']`; colour.blue → **−0.48** (−0.3 − 2·0.06·1.5); axes unchanged.
7. **less JEANS from S0** (ηe = 0.30): raw classic 0.32, minimal 0.41, sporty 0.41 → centred classic **0.392**, minimal **0.482**, sporty **0.482**, bohemian **0.572**, avantGarde **0.572**; colour.blue −0.6, fabric.denim −0.6, cut.straight −0.6; penalties `[{hue:'blue', fabric:'denim', cut:'straight', remainingCards:50, strength:1}]`.
8. **penalty lifecycle**: after 49 deals entry has remainingCards 1; after the 50th it is gone. A second `less` on a blue/denim/straight item at remainingCards 30 → remainingCards 50, strength 1.5. Two `less` more → strength capped at 2.
9. **penalty scoring** with the entry from test 7: blue/denim/straight item → 0.35; blue/denim/wide-leg → 0.12; orange/linen/wrap → 0; with strength 1.5 → 0.525 / 0.18.
10. **rankDeck on S0** with catalog [WRAP, SLIP, JEANS], all fit scores 1, no p80 → every base = 0.575 (0.2+0.1+0.05+0.05+0.15+0.025) → deck order equals catalog order; `notInYourSize 0`. Setting JEANS fit to `{recommendedSize:null}` → JEANS excluded, `notInYourSize 1`.
11. **rankDeck after test 7** with a 4th item JACKET (styleTags {classic .5, sporty .3}, '#1E2B4D' blue, denim, cut 'trucker', price 150, fit 1): JEANS excluded (seen); JACKET base = 0.4·0.4258 + 0.2·0.2 + 0.1·0.2 + 0.1·0.5 + 0.15 + 0.025 = **0.4553**, minus two-match penalty 0.12 → **0.3353**; WRAP = 0.4·0.527 + 0.1+0.05+0.05+0.15+0.025 = **0.5858**; order [WRAP, SLIP, JACKET] (±0.001).
12. **exploration**: with dealIndex 4 and top axis bohemian, the dealt card is the best item whose dominant axis ≠ bohemian even if a bohemian item scores higher.
13. **diversity**: two orange dresses ranked 1–2 and a blue top 3 → deal order dress, top, dress.
14. **re-surfacing**: an item passed at dealIndex 10 is excluded at dealIndex 150 and eligible at 210; a loved item is never re-dealt.
15. **persistence round-trip**: `JSON.parse(JSON.stringify(state))` deep-equals state (no Sets/Maps); `events` never exceeds 500.
16. **purity**: inputs frozen; `applySwipe` returns a new object and leaves the input unchanged; same inputs → identical output.

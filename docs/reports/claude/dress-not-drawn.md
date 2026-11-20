# One not-drawn rule for every garment

Branch `claude/dress-not-drawn`, from `claude/garment-engine`, 20 Nov 2026. Requested by the product owner: a dress too small for the shopper was still drawn as a stretched dress, because the not-drawn rule existed only for sewn tops (men's tee), tape-built trousers and the baked pull-on skirt.

Every garment below that has a 3D picture is a synthetic test garment or a shop garment's chart; every picture is an estimate and the embed labels it so ("Estimate · not measured").

## Verdict

**Done for every garment the 3D view shows, and for the 2D figure.** A size the fit engine says cannot be worn on the shopper's body is not draped and not drawn; the body is shown alone and one sentence says where and that the size advice decided. A size that is snug, roomy, loose, or tight with room left is drawn exactly as before.

Two things were not run here and are said plainly:

- **The azure dress, the photo skirt and the POM skirt bake were not opened in a browser.** Their bundles are git-ignored and need a GPU reconstruction or Blender drapes, which this session does not have. They are covered by unit tests on their real payloads and by the fact that the rule no longer looks at the bundle at all. The existing bake e2e (`garment3dBake.spec.ts`) had its expected wording updated but **was not run**.
- **Nothing was checked on a real phone.** Headless Chromium on SwiftShader.

## The rule

One reader, `wearBlock(result, size)`, in `@curtain/fit-engine` (`summary.ts`). It reads a `FitResult` and returns the point with the largest shortfall, or null:

| Blocked when | Point | Shortfall |
|---|---|---|
| The engine banded a girth point `tight` **and** the garment there is smaller than the body (negative slack) | bust/chest, waist, hips/seat, thigh | body minus garment |
| The engine's pull-on check is `blocked` | hips | how far the stretched band is short |

It decides nothing. `tight` already includes the product's stretch (the engine's tight limit), so "cannot give" is the engine's own judgement. It is a reader like `anchorGaps`: no existing result changes; every existing engine test passes unchanged, and 6 new ones cover the reader.

Not blocks, on purpose:

- **`tight` with room left.** One size down on the woven dress the engine says tight, but 2 cm of dress is left over the bust. It closes, so it is drawn. This matches the old tee rule (`open` meant negative slack).
- **Shoulders, neck, sleeve, lengths.** A garment narrow or short there is still on the body. This also matches the old rule.

Three places read it, so they cannot disagree:

| Where | File | What it does |
|---|---|---|
| 3D view, device drape | `packages/garment-viewer/src/notDrawn.ts`, `mount.ts` | The size is not draped; the garment is hidden; `data-garment="not-drawn"` |
| 3D view, server bake | same, `mountBaked` | Same rule (before: pull-on only). No AI-realism passes for a hidden size |
| Embed: sentence and 2D figure | `apps/web/src/embed/notDrawn.ts`, `Garment3D.tsx`, `ResultScreen.tsx`, `components/AvatarView.tsx` | One sentence under both pictures; the 2D figure draws the body alone; size rings stay |

The sentence (catalogue `view3d.notDrawn`, English only):

- "Size 12 is not drawn: the size advice says it does not close at the bust, where your body is 3.0 cm larger than the garment, more than its fabric gives, so the body is shown without it."
- "Size 8 is not drawn: the size advice says its waistband does not stretch over your hips, which are 4.0 cm larger than the band at full stretch, so the body is shown without it."

A men's garment reads "chest" and "seat".

## What changed for each garment

| Garment | Before | After | How it was checked |
|---|---|---|---|
| Tape-built dress (`DEMO_DRESS=1`) | Always drawn; AU 12 body in AU 8 showed the bust stretched | Two or more sizes down: not drawn, bust, 3 / 8 / 13 cm. One size down and own size: drawn | Unit; e2e in the built embed; real stack (`demo-dress.mjs --too-small`) |
| Azure dress (reconstructed, device drape) | Always drawn | Same numbers as the tape dress (same chart shape) | Unit on its real payload only. **Bundle not present** |
| Photo skirt (reconstructed, device drape) | Always drawn in 3D | Not drawn where the band does not pass the hips | Unit on its real payload; 2D in the built embed. **Bundle not present** |
| POM skirt bake | Not drawn on pull-on `blocked` only | Same sizes on the chart bodies tested; now also any `tight` girth | Unit. **Bake not present; its e2e not run** |
| Men's tee | Not drawn at the chest | Same sizes, same numbers (25 / 17 / 9 / 1 cm on the XXL body) | Existing tests unchanged; real stack |
| Men's chino | Not drawn at the waist | Same sizes, same numbers (33.7 and 13.1 cm on the XXL body) | Existing tests unchanged; real stack |

## Measured

**In the built embed** (`apps/web/e2e/dressNotDrawn.spec.ts`, 390 × 760 at 2×), the AU 16 chart body (bust 105, waist 87.5, hip 114) in the tape-built dress:

| Size | Engine | 3D canvas | Pixels in the dress's colour | Sentence |
|---|---|---|---|---|
| 16 | good, 7 cm room | drawn | 62,137 | none |
| 14 | tight, 2 cm room | drawn | 59,820 | none |
| 12 | tight, 3 cm short | not drawn | 0 | bust, 3.0 cm |
| 10 | tight, 8 cm short | not drawn | 0 | bust, 8.0 cm |
| 8 | tight, 13 cm short | not drawn | 0 | bust, 13.0 cm |

For each blocked size the 2D figure has no garment layer, carries the identical sentence, and keeps its size rings (the bust chip reads "Tight, 3 cm short"). The test compares against `wearBlock` run on the same body, not against copied numbers.

Same spec, pull-on skirt with the shop's tape, hip 98: AU 8 is not drawn on the 2D figure (waistband, 4.0 cm); AU 10 is drawn.

**In the real stack** (own api, web dev server, storefront):

- Dress, five AU bodies: every own size drawn; one size down drawn (AU 10, 12, 14, 16 bodies); two sizes down not drawn with the sentence, and the 2D figure agrees (AU 12, 14, 16 bodies).
- Tee, XXL body: S and XL not drawn (25.0 and 1.0 cm at the chest); all five bodies' own sizes drawn.
- Chino, XXL body: 44/32 drawn; 38/32 not drawn (13.1 cm at the waist).

**No change where a size fits.** The 2D golden snapshots (`femaleFigureGolden`, `maleFigureGolden`) changed only for sizes with a block: 4 female entries and 77 male entries (the male ones are mostly chino waists too small for the body). Every other entry is byte for byte the same. All existing tee and chino viewer tests pass without edits.

## Assumed

- **`tight` with room left is wearable enough to draw.** The engine does not call such a size wearable either; the picture draws it because the cloth physically closes. If the product owner wants "not wearable" to mean "not drawn", it is a one-line change in `wearBlock`, and it would hide one more size down on every woven garment.
- **Shoulders and neck never block.** A men's shirt with a neck too small is still drawn.
- **The elastic waist of a pull-on bottom** now blocks in 3D when the engine bands it `tight` (body beyond the stretched band). On the pilot skirt's chart bodies the pull-on check always fires first, so no case of this was seen.

## The pictures (`docs/screens/claude/dress-not-drawn/`, 11 files, 2.6 MB)

- `dress-3d-body-AU16--size-{16,14}-drawn.png`, `dress-3d-body-AU16--size-12-not-drawn.png`: the 3D view (built embed).
- `dress-2d-body-AU16--size-16-drawn.png`, `dress-2d-body-AU16--size-12-not-drawn.png`: the 2D figure.
- `skirt-2d-hip-98--size-8-not-drawn.png`: the pull-on skirt's 2D figure.
- `dress-real-stack-body-AU16--size-12-not-drawn.png`, `tee-real-stack-body-XXL--size-{S-not-drawn,XXL-drawn}.png`, `chino-real-stack-body-XXL--size-{38x32-not-drawn,44x32-drawn}.png`: the real stack.

Honest notes on them:

- The tee's not-drawn picture shows the body **from the back** (the demo script had turned the view before picking S).
- In the chino's not-drawn picture and the real-stack dress picture the sentence is below the fold or partly under the "Choose size" bar. The script's log has the text.
- The drawn dress at AU 14 and 16 shows a faint body shadow through the skirt at the belly. That is the drape, not this change.
- A body shown alone is a plain grey mannequin. Nothing on screen but the sentence tells the shopper a garment is missing on purpose.

## The underbust seam is not a fit point: what adding it would need

Not done; the engine's results are untouched. Today the dress's advice reads the bust alone, so a seam shorter than the underbust it must close round is not checked, and this rule cannot block on it.

1. **A body number.** Fit points and body measurements are one list (`FIT_POINTS` in `packages/schema/src/garment.ts`; `BODY_MEASUREMENT_KEYS` is built from it). The shopper has no underbust today. Either ask for it (a new field in About you, units, storage, the prior from height and weight) or derive it. The capture code and the mannequin already carry an underbust ring, so a derived value from bust and waist is possible but would be an estimate that must be labelled.
2. **A garment number.** A chart column or, better, a tape field: the seam relaxed and, when it is elastic or shirred, stretched (the dress report's point B). That changes `GARMENT_TAPE_FIELDS`, `checkGarmentTapeInput`, both merchant admins and the PHP mirrors of the chart columns.
3. **Engine rules.** An ease target and tight limit for the point, which blocks and categories use it (`CATEGORY_POINTS`, the pattern-block skips), whether it is critical, and for a pull-on dress a second pull-on check at the seam (over the bust or the shoulders, not the hips). New test vectors; every existing vector must stay green.
4. **Then this rule needs one word.** Add `underbust` to `WEAR_POINTS` and its anchor to `FIT_POINT_ANCHORS` (D15 already has the `underbust` ring). The pictures follow with no other change.

Size: large, and a product decision first (ask the shopper, or estimate).

## Review

Not independently reviewed. No second reader or agent looked at this diff.

## Open issues

1. The azure dress, photo skirt and POM bake were not seen in a browser with this rule (bundles absent). `garment3dBake.spec.ts` needs one run where the bake exists.
2. `tight` with room left is drawn (see Assumed): a product decision.
3. The underbust is still not a fit point (above).
4. The 3D ring chips under a men's garment read "Bust" (seen on the tee picture). Older than this branch; the sentence itself reads "chest".
5. A body shown alone gives no visual cue beyond the sentence; on a phone the sentence can sit under the sticky "Choose size" bar until scrolled.
6. The peek thumbnail and the app's own figure use the same 2D component, so they also show the body alone for a blocked size, with only an accessible name to say why. Not looked at in a browser.
7. `trouserNotDrawn` (`trouser.ts`) is no longer called by the view; left in place because the chino session owns that file.

## Reproduce

```sh
pnpm install --frozen-lockfile
npm_config_workspace_concurrency=1 pnpm build:packages
# unit tests
pnpm --filter @curtain/fit-engine exec vitest run src/summary.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/notDrawn.test.ts src/male.test.ts src/maleChino.test.ts src/maleV2Tee.test.ts
pnpm --filter @curtain/web exec vitest run src/embed/__tests__/notDrawn.test.tsx src/embed/__tests__/garment3d.test.tsx src/__tests__
# e2e in the built embed (builds the dress bundle when absent)
cd apps/web && node scripts/gen-icons.mjs && pnpm exec vite build
NOT_DRAWN_SHOTS=/tmp/not-drawn pnpm exec playwright test -c e2e/playwright.config.ts e2e/dressNotDrawn.spec.ts --trace off
cd ../..
# real stack
pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts
pnpm --filter @curtain/garment-spike build:bundle
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts
node scripts/demo-dress.mjs /tmp/demo-dress --too-small
node scripts/demo-men.mjs /tmp/demo-men --all-sizes --off-size
node scripts/demo-men-chino.mjs /tmp/demo-chino --bodies=XXL
npm_config_workspace_concurrency=1 pnpm check
```

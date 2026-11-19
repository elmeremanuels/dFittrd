# Men M3: the two-day tee proof (POM builder to device bundle)

Branch `claude/men-m3-tee`, from `claude/garment-engine`, 19 Nov 2026. Slice M3 of `docs/research/men-3d-plan.md`, tee only. Every garment below is the **SYNTHETIC men's test tee** (`SYNTHETIC_MENS_TEE`, "not a product"); its flat measurements are invented (`spikes/garment-engine/src/pomTeeSynthetic.ts`). Every picture is an estimate; the embed labels it so.

## Verdict

**The route works for a tee, and is not ready for a real shop's tee yet.** From flat measurements alone it builds a garment that looks like a tee, reproduces every input within 0.5 cm, packs into a 169 KB bundle the existing viewer and import gate take unchanged, and drapes on the male S to XXL with no body through the cloth (the M1 tee showed up to 3,663 body pixels). What stops a real product today:

1. **Nothing was measured on a real tee.** The measurements, the seven assumptions the builder needs (armhole depth, neck width and drops, eases) and the across-shoulder definition are invented. The first real step is one real tee taped flat, built, and compared with its photos.
2. **The drape loses chest girth**: 1.4 to 4.5 cm under the tape at the chest line after the drape on the body of the same size (the M1 tee lost 0 to 3 cm). The fit advice does not use the drape (rule 4), but the picture shows a tee a little closer than it is.
3. **The shoulder line is strained on large bodies**: the pinned cloth over the shoulders stretches 26 % (XL) and 37 % (XXL) at worst in its own size, and 84 to 115 % when an XXL body wears a smaller size. No holes, but stretched triangles.
4. **Small peaks at the shoulder points** in the embed (front views): the cap's top meets the shoulder in a corner. Cosmetic.
5. **Plain colour only**: no UVs, no print, no photo projection (M3's "with photo projection" is not done).

The plan's stop rule ("tee proof fails after 2 days → GPU pipeline") does not trigger: the proof passes its own gate (tape within 0.5 cm, `checkGarmentBundle` passes) and fixes the show-through it was asked to fix. Items 1 to 3 are the next work before a real tee.

## What was built

| Piece | Where | What |
|---|---|---|
| POM tee builder | `spikes/garment-engine/src/pomTee.ts` | Flat measurements → one welded mesh on the canonical body. Below the armhole: rows of the body's convex cross-section (torso, both legs below the crotch) offset to the tape's girth (chest from the chest line up, waist at the waist ring when given, hem at the hem, straight lines between). Above it: rays from inside the chest to where the distance to the body (torso plus the arm's cap on the torso side of the armhole) reaches the ease, so the cloth goes over the top of the shoulder. Armhole: an ellipse in the plane through the armpit (body armpit − 2 cm) and the shoulder point (±shoulder/2, on top of the shoulder), wide enough to hold the arm's section with 1.1 cm to spare. Sleeve: lofted from the armhole's own vertices (sewn) to a hem at right angles to the arm, kept ≥1.1 cm off the arm and its cone above the joint (the cap follows the arm). Lengths are solved: hem height for the front length from the HPS, sleeve end for the length along the sleeve top. Per-column row counts with zipper triangulation above the armhole (no sliver rows at the centre front). |
| Its tape | same file, `measurePomTee` | Every input measured on the mesh: chest = tape round the torso at the chest line / 2, waist likewise at the waist ring, hem = hem edge girth / 2, shoulder = straight distance between the two shoulder-point vertices, length = path down the front at the HPS's x, sleeve length = path along the sleeve's top line, opening = sleeve hem girth / 2. |
| Device bundle | `spikes/garment-engine/src/pomBundle.ts` | The five files of `bundle.ts`. Grading targets from the tape (torso rings by the POM girth profile, shoulder ring by the shoulder ratio, upper arm by the opening ratio, both lengths solved against the device's own morph). `qa.json`: `chartAgreement.kind: 'tape-built'` (the import flags `tape_built_no_chart_check`), `pomTape` (tape vs every input, every size, on its own table body), `gradingCheck` (device grading vs the tape), the assumptions. |
| Wiring | `src/bundle.ts`, `scripts/build-bundle.ts` | `buildBundle('synthetic-men-tee')` now runs the POM builder; `generator: 'm1'` keeps the M1 lofted garment for comparison. The demo seed expects the flag (`apps/api/src/demo.ts`). |
| Sewn collider | `packages/garment-viewer/src/collide.ts`, `engine.ts`, `drapeJob.ts` | A session is `sewn` when the bundle is one piece with sleeve chains (only the POM tee today; every other bundle drapes exactly as before, all existing viewer tests unchanged). Then torso cloth also meets the **drawn** arm and its cone above the shoulder joint (with 0.5 cm extra clearance, alternating with the torso push so the cloth ends outside both), sleeve cloth meets the torso and its arm from the cap down, torso contacts push along the slanted surface, and the legs keep a rounded top above their last section (the leg's top ring stands 1.4 cm out of the XXL hips). |
| Merchant note | `packages/schema/src/garmentAsset.ts` | The `tape_built_no_chart_check` sentence no longer says "draped on a server" for every tape-built garment. |
| Pictures and pixel metric | `spikes/garment-engine/src/pokeThrough.ts`, `packages/garment-viewer/src/pomTeeShots.test.ts` (opt-in) | A software renderer and a count of pixels where the drawn body is in front of the cloth by less than 2 cm (skin through cloth, not an arm in front of it), four views at 3 px/cm. |
| Embed run | `scripts/demo-men.mjs` | Five male table bodies S…XXL; after the view settles, the tee in the body's own size, turned front, side and back by dragging the 3D view. |

Not touched: `packages/fit-engine`, `packages/schema/src/garment.ts`, the About-you form, `.github/`. One comment in `packages/schema/src/fixtures/mens.ts` (the tee's bundle is now POM-built).

## The SYNTHETIC measurements (invented, not a product)

Half girths laid flat, cm. Chest, waist and hem are half the fixture chart's `bust`, `waist`, `hip`; shoulder is its shoulder column; length and sleeve step from the fixture's 70 / 22 at M; the opening is made up.

| Size | Chest | Waist | Hem | Shoulder | Length | Sleeve | Opening |
|---|---|---|---|---|---|---|---|
| S | 49 | 43 | 48.25 | 43.5 | 68 | 21 | 17 |
| M | 53 | 47 | 51 | 44 | 70 | 22 | 18 |
| L | 57 | 51 | 54 | 45 | 72 | 23 | 19 |
| XL | 61 | 55 | 57 | 46 | 74 | 23.5 | 20 |
| XXL | 65.5 | 59.5 | 60.25 | 47 | 76 | 24 | 21 |

Assumed by the builder [A] (`POM_TEE_ASSUMPTIONS`): armhole 2 cm under the body's armpit; chest line 2.5 cm under the armhole; neck width 17.5 cm at M (+0.5 per size); front neck drop 9 cm (+0.25), back 2 cm; 0.9 cm ease on the shoulders, ≥1.1 cm off the arm in the cap, 0.35 at the sleeve hem; at least 0.5 cm off the body anywhere (tighter asks are recorded, see below). **Shoulder is the straight line** between the two shoulder points (as the mannequin's own shoulder width); a flat-laid "across shoulder" is measured over the back and is longer on a body. How much longer is not measured.

## Measured versus assumed

All numbers from runs on this branch; `docs/reports/claude/men-m3-tee-metrics.json` holds the drape numbers.

**1. The builder's tape on its own inputs** (`qa.json` `pomTape`; each size built on the male table body of its label). Built minus asked, cm:

| Size | Chest | Waist | Hem | Shoulder | Length | Sleeve | Opening |
|---|---|---|---|---|---|---|---|
| S | −0.07 | −0.11 | −0.03 | 0 | 0 | 0 | 0 |
| M | −0.07 | −0.11 | −0.04 | 0 | 0 | 0 | 0 |
| L | −0.08 | −0.10 | −0.04 | 0 | +0.01 | 0 | 0 |
| XL | −0.09 | −0.11 | +0.02 | 0 | +0.01 | 0 | 0 |
| XXL | −0.09 | −0.12 | **+0.49** | 0 | +0.01 | 0 | 0 |

The M3 gate (0.5 cm) passes, XXL's hem only just: its asked hem (120.5) is tighter than the XXL table body's hips plus the 0.5 cm minimum ease, so the builder makes it bigger and records it (`tighterThanBody`; on every size near the hips, 0.1 to 3.7 cm). That is a property of the invented chart against these bodies, not a builder error, and it is flagged rather than hidden. Shoulder, lengths and opening are exact because the builder solves for them; chest and waist are a few mm under because the tape is a polygon. On the base body only the M size is built; an S tee cannot be built smaller than the M body, which is why every size is built on its own body for this check.

**2. The device's grading of the base mesh** (what the phone actually draws before the drape, `qa.json` `gradingCheck`), graded minus asked: chest −0.11 to +0.06, waist −0.09 to −0.13, hem −0.04 to +0.46 (XXL), shoulder, length, sleeve and opening 0 to 0.01 cm. A first version graded the sleeve by its upper-arm girth measured on bigger sizes built on the M body and missed the opening by up to 8.8 cm; the shoulder ring was missing from the targets and the shoulder came out 2 to 7 cm wide. Both fixed before these numbers.

**3. Body showing through after the drape**, each body in its own size, viewer's drape (`prepareFit` + `relax`, the mount's own steps):

| Body / size | Shoulder share | Armpit share | Hem share | Pixels, 4 views | M1 tee shoulder / armpit / hem | M1 pixels |
|---|---|---|---|---|---|---|
| S | 0 % | 0 % | 0 % | 0 | 4.5 / 1.7 / 0 % | 56 |
| M | 0 % | 0 % | 0 % | 0 | 1.7 / 3.5 / 0 % | 59 |
| L | 0 % | 3.0 % | 0 % | 0 | 2.7 / 3.6 / 0 % | 197 |
| XL | 0 % | 0.2 % | 0 % | 0 | 8.3 / 3.7 / 0 % | 2,071 |
| XXL | 0 % | 1.0 % | 0 % | 1 | 20.9 / 4.6 / 1.5 % | 3,663 |

Shares: of the body's vertices within 3 cm of the cloth, the share more than 0.3 cm outside it (M1's own proxy, kept unchanged). Pixels: the new pixel metric. The armpit share is under the arm; no view sees it (0 pixels). The fixes, in the order the measurements asked for them: the welded shoulder seam and cap (shoulder 20.9 → 14.4 % on its own, because the pinned cap still never met the drawn arm), then the sewn collider (shoulder 0 %), the legs' rounded top (hem holes at L to XXL gone), extra cap clearance (the last XL and XXL specks over the shoulder joint's cone).

Off size (all POM): on the M body every size shows 0 to 5 pixels. On the XXL body the smaller sizes are tight and it shows: S 91 pixels (mostly torso at mid height), M 5, L 3, XL 6, with the edge strain at p99 40 % (S), 30 % (M), 22 % (L), 18 % (XL). That is the picture of a tee that is too small; the fit engine's advice for that body was XXL.

**4. Chest girth after the drape** at the POM chest line (torso loop only), cm. Placed is the graded tee on the body before the drape:

| Size | Tape | Placed | Draped | Draped − tape | M1 draped |
|---|---|---|---|---|---|
| S | 98 | 97.7 | 96.3 | −1.7 | 98.2 |
| M | 106 | 105.8 | 103.6 | −2.4 | 104.8 |
| L | 114 | 113.9 | 111.1 | −2.9 | 111.9 |
| XL | 122 | 122.0 | 117.5 | −4.5 | 119.4 |
| XXL | 131 | 131.1 | 126.7 | −4.3 | 128.0 |

The loss is the drape folding cloth in under the arm (8 cm lower, at y 120, it is 0.6 to 2.9 cm). It is not the cling: with the cling off the same within 0.4 cm. On a body smaller than the size the loss is larger (M body in XL: 114.3, −7.7); on a body larger the placement stretches the tee to the body first (XXL body in S: placed 119.5, draped 124.8), as for every bundle. Not fixed.

**5. Strain** (edge strain p99 / largest at the shoulder line): S 11.5 / 0 %, M 12.3 / 0 %, L 12.8 / 6.8 %, XL 14.3 / 26 %, XXL 14.9 / 37 %. The M1 tee: 10.5 to 12.6 / 0 to 13 %. Before the per-column rows the shoulder line hit 65 % at XXL (sliver rows at the centre front); the extra cap clearance costs about 10 points at XL and XXL.

**6. Bundle size and time.** Five files 169,089 bytes: base.glb 140,832 (77,184 gzip), anchors.json 17,675, qa.json 5,805, grading.json 4,017, material.json 760. 7,618 triangles, 3,909 vertices, one piece, 0 non-manifold, 0 inconsistent edges, 4 openings. M1's base.glb was 151,820 (112,180 gzip). Building the bundle takes 10.5 s on this container (1.8 s per tee mesh; 6 meshes for the tape check). The drape per size takes 0.5 to 0.8 s in node (not a phone).

## The pictures (`docs/screens/claude/men-m3-tee/`)

Embed (real stack, `scripts/demo-men.mjs`, gate on, 390 × 760 at 2×, SwiftShader):
- `embed-tee-body-{S,M,L,XL,XXL}--5-3d-size-*--{front,side,back}.png` and the sheet `embed-sheet-all-sizes-front-side-back.png`: each male table body in its own size (the fit engine recommended exactly that size for all five). Every frame has the "Estimate · not measured" badge and "3D estimate on a model with your measurements, not a photo". It reads as a plain blue crew-neck tee with set-in short sleeves: the neckline sits on the neck base, the sleeves end above the elbow and follow the arm's angle, the hem falls at the top of the thighs. No skin shows through anywhere I can see, front, side or back, at any size. What looks wrong: the **shoulder points stand up as small squared peaks** in every front and back view (most visible at XL and XXL); the sleeves flare a little at the hem; the sizes are told apart mostly by the body under them, the tee's own growth (8 cm of chest per size) is visible but not striking; the side views show the sleeve hanging straight with the A-pose arm and a slightly stiff, tube-like body below the chest.
- `embed-XXL-close-front-side.png`: the XXL shoulders up close: the cap covers the arm, the peaks at the shoulder points are the clearest defect.
- `embed-tee--0-storefront-page.png`, `embed-tee--1-about-you.png`, `embed-tee-body-XXL--2-pending.png`, `embed-tee-body-XXL--3-settled-size-XXL.png`: the flow (requires3d: the result appears only once the view settles). `embed-shirt-no-bundle--coming-soon.png`: the men's shirt without a bundle still says "coming soon".

Software renders (not WebGL; same drape, the spike's renderer):
- `software-XXL-m1-top-vs-pom-bottom.png`: before (M1, top row) and after (POM, bottom row), XXL, front, side, back. The M1 tee is bare at both shoulders front and back, with a hole through the cap in the side view and a row of holes above the hem; the POM tee has none.
- `software-m1-all-sizes.png`, `software-pom-all-sizes.png`: all five sizes, front / side / back.

## Open issues

- Real-tee calibration: measure one real tee flat (the seven inputs plus armhole depth and neck), build it, compare against its photos; decide the across-shoulder convention.
- Chest girth lost in the drape (1.4 to 4.5 cm): likely the sewn armhole pulling the side in; try a loop at the chest line (`anchorLoops` exists, off by default) or a lower-weight underarm.
- Shoulder-line strain at XL/XXL and on larger bodies: the yoke is pinned where grading put it; the shoulder seam does not follow the drawn shoulder joint (an attempt to move sleeve and cap with the joint sheared the armhole and was reverted).
- Shoulder-point peaks: round the corner where the armhole plane meets the shoulder lid.
- Photo projection and texture (M3 scope), trousers (M3 scope), a real phone's frame rate.
- `qa.json` `meshHealth.triangleBudget` says [8000, 15000]; the tee has 7,618 (under the lower bound, which nothing checks).
- The tape check builds each size on the male table body of the same label; a shop size that is not a table label is checked on the base body only.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
# the bundle (out/synthetic-men-tee/; also prints the tape check)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-bundle.ts --only synthetic-men-tee --skip-separation
# tests: builder, tape gate, bundle gate; drape and show-through on S…XXL; sewn collider
pnpm --filter @curtain/garment-spike exec vitest run src/pomTee.test.ts src/bundle.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/male.test.ts src/collideSewn.test.ts
# software renders and metrics.json (opt-in)
POM_SHOTS=/tmp/pom pnpm --filter @curtain/garment-viewer exec vitest run src/pomTeeShots.test.ts
# the real stack in Chromium, gate on: screenshots in the folder given
node scripts/demo-men.mjs /tmp/demo-men
npm_config_workspace_concurrency=1 pnpm check
```

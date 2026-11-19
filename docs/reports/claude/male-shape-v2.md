# Male shape v2 (branch `claude/male-shape-v2`)

19 Nov 2026. Pictures: `docs/screens/claude/male-shape-v2/` (`mannequin/` from the package's own rasteriser, `viewer/` from the shipped viewer with the synthetic men's tee).

## What was built

- **`buildMannequin(shape, { maleShape: 'v2' })`** in `packages/mannequin` (`src/maleV2.ts`). The default is unchanged: without the option (or with `'v1'`) the male body is byte for byte the v1 body. A female shape ignores the option and is byte for byte the same with it, with each of the three heads (sha256 in `maleV2.test.ts`; also checked against the base commit before any change, all 8 shapes × 3 heads plus a typed body).
- **Non-elliptical sections.** `Section.outline` (optional, absent on every v1 and female section) lets a section be any loop; `loftSections` uses it when present.
  - Chest, waist and seat are superellipses fitted to ANSUR II male breadth, depth and girth (`MALE_SECTION_REFERENCE`, same least-squares lines on chest girth and same file and sha256 as the male table; `scripts/derive-male-table.ts` now prints it too). Waist exponent 2.67–2.75 and seat 3.26–3.60, from the data alone.
  - The chest cannot be fitted that way. ANSUR's chest breadth × depth (27.7 × 23.2 cm at M) cannot reach its chest girth (98 cm) with any convex shape short of a rectangle (the tape goes over the lats and shoulder blades; the calliper does not). So the depth is kept, the exponent is capped at 3.4 (assumed) and the breadth grows until the perimeter is the girth.
- **Chest and back:** pectoral bulges with a shallow sternal groove, shoulder blades and a spine groove, a belly that follows ANSUR's waist depth/breadth, and a seat with two gluteal bulges and a cleft.
- **V taper:** the lats widen the torso up to the armpit. Above the shoulder ring a straight trapezius slope runs to the neck, and the front meets the neck lower than the back (a slanted neck base).
- **Deltoids:** the arm root is a dome that rounds off under the shoulder line instead of the v1 cone, which stood above it as a wedge. It bulges outwards, forwards and backwards.
- **Seat and joined crotch:**
  - The legs move in under the seat, touch in the middle and carry the lower buttock down to the gluteal fold.
  - From the seat ring down, the torso outline turns into the two thigh outlines side by side, so torso and thighs meet flush.
  - The torso ends inside the thighs at the gluteal fold. There is no flat ledge.
- **Girths:** every section is scaled so that the loop on the mesh at every anchor ring is the table girth. Ring ids, heights, girths and `rings[].a/b` are the v1 ones, as are lengths, arm frames and morph heights. What changes: `landmarks.legX`, the leg rings' x and the hip/knee pivots. `torsoAt`/`legAt`/`armAt` return an ellipse that contains the v2 outline, for collision.
- **Viewer:**
  - `MountOptions.maleShape` (default v1; read only for a male body) is passed to `planAvatar` and `buildTypedAvatar`. The spike page takes `avatar.html?maleShape=v2`, and `men-renders.mjs` takes `--male-shape=v2`.
  - One change in the drape set-up: `openSession` decides which cloth particles skip collision (those already inside the body at rest) on the v1 twin of a v2 body, because every bundle is draped on the v1 body. Without this, the tee's rest shape sat inside the v2 seat. 1022 of 4224 particles were exempt instead of 138, and the seat showed through the hem in every size (hem share 14–17 %). The v1 path is unchanged.
- Scripts: `scripts/render-male-v2.ts` (software panels, four views) and `scripts/compose-male-v2.mjs` (phone-size pages, Playwright).

## Measured vs assumed

**Measured** in this container (unit tests, the package's mesh):

- **All 12 ring girths** on the v2 mesh are within 0.5 % of the table in S, M, L, XL and XXL. This holds for the ring's own part and for the whole mesh. It also holds for typed bodies: chest 84 to 135, height 160 to 188, a shoulder width of 46. All tests are in `maleV2.test.ts`; the existing 111 mannequin tests are unchanged and green.
- **Closed parts:** every v2 mesh has five closed, consistently oriented, positive-volume parts (six with either head). About 25k triangles against 15k.
- **Breadth × depth of the torso loop, cm (v1 → v2), and over the deltoids / seat breadth:**

  | Size | Chest | Waist | Seat | Under the armpit | Deltoids / seat |
  |---|---|---|---|---|---|
  | S | 31.9 × 25.2 → 31.6 × 21.0 | 29.3 × 19.9 → 27.8 × 18.9 | 34.4 × 22.7 → 30.7 × 20.7 | 32.8 → 33.3 | 1.34 → 1.50 |
  | M | 33.9 × 28.4 → 34.2 × 23.2 | 31.8 × 22.6 → 30.4 × 21.5 | 35.9 × 24.8 → 32.1 × 22.6 | 34.6 → 35.9 | 1.35 → 1.51 |
  | L | 35.9 × 31.6 → 36.7 × 25.4 | 34.4 × 25.1 → 32.9 × 23.9 | 37.7 × 26.8 → 33.8 × 24.6 | 36.5 → 38.5 | 1.35 → 1.51 |
  | XL | 38.0 × 34.6 → 39.2 × 27.6 | 36.9 × 27.7 → 35.4 × 26.4 | 39.5 × 28.9 → 35.5 × 26.6 | 38.6 → 41.2 | 1.35 → 1.51 |
  | XXL | 40.2 × 38.2 → 42.0 × 30.1 | 40.0 × 30.4 → 38.3 × 29.3 | 41.3 × 31.4 → 37.2 × 28.8 | 40.7 → 44.2 | 1.37 → 1.52 |

  - The chest depth is now ANSUR's: 23.2 at M against 28.4, and 30.1 at XXL against 38.2. The XXL barrel is gone; from the side XXL reads as chest plus belly.
  - The waist and seat breadths are ANSUR's scaled to the table girth (within 1.5 cm, tested). The seat lies behind: back depth exceeds front depth by more than 2 cm (tested).
  - Shoulder ring against seat is no longer near-equal. The breadth over the deltoids against the seat breadth goes from 1.35 to 1.51 at M.
- **Breadth over the deltoids:** 0.08–0.11 cm above ANSUR's bideltoid breadth (v1: exact by construction), from the deltoid bulge at the arm root.
- **Arms vs torso:** the arms stay outside the torso at the chest, underbust and waist rings in every size. The gap at the chest ring shrinks, because the fitted chest is a little broader than v1 from L up: 2.87 cm at M (v1 2.99), and 0.39 cm at XXL (v1 1.25).
- **No ledge:** from the thigh ring to the seat ring, the front-view breadth changes by less than 0.8 cm per 0.5 cm of height, in every size (tested). v1 jumps by the whole width of the torso's flat underside.
- **Tee on the v2 body (viewer drape, `male.test.ts`)**, each body in its own size:
  - Settled and finite in S…XXL. No particle inside the collision field.
  - The draped tee's chest girth stays within 1.5 cm of the chart (98.7 / 106.1 / 114.8 / 122.6 / 131.3).
  - Share of the covered body vertices showing through, v1 → v2:

  | Size | cap | mid | hem |
  |---|---|---|---|
  | S | 4.5 → 3.8 % | 1.7 → 1.6 % | 0 → 0 |
  | M | 1.7 → 3.6 % | 3.5 → 1.1 % | 0 → 0 |
  | L | 2.7 → 4.2 % | 3.6 → 3.0 % | 0 → 0 |
  | XL | 8.3 → 8.2 % | 3.7 → 4.1 % | 0 → 0 |
  | XXL | 20.9 → 9.8 % | 4.6 → 4.3 % | 1.5 → 0 |

  Bounds on the v2 values are in the test, so they cannot get worse unnoticed.
- **Tee vs 2D figure:**
  - The male 2D figure (`apps/web/src/render/maleBody.ts`) mirrors `MALE_REFERENCE` / `MALE_LEVELS`. Neither changed, and its value-by-value test (`maleFigure.test.tsx`, 15 tests) passes.
  - With the default (v1) body nothing about the line-up changed.
  - With v2, the 3D chest and waist widths still agree with the 2D figure's within 1.6 cm at M (2D 33.9 / 32.0 from the M1b report, 3D v2 34.2 / 30.4).
  - The **seat does not**: 2D 36.2 cm, 3D v2 32.1 cm at M; 41.4 vs 37.2 at XXL. The 2D figure still draws v1's seat. That mismatch is the price of turning v2 on, and why it stays off for now (open issue below).

**Assumed (not measured):** every relief size in `MALE_V2_ASSUMPTIONS`:

- pectoral 8.5 % of the chest depth, shoulder blades 5 %, spine groove 0.6 cm, gluteal bulge 7 % of the seat depth, cleft 0.9 cm;
- front shares of the chest (0.53) and seat (0.42) depth;
- lats +8 % at the armpit;
- shoulder-ring exponent 2.6, deltoid 0.32 of the upper-arm half-width;
- the chest exponent cap of 3.4;
- the thigh-top size (0.97 × thigh half-width, 1.05 × depth) and the gluteal fold at 35 % of the way from the thigh ring to the crotch.

The EN/ANSUR equivalence assumptions of the male table are inherited. ANSUR II is a young, fit, U.S. military sample.

## How it looks (honestly)

`mannequin/` pictures are flat-shaded by the package's own rasteriser (every facet shows); the `viewer/` pictures are the shipped viewer's smooth shading.

- **Reads as a man much more than v1.**
  - Front: shoulders slope down from the neck into rounded deltoid caps, with no wedge.
  - The torso narrows from the armpit to a waist and a narrower seat, a visible V.
  - Side: flat chest, shoulder blades and a seat behind, a slanted neck base, no barrel at XL/XXL.
  - Back: a spine groove and two buttocks.
  - Large sizes carry the extra girth as chest and belly in front, not as a cylinder.
- **Still a mannequin:**
  - The pecs are soft bumps.
  - The deltoid is a smooth swelling, not a muscle with a front and rear head.
  - Arms and legs below the thigh ring are still ellipse tubes.
  - The hands are mittens, and the head is the shared head (not touched).
- **Crotch:** joined, with no ledge in any view. Two blemishes remain:
  - a thin horizontal line round the top of the thighs at the gluteal fold, where the torso ends inside the legs;
  - a small step at the front of the hip crease in the side view.
  - In the flat-shaded pictures the crotch area also shows faceting noise where the torso outline follows the two thigh outlines. Smooth shading in the viewer hides most of it.
- **Sternum:** at XXL in three-quarter view a faint vertical crease runs down the sternum.
- **Tee:**
  - Hangs on v2 without new holes at the hem, and with clearly smaller sleeve-cap holes at XXL.
  - Slightly more of the shoulder top shows at M and L, because the v2 shoulder slopes up to the neck where the tee's straight-across top edge was cut for v1.
  - It is still the off-shoulder synthetic tube of M1, not a tee.

## Pictures

All at phone size, 2× device scale.

- `mannequin/`, from the package's software rasteriser (flat-shaded, 390 × 844 CSS px):
  - `10-…13-<size>-<view>-v1-vs-v2.png`: the whole body, v1 left and v2 right, for S…XXL in front, side, back and three-quarter views.
  - `14-…17-torso-<view>-S-to-XXL.png`: torso close-ups of every size.
  - `18-M-shoulders-close-up.png` and `19-M-seat-and-crotch-close-up.png`.
- `viewer/`, from the shipped viewer (`avatar.html`, headless Chromium with SwiftShader, a software renderer, not a phone; 390 × 760 CSS px):
  - `body-<size>--<view>.png` (v1) and `v2-body-<size>--<view>.png`: the body alone.
  - `tee-<size>--<view>.png` and `v2-tee-<size>--<view>.png`: wearing the synthetic men's tee in the body's own size. Views are front, side, back and three-quarter.
  - `pair-….png`: v1 | v2 side by side, at half size.
  - `renders-v1.json` / `renders-v2.json`: the state and estimate tag of every picture. No problems were logged.

## Open issues

- **v2 is off by default.** Before turning it on, two things must move with it:
  - the 2D figure's seat (and its golden);
  - every male bundle, re-draped on the v2 body. Today's bundles are draped on v1; the viewer only borrows the v1 twin for the collision exemption.
- The garment pipeline (`spikes/garment-engine`, `mannequinFor`) and `build:assets` still build the v1 male body. That is deliberate: no bundle, job id or golden changed.
- `shapeForBody`'s arm-clearance rule still runs on v1 geometry. The v2 chest is a little broader from L up, so for a typed very large chest with narrow shoulders the arm could touch the chest at the chest ring. All tested typed bodies keep the gap.
- `torsoAt`/`legAt`/`armAt` on a v2 body return an envelope ellipse, not the section's girth ellipse. The cloth therefore stands a little off the flat sides of the torso.
- The deltoid adds 0.1 cm over ANSUR's bideltoid breadth.
- The relief sizes are assumed; none is measured on people.
- Head files were not touched (another session). `packages/fit-engine` was not touched.

## Commands

```sh
git checkout claude/male-shape-v2
pnpm install --frozen-lockfile
pnpm build:packages
pnpm --filter @curtain/mannequin test                                   # 162 tests, incl. maleV2.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/male.test.ts   # tee on v1 and v2 bodies
pnpm --filter @curtain/web exec vitest run src/__tests__/maleFigure.test.tsx
# ANSUR tables (needs ANSUR_II_MALE_Public.csv from https://www.openlab.psu.edu/ansur2/, not committed):
pnpm --filter @curtain/mannequin exec tsx scripts/derive-male-table.ts <ANSUR_II_MALE_Public.csv>
# Pictures:
pnpm --filter @curtain/mannequin exec tsx scripts/render-male-v2.ts /tmp/panels --head
node packages/mannequin/scripts/compose-male-v2.mjs /tmp/panels docs/screens/claude/male-shape-v2/mannequin
pnpm --filter @curtain/garment-spike build:bundle
node spikes/garment-engine/viewer/men-renders.mjs /tmp/v2 --male-shape=v2 --phone-only
node spikes/garment-engine/viewer/men-renders.mjs /tmp/v1 --phone-only
npm_config_workspace_concurrency=1 pnpm check
```

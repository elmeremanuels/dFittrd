# Slice M1b: the male 2D figure (branch `claude/men-m1b-2d`)

19 Nov 2026. Plan: `docs/research/men-3d-plan.md` slice M1b. Pictures: `docs/screens/claude/men-m1b-2d/`.

## What was built

- **The male 2D figure** in `apps/web/src/render/`:
  - `bodyGeometry(m, h, 'male')` builds it from the shopper's chest (`bust` on the wire), waist, seat (`hip`), shoulder width and height. Anything missing comes from the male table at the chest girth (`maleRowAt`).
  - `maleBodyPath` draws the outline. `maleArmOutline` draws the arm and the male sleeve. `figureY` gives the male levels.
  - `render/maleBody.ts` holds the male table and levels. They are a copy of `MALE_REFERENCE` / `MALE_LEVELS` in `@curtain/mannequin`, and a test checks them value by value against `packages/mannequin/src/families.ts`. The copy keeps the mesh generator out of the embed's main chunk.
- **What makes it read as a man:**
  - The shoulder line is the ANSUR biacromial breadth.
  - Round deltoid caps sit at the ANSUR bideltoid breadth, scaled by a typed shoulder width (ratio 0.75–1.35).
  - The trapezius slopes from a thicker neck (EN neck girth).
  - The torso is one straight line from the armpit over the chest and waist to the seat. There is no bust: a top on him gets no +2 px bust allowance.
  - The arms are thicker (relaxed upper arm = 0.93 × ANSUR flexed biceps), taper to the wrist and clear the seat.
  - The legs have a calf. Levels and widths use the male family's depth/width ratios at the chest, waist and seat.
  - The left arm is wound like the torso, so there is no fill-rule hole at the armpit. The female figure has that hole and keeps it, because it is pinned.
- **Kept the same:**
  - The neutral face: the same `neutralFace` drawing, placed by the head ellipse only.
  - The picked skin colour (`data-skin`).
  - Every estimate label: the "Estimate · not measured" badge and the body chip, the compact "Estimate" badge, and the aria-label "… — not measured".
- **Size rings:** they sit at the male levels and use his depth ratios, so a ring still cuts into or stands off the body correctly. The chest ring's text reads "Chest".
- **Where it shows** (`EmbedApp` → `ResultScreen figure` → `AvatarView family`):
  - `figure="male"` only when the product arrives with `requires3d` (it passed the men's gate, `MEN_3D_GATE`) and `garmentBodyFamily` is male.
  - That result stays hidden until the male 3D view settles, and becomes "coming soon" when the view fails. So the male figure can never show without the working 3D view (D20 point 3).
  - With the gate off, a men's product keeps today's figure. The peek, the app and the hero render show men's products as coming soon (M0), so they never draw the male figure.
- **`scripts/demo-men.mjs`:**
  - New flags: `--width=N`, `--all-sizes` (S…XXL) and `--skins` (picks Monk 2, 5 and 9 in the avatar prompt and checks the figure took the colour).
  - New checks: with the gate on, the figure beside the male 3D body must be `data-figure="male"`; with the gate off it must be today's figure.

## Measured vs assumed

**Measured** (this container; the unit tests, and the demo in headless Chromium with SwiftShader at 360 × 760 CSS px, 2× scale, so not a phone):

- **Female figure unchanged:**
  - A sha256 golden of the female body geometry, outlines (every mock garment, four bodies), AvatarView markup (four skins, both label strips, compact, plain, loading) and size rings was written on the unmodified code (first commit, 68ca275). It still passes.
  - Pixel comparison: 164 female figures (every mock garment × four bodies, with fit, rings and skins) were rendered with the base code (8658d21) and with this branch. The markup is byte-identical and the 2280 × 14666 screenshots differ in **0** of 33,438,480 pixels.
- **Male widths in cm, from `bodyGeometry`** (unit test `maleFigure.test.tsx`):

  | Body | Over the deltoids | Shoulder | Chest | Waist | Seat | Deltoid / seat | Waist / chest |
  |---|---|---|---|---|---|---|---|
  | S | 46.1 | 40.0 | 32.0 | 29.6 | 34.7 | 1.33 | 0.92 |
  | M | 48.5 | 40.5 | 33.9 | 32.0 | 36.2 | 1.34 | 0.94 |
  | L | 51.0 | 41.5 | 35.9 | 34.6 | 38.0 | 1.34 | 0.96 |
  | XL | 53.5 | 42.5 | 38.0 | 37.1 | 39.7 | 1.35 | 0.98 |
  | XXL | 56.5 | 43.5 | 40.2 | 40.2 | 41.4 | 1.36 | 1.00 |
  | Female reference (88/70/96, shoulder 38) | 45.7 (shoulder + arm) | 38.0 | 33.0 | 25.5 | 36.0 | 1.27 | 0.77 |

  - At M, the 2D chest, waist and seat widths agree with the 3D male M mesh rings (33.8, 31.8 and 35.9 cm, from the M1 report) to within 0.3 cm.
  - The S deltoid is 0.06 cm over the ANSUR value, because the cap must stand at least 0.6 arm-widths outside the shoulder point.
- **Real stack** (`demo-men.mjs`, gate on):
  - The tee settled on the male 3D body for all five bodies, in sizes S, M, L, XL and XXL.
  - In every one, the 2D figure was `data-figure="male"` and carried "Estimate · not measured" and "Body from your answers".
  - Picking Monk 2, 5 and 9 gave the figure the colours #F3E7DB, #D7BD96 and #3A312A on every body.
  - With the gate off (S, M, XL), the figure was today's figure.
  - The men's shirt without a bundle still shows "coming soon" with no figure.

**Assumed (not measured):**

- The 2D head half-width: 7.7 cm (female 7.4).
- The deltoid stands 10 % proud of the relaxed upper arm.
- Depth/width ratios: 0.9 for the neck, 0.95 for the knee, calf and ankle (the female figure's value), 1.2 for the thigh (the package's assumption).
- A male foot length of 27 cm when none is typed.
- The chin at 0.13 of stature, as for the female figure.
- A calf level of 0.81.
- The crotch level is fixed at the M row's inseam / stature (0.517 from the top) rather than taken per size.
- The female shoulder point and the EN/ANSUR equivalence assumptions are inherited from `@curtain/mannequin` (see its file comment).

## How the pictures look (honestly)

- `01-male-2d-figure-S-to-XXL-monk-2-5-9.png`: the 2D figure from the real stack, five bodies by three tones.
  - He reads as a man through the neck, the sloping shoulders with round deltoids, the thick arms and the straight legs.
  - Inside the phone frame, S to XXL look very alike. Every figure is fitted to the same frame height, and the tee (each body in its own recommended size) covers the torso, so only slightly wider shoulders, arms and thighs show the change.
  - The rings and chips are the same in every picture, as expected, because every body wears its own recommended size.
  - On Monk 9 the light face ink reads a little like a mask; this was already noted for the female figure.
- `02-offline-male-S-to-XXL-bare-and-tee-vs-female.png` (rendered outside the app, the same component): the bare male figures S…XXL next to the female reference figure. Without the tee the straight torso and the absent bust are clear, and the widths grow steadily from S to XXL.
  - The tee here is in size S on every body (the harness picks the first size, not the advice), so its sleeves look boxy on the large bodies.
- `03-closeup-male-M-shoulders.png`:
  - Trapezius, deltoid caps and arms read well.
  - A slight kink remains where the trapezius curve meets the cap.
  - The arm's inner outline runs over the torso from the cap to the armpit, as on the female figure.
  - There are no hands, as on the female figure.
- `04-size-M-gate-off-female-vs-gate-on-male.png`: the same tee, body M and size, with today's figure (gate off) on the left and the male figure on the right. The difference is clear but moderate: in absolute pixels the male M is only about 2 % broader than the female figure, so he reads as male through proportions and shape, not sheer width.
- `05-female-figures-pixel-identical-sample.png`: part of the female sheet used in the pixel comparison (identical before and after).
- `10-gate-on-<size>-2d-figure.png`: the figure beside the settled 3D view, standard colour, per size.
- `20-gate-on-L-page-monk-9.png`: the full page with the figure, ring legend and fit list. The list still says **"Bust"**; that label comes from the fit engine's point label (M2a), not from this slice.
- `21-gate-on-XXL-3d-view-monk-9.png`: the 3D view with the picked tone and its estimate label, for context. The synthetic tee's known holes at the shoulder and hem (M1 report) are visible, and its chip also says "Bust".
- `22-gate-on-M-pending-nothing-shown.png`: while the required 3D view loads, nothing is shown (no figure, no size), but also no spinner (M0 behaviour).
- `23-gate-on-shirt-no-bundle-coming-soon.png`: the men's shirt without a bundle shows coming soon.

## Open issues

- The fit-point list and the 3D chips say "Bust" for a men's product. That is M2a, the fit engine (another session); only the 2D ring says "Chest".
- The ring and body-chip strings are inline in `rings.ts` / `AvatarView.tsx` like their female neighbours, not in a catalogue (D21): an existing gap, not widened here.
- The female figure's arm hole at the left armpit (fill rule) is still there, because it is pinned. Fixing it means updating the golden on purpose.
- No hands; the slight shoulder kink; S…XXL changes are subtle inside the frame.
- Assumed values (above) are not measured on people.
- `packages/fit-engine`, `packages/schema/src/garment.ts` and the About-you form were not touched.

## Reproduce

```sh
git checkout claude/men-m1b-2d
pnpm install --frozen-lockfile
pnpm build:packages
pnpm --filter @curtain/web exec vitest run src/__tests__/femaleFigureGolden.test.tsx src/__tests__/maleFigure.test.tsx src/embed/__tests__/menGate.test.tsx
pnpm --filter @curtain/garment-spike build:bundle        # the synthetic men's tee bundle
node scripts/demo-men.mjs test-results/m1b --width=360 --all-sizes --skins   # gate on
node scripts/demo-men.mjs test-results/m1b --width=360 --gate-off            # gate off
npm_config_workspace_concurrency=1 pnpm check
```

The pixel comparison was a one-off scratch harness, not committed. It rendered the same 164 female `AvatarView` SVGs with `git show 8658d21:<file>` swapped in for `render/body.ts`, `render/rings.ts` and `components/AvatarView.tsx`, took Playwright screenshots at 2× and diffed them with PIL `ImageChops.difference` (bounding box `None`). The committed golden snapshot test is the lasting proof.

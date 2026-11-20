# Men's chino on male shape v2: the body under the crotch is gone from view

Branch `claude/chino-crotch-v2`, from `claude/garment-engine` (head `ac42bcf`), 20 Nov 2026. This continues `men-chino-v2.md` (the chino on both male shapes), `male-shape-v2.md` (the 3D body) and `male-2d-v2.md` (the 2D figure). Every garment below is the **SYNTHETIC men's test chino W/L** or the **synthetic men's tee** ("not a product"): their measurements are invented and their surface detail is painted by code. Every picture is an estimate, and the embed labels it so ("Estimate · not measured"). Nothing was measured on a real chino or a real person. No GPU run, no deploy, no pull request; `packages/fit-engine` and `.github/` are untouched.

## Verdict

1. **The patch of body under the crotch on male shape v2 is closed, at the body.** The drawn body in front of the cloth, four views, was 175 / 201 / 212 / 209 / 274 pixels on S / M / L / XL / XXL; it is **41 / 7 / 0 / 1 / 3**. From the front, between the crotch and 12 cm under it, it was 0 / 43 / 92 / 75 / 97 pixels; it is **0 on every body**. v1 is unchanged, number for number (88 / 6 / 3 / 9 / 73).
2. **The cause was the v2 body, not the trouser.** Its thighs were ellipses whose centres sit closer together than their half-width: they crossed the centre plane by up to 1.0 cm (XXL) for 12 to 15 cm under the crotch. A trouser's two legs had nowhere to pass, and the cloth ended up inside the thighs. The thighs now touch at the crotch and part under it: each inner side stays 0.6 cm off the centre plane, at the same girth.
3. **Every v2 ring girth is at the table value** (0.000 % off on all 12 rings, S to XXL; the limit was 0.5 %), and **the male 2D figure v2 follows the new body within 0.10 cm** (limit 0.5): it draws the same gap.
4. **The crotch seam's hang is 0.1 to 0.9 cm less on v2, and most of what is left is the invented chart.** It hangs 7.3 / 3.9 / 4.5 / 2.6 / 2.8 cm under the body (was 7.5 / 4.5 / 5.4 / 2.8 / 2.9). Of that, 5.6 / 3.0 / 0.5 / 0.5 / 0.5 cm is where the size's rises put the seam on that body, 1.0 / 0 / 2.3 / 0 / 0 cm is the band sliding to where the body fills it, and 0.7 / 0.9 / 1.7 / 2.1 / 2.3 cm is added by the drape. The split and what I tried against the last part are in section 3.
5. **Strain near the crotch point fell to a third on the large bodies**: largest edge 5.6 / 7.5 / 5.7 / 9.6 / 11.1 % (was 5.3 / 10.7 / 22.0 / 33.0 / 28.1).
6. **v2 can become the default for men, from the garments' side.** Both demos pass with the switch on and off, and with the switch on the chino no longer shows the body. What is left before the flip is not engineering: the founder's look at v2 (OI-15) and both switches moving together with v2-built bundles. The default was not flipped.

## What changed

| Piece | Where | What |
|---|---|---|
| Thighs that part under the crotch | `packages/mannequin/src/maleV2.ts` | The thighs touch at the crotch and, from 0.8 cm under it, each keeps its inner side 0.6 cm off the centre plane (`MALE_V2_ASSUMPTIONS.thighGapCm`, `thighPartOverCm`, `thighInnerRoundCm`). A thigh there is a D, flat on the inside with a rounded corner; at the thigh ring and below it is scaled so that its girth is the ellipse's (the flat side is paid for all round: the outer side moves out by under 0.1 cm). Below where an ellipse clears the gap by itself (above the knee) the leg is the v1 ellipse as before. |
| The torso ends just under the crotch | same | It ended at the gluteal fold, 3.3 cm under the crotch, hidden inside the touching thighs. With the thighs parted it would stand in the gap, so its last section is 0.4 cm under the crotch, 10 % inside the thigh tops, and it closes 0.6 cm under that. The leg's tuck into the torso starts above the join. The buttock's lower half stays on the thighs, as before. |
| The 2D figure draws the gap | `apps/web/src/render/body.ts`, `maleBody.ts` | The inner edge of each leg is 0.4 px off the middle at the crotch and 0.6 cm off it from 0.8 cm under (`MALE_V2_THIGH_GAP_CM`, held equal to the 3D value by a test). Only with the male shape switch on; the v1 figure is byte for byte the same (its goldens pass). |
| The seat bridges its hollow | `packages/garment-viewer/src/trouser.ts` (`trouserField`, `bridgeSeatHollow`), one line in `engine.ts` | For a tape-built trouser on a body with drawn outlines, the collision field has the hollow at the centre back (between the buttocks) bridged from the hip ring up, easing back to the drawn body 3 cm under the hip ring and from 40 to 65 % of the way to the waist ring. The builder already lays the seat's rows on the body's hull there; the collider now agrees with it. Every other bundle, and v1, are draped as before. |
| Tests | `maleV2.test.ts`, `maleFigureV2.test.tsx`, `maleChino.test.ts` | See "Bounded in tests". |

Not touched: `packages/fit-engine`, `packages/schema`, `cloth.ts`, the chino and tee builders (`pomChino.ts`, `pomTee.ts`; one comment in `pomChinoBody.ts`), the not-drawn logic, `apps/api`, `.github/`. The v1 male body, the female bodies and every bundle built on them are byte for byte the same (the existing sha256 tests pass).

## Measured versus assumed

All numbers are from runs on this branch in this container (node; the pictures from headless Chromium with SwiftShader, a software renderer, not a phone). "Before" is `claude/garment-engine` at `ac42bcf`, re-run here; it reproduced the men-chino-v2 report's numbers exactly.

### 1. The body (v2 mesh, S to XXL)

Inner side of the left thigh, cm from the centre plane (negative: past it, inside the other thigh):

| | S | M | L | XL | XXL |
|---|---|---|---|---|---|
| Before, at the thigh ring (5.1 cm under the crotch) | 0.02 | −0.53 | −0.79 | −0.98 | −1.04 |
| Before, 10 cm under the crotch | 0.41 | −0.12 | −0.35 | −0.52 | −0.58 |
| Before, where it is back at the centre plane | (never crosses) | 12 cm under | 14.5 | 15.5 | 15.5 |
| Now, from 0.8 cm under the crotch to the knee | ≥ 0.60 | ≥ 0.60 | ≥ 0.60 | ≥ 0.60 | ≥ 0.60 |
| Outer side at the thigh ring, before → now | 15.6 → 15.7 | 16.4 → 16.4 | 17.3 → 17.4 | 18.4 → 18.5 | 19.6 → 19.7 |

- **Ring girths**: the loop on the mesh at each of the 12 anchor rings against the table: 0.000 % off on every ring in every size (`meshRingCircumference`; tested at 0.5 %). The thigh ring is the one that changed shape.
- **2D against 3D** (`maleFigureV2.test.tsx`, the drawn SVG outline against the mesh): the ten widths of the male-2d-v2 report plus the leg's inner edge at the thigh ring and 10 cm under the crotch. Largest difference 0.10 cm (the outer side of the XL thigh ring: 18.39 drawn, 18.50 on the mesh). Inner edge: 0.58 to 0.62 drawn, 0.60 to 0.68 on the mesh.
- Five closed, consistently oriented parts in every size and for the typed bodies of the existing tests (unchanged tests, 185 pass).
- **The tee on v2** is draped against the torso and arms only; its bounds in `male.test.ts` pass unchanged.

### 2. The chino after the drape, each table body in the fit engine's size

Pixels: drawn body in front of the cloth by under 2 cm, four views at 3 px/cm, between hem and band. Strain: edge strain in %, largest edge within 8 cm of the crotch point.

| Body / size | v2 before: pixels (front / back / sides) | v2 now: pixels (front / back / sides) | v1 (unchanged) | v2 crotch p99 / largest, before → now | v2 seat p99, before → now |
|---|---|---|---|---|---|
| S / 32/32 | 175 (0 / 167 / 8) | **41** (0 / 36 / 5) | 88 | 5.2 / 5.3 → 4.6 / 5.6 | 3.0 → 3.4 |
| M / 34/32 | 201 (45 / 156 / 0) | **7** (0 / 6 / 1) | 6 | 8.3 / 10.7 → 6.4 / 7.5 | 4.5 → 5.5 |
| L / 38/32 | 212 (99 / 113 / 0) | **0** | 3 | 10.7 / 22.0 → 4.6 / 5.7 | 7.1 → 7.8 |
| XL / 40/32 | 209 (95 / 114 / 0) | **1** (0 / 1 / 0) | 9 | 16.8 / 33.0 → 7.8 / 9.6 | 7.4 → 8.1 |
| XXL / 44/32 | 274 (129 / 145 / 0) | **3** (0 / 3 / 0) | 73 | 15.5 / 28.1 → 8.7 / 11.1 | 7.8 → 8.1 |

- With the body change alone (before the seat bridge) the pixels were 38 / 7 / 0 / 0 / 20; the bridge took the back of XXL down.
- What is left on S (36 pixels at the back) is on the back of the thighs, where the 32/32 hangs 7 cm low on the S body: the same kind as v1's 88 on S.
- Whole-cloth p99 strain 4.4 to 6.6 % (was 4.4 to 6.5). **The seat got a little worse**: p99 up 0.3 to 0.9 points, and the seat's row of cloth reads 0.7 / 1.2 / 0.7 / 1.5 / 1.4 cm short of the tape (was 0.6 / 1.0 / 0.7 / 1.0 / 0.9). That is the bridged hollow: the cloth is held out at the centre back.
- Tape after the drape on v2: waistband 0 to 0.6 cm over, thigh 0.2 to 1.3 over, inseam 0.8 to 1.0 over, front rise 0.2 to 0.6 over, back rise 0.1 to 1.3 over (XXL: 38.5 → 39.8). The rises read up to 0.7 cm longer than before (XL front: 28.4 → 29.1): the seam is pushed out by a body it now meets under the crotch and at the bridged seat.
- Off size on the M body (v2): 36/32 to 44/32 slide 7.0 to 17.8 cm as before (within 0.5 cm, except 38/32: 17.0, was 14.3) and show no body pixels (were 52 to 141). 30/32 and 32/32 are not drawn, as before; the XXL body draws W44 only.
- The tape gate (built minus asked, all 24 sizes) is 0.029 cm at most on v2, as before, and unchanged on v1.
- A drape takes about 1 s on v2 in node, as before (not a phone).

### 3. The crotch seam under the body: which part is which

Cm under the body's crotch (the table's inside leg), v2, own size:

| Body / size | As built: the size's rises on that body | Band slid | Added by the drape | In all, now | In all, before |
|---|---|---|---|---|---|
| S / 32/32 | 5.64 | 1.0 | 0.7 | **7.3** | 7.5 |
| M / 34/32 | 2.98 | 0 | 0.9 | **3.9** | 4.5 |
| L / 38/32 | 0.50 | 2.3 | 1.7 | **4.5** | 5.4 |
| XL / 40/32 | 0.50 | 0 | 2.1 | **2.6** | 2.8 |
| XXL / 44/32 | 0.50 | 0 | 2.3 | **2.8** | 2.9 |

- **The invented chart**: the first column. The rises of the synthetic chart are long for the S and M bodies of v2 (the seam is built 5.6 and 3.0 cm under the body with the band at the worn waist) and too short from W36 up (the seam is built at its 0.5 cm minimum and the band sits 0.3 to 4.7 cm under the worn waist). Nothing in the geometry changes that; a real chart brings its own rises. The 0.2 to 0.3 cm that this column lost on S and M is the body: the torso no longer ends 3.3 cm under the crotch.
- **The invented chart and the fit engine's pick**: the second column. The W32 band is 1 cm and the W38 band 2 cm longer than the S and L bodies where they sit, so they slide to where the body fills them.
- **Geometry and the solver**: the third column, 0.7 to 2.3 cm (was 0.9 to 2.4). This is the part I could work on, and I got little of it:
  - **What it is.** On the bodies whose seam is built at its minimum (L, XL, XXL) the seam runs almost level under the body for 9 cm behind the crotch point and 7 cm in front of it, then climbs at 25 to 30° to the seat and the belly. A line that flat drops a long way for a little length: 0.25 cm more seam lets the crotch point down 2 cm. In the drape the two rises end 0.5 and 0.9 cm longer than cut on XL (1.8 and 2.5 %, against the 1 % the seams are allowed), because the collision with the body is applied after the seams are pulled to length, and it pushes the seam back out at the seat and the belly.
  - **Tried and kept**: the seat's hollow bridged in the collision field. The seam no longer sinks 2.4 to 3.4 cm into the hollow between the buttocks. Worth 0.1 to 0.2 cm of drop, less than I expected.
  - **Tried and dropped** (each measured on both shapes, none committed): building the seat's rows and the back seam into the hollow instead (the seam is then built lower: S 7.9, M 5.0, L 5.6 cm in all, worse; XL and XXL 2.4 and 2.5, better); the seams allowed 0.2 % or 0 % instead of 1 % (no change: the collision decides, not the allowance); the centre seams built 0.4 cm off the body instead of 0.7 (0.2 cm less added, 0.3 cm more built); the thighs parting over 0.3 cm instead of 0.8 (0.2 cm on XL and XXL only).
  - **What would take it away**: the seams held to length after the collision as well as before it, in `cloth.ts`. I did not touch that file (a sibling session is working on the solver's stiffness). It would help v1 more than v2: there the drape adds 1.6 to 3.4 cm, unchanged on this branch.
- On v1 nothing changed: 6.3 / 3.4 / 3.1 / 3.8 / 3.9 cm in all, of which 4.65 / 0.64 / 0.5 / 0.5 / 0.5 built.

### 4. Bounded in tests

- `packages/mannequin/src/maleV2.test.ts` (5 new, one per size): the thighs meet at the crotch (within 0.4 cm of the middle); from 0.8 cm under it to the knee each inner side is at least 0.59 cm off the centre plane; the thigh ring's loop is within 0.5 % of the table; the outer side moved by under 0.15 cm; the torso's lowest vertex is within 1.1 cm under the crotch.
- `apps/web/src/__tests__/maleFigureV2.test.tsx`: the inner edge of the drawn leg against the mesh at the thigh ring and 10 cm under the crotch, within 0.5 cm, with the ten widths already there; the gap 3, 6 and 10 cm under the crotch; the 2D constants equal the 3D ones.
- `packages/garment-viewer/src/maleChino.test.ts`, on v1 and v2, per body:
  - body pixels through the cloth under 120 / 20 / 15 / 25 / 100 on v1 and 50 / 25 / 15 / 15 / 25 on v2 (was one bound per shape: 120 and 310);
  - from the front, between the crotch and 12 cm under it: under 5 pixels on v2 (measured 0), under 45 on v1 (measured 0 to 38);
  - the crotch seam under the body in all: under 6.8 / 3.9 / 3.6 / 4.3 / 4.4 cm on v1 and 7.8 / 4.4 / 5.0 / 3.1 / 3.3 on v2 (was 8 for all); what the drape adds under 3.9 cm on v1 and 2.7 on v2 (was 3);
  - strain near the crotch point on v2: p99 under 11 %, largest edge under 14 % (was 19 and 38); v1's bounds stand (14 and 24); the whole cloth under 8 % and the seat under 9.5 % as before;
  - the seat's row at most 1.9 cm short on v2 (was 1.6, measured 1.5: the cost named above);
  - the bridged field: never inside the drawn body, only the back half touched, 1.5 to 4 cm at the centre back of the hip ring, the drawn body again under the seat, at the band and at the front; on v1 the same field as before.

### 5. The real stack, switch off and on

Four runs in headless Chromium at 390 × 760 CSS px at 2×, men's gate on. "Off": no `VITE_MALE_SHAPE`, no `MALE_SHAPE`, v1-built bundles on disk. "On": both set to `v2` by the scripts, v2-built bundles on disk.

| Run | Switch off (v1) | Switch on (v2) |
|---|---|---|
| `demo-men-chino.mjs`: five bodies, own size front / side / back and close, other legs, too large, not drawn | exit 0, 57 pictures. S 32/32, M opened in 36/32 (34/32 picked too), L 38/32, XL 40/32, XXL 44/32 | exit 0, 57 pictures, the same sizes; the 2D figure is marked v2 |
| `demo-men.mjs --all-sizes` (the tee) | exit 0, 44 pictures, five bodies settled in S to XXL | exit 0, 44 pictures, the same |

- In both chino runs the M body in 30/32 and the XXL body in 38/32 are not drawn, with the sentence (10.8 and 13.1 cm); 34/30, 34/34 and 38/32 on M are drawn. The shirt without a bundle shows "coming soon" in both tee runs.
- No page error and no console error in any run.
- The switch-on runs were made three times: the join between the torso and the thigh tops was changed twice after I saw the first pictures of the bare body (see "How it looks"). Each time the bundles were rebuilt and both scripts exit 0; the pictures and the numbers of this report are from the last.
- Not run: the `--thigh` variant (nothing in it changed), and the mixed case (one switch set, the other not), as before.

### Assumed [A], new on this branch

- The thighs part by 0.6 cm each side of the centre plane, reached 0.8 cm under the crotch, with a corner 0.25 cm round. Chosen so that two layers of cloth, each the collision clearance (0.35 cm) off its own thigh, fit between them with the builder's 0.25 cm between cloth and centre plane. Not measured on people: most men's thighs touch for some centimetres under the crotch. This is a mannequin's gap.
- A woven seat bridges the hollow between the buttocks from the hip ring up; under the seat the seam hangs free, and at the band the body is read as drawn.
- Everything `MALE_V2_ASSUMPTIONS`, `POM_CHINO_ASSUMPTIONS` and the invented measurements already assume.

**Not measured:** a real chino; a phone; a production web build; a typed body between or outside the five table bodies in the chino (the body tests cover typed bodies, the drape tests do not); the bake mount; a v2 bundle built before this branch on the new body (see open issues).

## The pictures (`docs/screens/claude/chino-crotch-v2/`)

All from the real embed (storefront → "Try it on" → About you → 3D view), 390 × 760 CSS px at deviceScaleFactor 2, men's gate on, composed into sheets by a scratch script (labels added, cells scaled down). "Before" cells are cut from the sheets the men-chino-v2 branch committed (`docs/screens/claude/men-chino-v2/`), which were taken the same way. Ten sheets, 144 raw pictures looked at and not committed.

- `01-v2-close-front-before-top-after-bottom.png`, `02-v2-close-back-before-top-after-bottom.png`: the five bodies in their own size on male shape v2, zoomed in, before over after.
- `03-v2-crotch-crops-before-after.png`: the crotch cut out of those and enlarged 2× (soft), front and back.
- `04-v2-own-size-front-side-back.png`: the whole figure on v2, three views (the 3D canvas cut out of the page).
- `05-close-front-back-v1-and-v2.png`: switch off against switch on, close, front and back.
- `06-tee-front-back-v1-and-v2.png`: the tee, switch off against switch on.
- `07-2d-figure-v1-and-v2.png`: the 2D figure with the chino (v1, then v2) and with the tee on v2, where the bare legs show the gap. Stored with 256 colours.
- `08-bare-body-v2-before-after.png`: the bare v2 body in the 3D view (a size that is not drawn), M before and after, XXL after, and the seat and thighs enlarged.
- `09-v2-M-other-sizes.png`: 34/30, 34/34 and 38/32 on the M body, v2.

## How it looks, honestly

- **v2 with the chino, front** (`01`, `03`, `05`): the grey patch between the legs is gone on every body. The two legs meet in a clean line under the fly, as on v1. The legs hang a little straighter than before at the inner thigh.
- **v2 with the chino, back** (`02`, `03`): the patch under the seat is gone. The row of dark specks at seat height is nearly gone too: one or two specks left on M, XL and XXL (it was a row on every size).
- **v2, side and whole figure** (`04`): as before. Round seat, level band, legs that break on the foot in a slightly ragged ring. The crotch still sits visibly low on the S body (7 cm), where the 32/32 looks a size long in the rise.
- **v1 against v2** (`05`): they now read as the same trousers on two bodies. v1 still has its two or three light specks at each hip on S; v2 has none there. I would now show either to a shopper as an estimate.
- **Off size on M, v2** (`09`): 34/30 and 34/34 differ at the hem as they should; 38/32 hangs from the hips with a dropped crotch and a wide band, which reads as "too large". No body shows.
- **The tee** (`06`): unchanged in both. On v2 the bare legs under the tee show the slit between the thighs and, just at the tee's hem, a thin line across the thigh tops.
- **The 2D figure** (`07`): with the chino the only change is a slightly wider line between the legs. Bare legs (the tee rows) show a narrow slit from the crotch down, where v2 had one line; at phone size it is 3 to 4 px wide.
- **The bare v2 body, and this is the cost** (`08`): there is now a slit between the thighs from the crotch down, 1.2 cm wide, where they touched. It reads as a mannequin's legs, not a man's. Across the thigh tops at crotch height runs a thin dark line with a small step in the outline, where the torso comes out of the legs; before, a fainter double line ran 3 cm lower. My first two versions of this join showed a heavier line there (the torso's rim); the third moved the rim inside the thighs and the line is thinner now, but it is still plainer than the old one and it sits where the gap begins. It reads a little like the hem of briefs. Any bottom hides it; a tee does not quite.
- Everything said about the painted detail (flat), the hem on the stub foot and the body telling the sizes apart more than the trousers do stands from the men-chino-v2 report.

## Can v2 become the default for men now?

**Yes, from the garments' side. I recommend flipping it after the founder has looked at v2, with both switches and the v2 bundles in one step.**

What the runs show:
- **Nothing breaks with the switch on.** Tee and chino build on v2, pass their tape gates (0.17 and 0.029 cm), mount, drape and settle on all five bodies in the same sizes as with the switch off, and all four scripts exit 0.
- **The blocker is gone.** The chino on v2 showed the body under the crotch on four of five bodies; it shows none there now, and less body anywhere than v1 does on S and XXL (41 and 3 pixels against 88 and 73).
- **v2 now measures better than v1 on the chino on every count but one**: band at the worn waist to W34 and nearer to it above, seat row 0.7 to 1.5 cm short against 2.4 to 3.0, the drape adds 0.7 to 2.3 cm to the crotch drop against 1.6 to 3.4, largest edge near the crotch point 11 % against 20.5. The one: the base size hangs 3.0 cm under the M body by construction (0.6 on v1), because the invented rises were chosen for the v1 body.
- **The tee is better on v2 than on v1** (`men-tee-on-v2.md`), and is not affected by this branch.

What is still to do before the flip, none of it a defect in the garments:
1. **The founder looks at v2** (OI-15): `05-close-front-back-v1-and-v2.png`, `06-tee-front-back-v1-and-v2.png` and `08-bare-body-v2-before-after.png`. New for that look: the slit between the thighs and the line at crotch height on the bare body.
2. **Both switches move together** (`VITE_MALE_SHAPE=v2` in the web build, `MALE_SHAPE=v2` on the api), with the tee and the chino rebuilt on v2 from this branch and imported. One source for the shape would remove the risk of one being set without the other (OI-77).
3. **One look on a real phone** would be prudent: every picture here is from a software renderer.

The default was not flipped on this branch.

## Open issues

- **The drape still adds 0.7 to 2.3 cm to the crotch seam's drop on v2 and 1.6 to 3.4 cm on v1** (section 3). It needs the seams held after the collision in the solver.
- **The invented chart's rises do not suit the bodies** (long on S and M, short from W36 up), and the W32 and W38 bands slide 1.0 and 2.3 cm on the S and L bodies of v2. Unchanged; a real chart decides it.
- **The seat on v2 reads 0.7 to 1.5 cm short and strains 0.3 to 0.9 points more** than before the bridge; the rises read up to 1.3 cm long after the drape (XXL back).
- **The thigh gap is a mannequin's**, 1.2 cm between the thighs from just under the crotch. On the bare body it shows as a slit, in 3D and in 2D. Whether that is the look wanted is part of the founder's review of v2 (OI-15).
- **A thin dark line shows round the top of the thighs at crotch height** on the bare v2 body, where the torso comes out of the legs; it was at the gluteal fold, 3.3 cm lower. Just above the gap, the thighs' flat inner corners meet the torso's valley with a small step. Both are hidden by any bottom.
- **A v2 bundle built before this branch is built for touching thighs.** It still mounts on the new body (the shape gate reads `v2`, not a version). Rebuild v2 bundles: `MANNEQUIN_VERSION` was not raised, because raising it changes the job id of every bundle on every body.
- `spikes/garment-engine/viewer` (the spike's own copy of the viewer) knows none of this, as before.
- The open points of `men-chino-v2.md` that this branch did not touch stand: v1's seat row 2.4 to 3.0 cm short, the 1.2 MB bundle, the inseam 0.5 to 1.0 cm long after the drape, the thigh field's note.

## Commands

```sh
git checkout claude/chino-crotch-v2
pnpm install --frozen-lockfile
pnpm build:packages
# tests: the body, the 2D figure against it, the chino drape on both shapes
pnpm --filter @curtain/mannequin test
pnpm --filter @curtain/web exec vitest run src/__tests__/maleFigureV2.test.tsx src/__tests__/maleFigureGolden.test.tsx src/__tests__/maleFigure.test.tsx
pnpm --filter @curtain/garment-viewer exec vitest run src/maleChino.test.ts src/male.test.ts
pnpm --filter @curtain/garment-spike exec vitest run src/pomChino.test.ts
# numbers of this report (metrics.json) and software renders, per shape
CHINO_SHOTS=/tmp/chino-v1 pnpm --filter @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts
CHINO_MALE_SHAPE=v2 CHINO_SHOTS=/tmp/chino-v2 pnpm --filter @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts
# the real stack, switch off (v1 bundles on disk)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts
pnpm --filter @curtain/garment-spike exec tsx scripts/build-bundle.ts --only synthetic-men-tee --skip-separation
node scripts/demo-men-chino.mjs /tmp/demo-chino-v1
node scripts/demo-men.mjs /tmp/demo-tee-v1 --all-sizes
# … and on (v2 bundles on disk)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts --male-shape=v2
pnpm --filter @curtain/garment-spike exec tsx scripts/build-bundle.ts --only synthetic-men-tee --skip-separation --male-shape=v2
node scripts/demo-men-chino.mjs /tmp/demo-chino-v2 --male-shape=v2
node scripts/demo-men.mjs /tmp/demo-tee-v2 --all-sizes --male-shape=v2
npm_config_workspace_concurrency=1 pnpm check
```

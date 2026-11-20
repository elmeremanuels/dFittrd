# Men's chino on male shape v1 and v2: built per size, seams that hold, a thigh field

Branch `claude/men-chino-v2`, from `claude/garment-engine` (head `04f7ed6`), 19 Nov 2026. This continues `men-chino.md` (the builder), `men-tee-on-v2.md` (how the tee went onto v2) and `male-shape-v2.md`. Every garment below is the **SYNTHETIC men's test chino W/L** (`SYNTHETIC_MENS_CHINO_WL`, "not a product"): its measurements are invented and its surface detail is painted by code. Every picture is an estimate, and the embed labels it so ("Estimate · not measured"). Nothing was measured on a real chino or a real person. No GPU run, no deploy, no pull request; `packages/fit-engine` and `.github/` are untouched.

## Verdict

1. **The chino now builds on both male shapes.** One builder, one body reader; v1 stays the default. The tape gate passes on all 24 sizes with 0.03 cm at most on each shape, and on v2 the band sits at the fit engine's worn waist (0.0 cm under it on the base size, where the probe through the ellipses had it 5.1 cm low).
2. **Three of the four listed defects are reduced on both shapes; the fourth only on v2.** Worst-edge strain near the crotch point is 9 to 21 % on v1 and 5 to 33 % on v2 (was 37 to 59 %). The device shows every size's own rises (was: the base size's, up to 0.9 cm off). What the drape adds to the crotch seam's drop is 1.2 to 3.4 cm (was 3.7 cm on the base size). The seat row reads 0.6 to 1.0 cm short on v2, but still 2.4 to 3.0 cm short on v1 (was 2.9 to 3.4).
3. **The crotch seam still hangs 2.8 to 7.5 cm under the body, and I can no longer call most of that a builder defect.** With the rises graded, each size hangs where its own rises put it on its own table body. On the S body in 32/32 that is 4.7 cm (v1) and 5.8 cm (v2) by construction: the invented chart's rises are long for that body. The first builder hid this by showing every size with the base size's rises.
4. **The thigh field is in, for men's bottoms only, and it does not do what the task expected.** Typing the table's thigh alone leaves the M body in 36/32. Ticking "Measured with a tape" moves it to 34/32, with or without the thigh. Numbers below.
5. **v2 cannot become the default for men yet.** The tee is ready on v2. The chino on v2 shows a strip of skin behind the crotch (175 to 274 pixels in the four-view count, against 3 to 88 on v1), because the v2 body's thighs touch at the centre and the cloth of the two legs cannot pass between them. That is visible in the back views. The default was not flipped.

## What changed

| Piece | Where | What |
|---|---|---|
| One body for both shapes | `spikes/garment-engine/src/pomChinoBody.ts` (new) | At a height: the outline a ring of cloth lies on, as 96 radii about a centre. From `Mannequin.outlines` on v2, from the ellipses on v1. Every outline handed out is a convex hull (a tape does not follow a hollow). Also the drawn torso on the centre plane, which the crotch seam passes under. |
| Builder | `pomChino.ts` | Rings are the body's outline offset until the row's own length is the tape's girth. Rows per stretch are counted once (`counts`), so every size has the base size's vertices and triangles. The crotch seam is built the way it hangs: the crotch point is its lowest point; from there it runs straight to where it meets the body in front and behind, then round the body to the seat line. Before, it was a level line under the body. |
| Every size as built | `pomChinoBundle.ts` | Each size is built on its own table body and shipped as offsets from the base mesh (`grading.json` `built`, the tee's mechanism), moved by the waist ring's height. The device shows the size's own rises and crotch depth. `maleShape: 'v2'` builds, tapes and grades on the v2 bodies and writes `mannequin.maleShape` into anchors.json and qa.json. Builder version `pom-chino-0.2.0`. |
| Seams and grain | `pomChino.ts`, `packages/garment-viewer/src/cloth.ts` (`addSeams`), `trouser.ts` (`trouserSeams`), `engine.ts` | The bundle names its six seams (both rises, both inseams, both outseams) and every row and column of its mesh (the weft and warp). The drape lets a seam stretch 1 % at most, with long-range pairs so a long seam holds in a few iterations; along the grain neighbours come at most 2 % farther apart and 0.5 % closer [A]. Read only for a bundle whose builder is `pom-chino-…`. |
| Leg tops joined to the torso | `trouser.ts` `trouserField` | On v1 the legs end above the crotch wider than the torso: a ledge at hip height. The cloth was drawn across its edge and the body showed through as a row of specks. A tape-built trouser is now draped against a torso widened to hold the leg tops, easing back over 3 cm. v2 has no ledge and is untouched. |
| Band slide on v2 | `trouser.ts` `slideTrouserBand` | Reads the drawn outline's girth where the body has one. |
| Thigh field | `apps/web/src/embed/aboutYou.ts`, `strings/en.ts` | Optional, men's bottoms whose chart has a thigh column only. Two catalogue strings ("Thigh", "Round the fullest part of one thigh, just under the crotch"). |
| Tools | `scripts/build-chino-bundle.ts --male-shape=v2`, `scripts/demo-men-chino.mjs --male-shape=v2 --thigh --only-own` | The demo sets `VITE_MALE_SHAPE` and the api's `MALE_SHAPE` together and stops if the bundle on disk is built on the other shape. |

Not touched: `packages/fit-engine`, `packages/schema`, `packages/mannequin`, the tee builder, `apps/api`, `.github/`.

## Measured versus assumed

All numbers are from runs on this branch in this container (node; the pictures from headless Chromium with SwiftShader, a software renderer, not a phone). `docs/reports/claude/men-chino-v2-metrics.json` holds them.

### 1. The tape gate (built minus asked, each waist on its own table body)

Largest error over all gated measurements and all 24 sizes: **0.027 cm on v1, 0.029 cm on v2** (gate 0.5 cm). What the device shows for a size (decoded from grading.json) is within 0.012 cm of the tape, rises included.

Where each size sits on its body by construction, L32:

| Size | Body | v1: crotch seam under the body | v1: band under the worn waist | v1: tilt | v2: crotch seam under the body | v2: band under the worn waist | v2: tilt |
|---|---|---|---|---|---|---|---|
| 30/32 | S | 4.98 | 0 | 2.63 | 6.09 | 0 | 0.71 |
| 32/32 | S | 4.65 | 0 | 1.78 | 5.83 | 0 | 0.70 |
| 34/32 | M | 0.64 | 0 | 2.39 | 3.31 | 0 | −0.30 |
| 36/32 | L | 0.5 | 1.59 | 2.68 | 0.5 | 0.33 | −0.33 |
| 38/32 | L | 0.5 | 1.86 | 1.40 | 0.5 | 0.65 | −0.64 |
| 40/32 | XL | 0.5 | 3.44 | 2.38 | 0.5 | 2.40 | −1.10 |
| 42/32 | XXL | 0.5 | 5.60 | 2.46 | 0.5 | 4.26 | −0.37 |
| 44/32 | XXL | 0.5 | 5.80 | 2.06 | 0.5 | 4.71 | −1.41 |

- The band is at the worn waist up to W34 on both shapes. From W36 up the invented rises do not reach it, less so on v2 (0.3 to 4.7 cm) than on v1 (1.6 to 5.8 cm).
- On v2 the tilt is near zero or negative: the back of the band is not higher than the front. The invented back rise (front + 9 cm) was chosen for the v1 body. I tried front + 11 and + 13 on v2: the crotch then hangs lower (5.1 and 6.6 cm on M), so I left the chart alone.
- On the v2 M body the base size hangs 3.3 cm under the body by construction, on v1 0.6 cm. The v2 body's crotch-to-worn-waist is shorter along its drawn outline than the v1 ellipses'.

### 2. After the drape, each table body in the fit engine's size for it

Girths are full girths, cm. *Row* is the cloth row's own length, *hull* a tape round its outside. Rises: tape → as shown by the device → after the drape. Crotch: as built on that body → after the drape (under the body's nominal crotch, the table's inside leg).

**v1**

| Body / size | Waist → row | Seat → row / hull | Thigh → row | Inseam → | Front rise | Back rise | Crotch seam under the body | Band slid |
|---|---|---|---|---|---|---|---|---|
| S / 32/32 | 83.5 → 83.5 | 104 → 101.6 / 99.0 | 62 → 62.1 | 81 → 81.6 | 26.5 → 26.5 → 27.3 | 35.5 → 35.5 → 36.4 | 4.65 → 6.3 | 0 |
| M / 34/32 | 88.5 → 89.7 | 109 → 106.4 / 104.8 | 64.5 → 65.1 | 81 → 81.6 | 27 → 27 → 27.7 | 36 → 36 → 37.1 | 0.64 → 3.4 | 0 |
| L / 38/32 | 98.5 → 98.5 | 119 → 116.2 / 112.4 | 69.5 → 70.0 | 81 → 81.5 | 28 → 28 → 28.6 | 37 → 37 → 37.9 | 0.5 → 3.1 | 0 |
| XL / 40/32 | 103.5 → 105.5 | 124 → 121.0 / 118.9 | 72 → 73.0 | 81 → 81.6 | 28.5 → 28.5 → 29.5 | 37.5 → 37.5 → 38.7 | 0.5 → 3.8 | 0 |
| XXL / 44/32 | 113.5 → 114.1 | 134 → 131.0 / 127.1 | 77 → 77.9 | 81 → 81.6 | 29.5 → 29.5 → 30.3 | 38.5 → 38.5 → 39.7 | 0.5 → 3.9 | 0 |

**v2**

| Body / size | Waist → row | Seat → row / hull | Thigh → row | Inseam → | Front rise | Back rise | Crotch seam under the body | Band slid |
|---|---|---|---|---|---|---|---|---|
| S / 32/32 | 83.5 → 83.5 | 104 → 103.4 / 96.7 | 62 → 62.3 | 81 → 81.9 | 26.5 → 26.5 → 26.8 | 35.5 → 35.5 → 35.6 | 5.83 → 7.5 | 0.8 |
| M / 34/32 | 88.5 → 88.5 | 109 → 108.0 / 102.2 | 64.5 → 65.2 | 81 → 81.8 | 27 → 27 → 27.2 | 36 → 36 → 36.1 | 3.31 → 4.5 | 0 |
| L / 38/32 | 98.5 → 98.6 | 119 → 118.3 / 109.2 | 69.5 → 70.5 | 81 → 81.8 | 28 → 28 → 27.8 | 37 → 37 → 37.5 | 0.5 → 5.4 | 2.5 |
| XL / 40/32 | 103.5 → 104.5 | 124 → 123.0 / 115.4 | 72 → 73.3 | 81 → 81.8 | 28.5 → 28.5 → 28.4 | 37.5 → 37.5 → 38.4 | 0.5 → 2.8 | 0 |
| XXL / 44/32 | 113.5 → 113.8 | 134 → 133.1 / 123.9 | 77 → 78.4 | 81 → 81.8 | 29.5 → 29.5 → 29.4 | 38.5 → 38.5 → 39.4 | 0.5 → 2.9 | 0 |

Against the first builder (v1 only, `men-chino.md`):

| | First builder, v1 | Now, v1 | Now, v2 |
|---|---|---|---|
| Crotch seam under the body after the drape | 4.6 / 4.2 / 4.2 / 4.2 / 3.8 | 6.3 / 3.4 / 3.1 / 3.8 / 3.9 | 7.5 / 4.5 / 5.4 / 2.8 / 2.9 |
| … of which the drape adds (after less as built, less the band's slide) | 3.7 on the base size (the others were shown with the base size's rises) | 1.7 / 2.8 / 2.6 / 3.3 / 3.4 | 0.9 / 1.2 / 2.4 / 2.3 / 2.4 |
| Seat row short of the tape | 2.9 … 3.4 | 2.4 / 2.6 / 2.8 / 3.0 / 3.0 | 0.6 / 1.0 / 0.7 / 1.0 / 0.9 |
| Thigh row over the tape | 1.1 … 2.2 | 0.1 … 1.0 | 0.3 … 1.4 |
| Rises after the drape over the tape (front; back) | 0.6 … 0.8; 1.0 … 3.4 | 0.6 … 1.0; 0.9 … 1.2 | −0.2 … 0.3; 0.1 … 0.9 |
| Rises as the device shows them | the base size's (front ±0.3, back up to 0.9 off) | the size's own, within 0.012 | the size's own, within 0.012 |
| Waistband row over the tape | 0 … 1.9 | 0 … 2.0 | 0 … 1.0 |
| Inseam along the seam over the tape | −0.3 … 0.4 | 0.5 … 0.6 | 0.8 … 0.9 |

- **S got worse on the first line and that is the honest number.** The S body in 32/32 hung 4.6 cm under before with the base size's rises; with its own it is built 4.65 cm under and the drape adds 1.7.
- **On v1 the drape still adds about 3 cm at M to XXL.** The v1 torso ends in a flat underside between the legs. The seam under it runs almost level, and a level line carrying a load drops a long way for a small slack (2 mm of slack over the 8.5 cm in front of the crotch point is 1.8 cm of drop). The v2 body rises from the crotch in a curve and the drape adds 0.9 to 2.4 cm there.
- **The inseam reads 0.5 to 0.9 cm long** after the drape. It did not before. The seam limit is 1 % (0.8 cm on 81).
- **The v2 L body's band slid 2.5 cm** (band 98.7 cm against 96.7 cm of body there); on v1 it stayed.

### 3. Strain and the body through the cloth

Edge strain in %, own size. Pixels: drawn body in front of the cloth by under 2 cm, four views at 3 px/cm, between hem and band.

| Body / size | v1: whole cloth p99 | v1: seat p99 | v1: near the crotch point p99 / largest | v1: pixels | v2: whole cloth p99 | v2: seat p99 | v2: near the crotch point p99 / largest | v2: pixels |
|---|---|---|---|---|---|---|---|---|
| S / 32/32 | 4.5 | 4.4 | 6.6 / 9.4 | 88 | 4.4 | 3.0 | 5.2 / 5.3 | 175 |
| M / 34/32 | 6.0 | 7.0 | 11.8 / 15.4 | 6 | 4.7 | 4.5 | 8.3 / 10.7 | 201 |
| L / 38/32 | 5.9 | 7.5 | 10.7 / 11.5 | 3 | 5.4 | 7.1 | 10.7 / 22.0 | 212 |
| XL / 40/32 | 6.2 | 7.1 | 12.2 / 20.5 | 9 | 5.8 | 7.4 | 16.8 / 33.0 | 209 |
| XXL / 44/32 | 6.7 | 7.7 | 12.4 / 17.8 | 73 | 6.5 | 7.8 | 15.5 / 28.1 | 274 |

First builder, v1: whole cloth 11.7 to 13.8, seat 12.4 to 14.3, near the crotch point 10.7 to 23.9 with a largest edge of 36.7 to 58.5, pixels 6 / 6 / 8 / 31 / 100.

- **Strain is about half of what it was everywhere**, and the largest edge near the crotch point a third on v1. Note that the measure changed with the fix: rows, columns and seams are now limited by the drape itself, so their strain is small by rule; the diagonals of the mesh are free.
- **Pixels on v1** are where they were at M to XXL and worse on S (88 against 6). On S they are on the thighs, front and back, where the loose 32/32 hangs 6 cm low. Midway through this branch the count was 229 / 35 / 56 / 145 / 173: a row of specks along the leg tops at hip height. Joining the leg tops to the torso in the trouser's collision field removed most of it.
- **Pixels on v2 are the open problem**: 175 to 274, on the back of the thighs under the seat and a little at the front. See "How it looks".

### 4. Off size, on the M body (L32)

| Size | v1 | v2 |
|---|---|---|
| 30/32, 32/32 | not drawn (waist, body 10.8 and 5.4 cm larger) | the same |
| 36/32 | band slid 2.3 cm, crotch 7.3 under | band slid 6.8 cm, crotch 10.7 under |
| 38/32 | slid 11.3 cm | slid 14.3 cm |
| 40/32 to 44/32 | slid 14 cm; W42 and W44 past the hips ("would not stay up") | slid 16.5 to 17.8 cm, held by the seat (not past the hips) |

On the XXL body W30 to W42 are not drawn on both shapes (33.7 down to 2.8 cm), W44 is. The other legs on M (34/30, 34/34): inseam 76.6 and 86.6 after the drape on v1, 77.0 and 86.9 on v2.

### 5. Bundle size and time

Five files 1,230,905 bytes on v1 (v2 within 2 KB of that): grading.json 776,703 (302,632 gzip), base.glb 263,340, anchors.json 157,073 (24,340 gzip), qa.json 32,975, material.json 814. About 436 KB gzipped. The first builder's bundle was 332 KB. The growth is the 23 built sizes (grading.json) and the grain (anchors.json). Under the 3 MB import limit. 8,168 triangles, 4,157 vertices, one piece, 0 non-manifold edges. Building the bundle takes about 4 s. A drape takes 0.6 to 0.8 s on v1 and 0.9 to 1.1 s on v2 in node (not a phone).

### 6. The thigh field (task 3)

Typed on `SYNTHETIC_MENS_CHINO_WL` for the M table body (height 174, weight 74, chest 98, waist 86, seat 96, inside leg 84):

| "Measured with a tape" | No thigh typed (the prior's 54.9 cm, σ 3) | Thigh 58.5 typed |
|---|---|---|
| on (σ 1.5) | 34/32, confidence 0.815 | 34/32, confidence 0.902 |
| off (σ 2.5) | 36/32 | 36/32 (34/32 scores 0.467 against 0.468) |

- **The field alone does not give the M body 34/32.** What moves it is how sure the waist is. The earlier report's sentence "the embed asks no thigh, so the M body opens in 36/32" named the wrong cause.
- **Empty**: the thigh is the population prior's estimate (`source: 'prior'`), exactly as before this field existed. A bottom's fit already used it. It is never shown as measured. **Typed**: stored as `manual`.
- Shown only for `audience: 'men'`, category `bottom`, and a chart with a thigh column. Order: waist, seat, thigh, inside leg. Range 35 to 110 cm (14 to 43 in) [A], the bounds the schema calls plausible for a chart's thigh column.
- Women's dress, women's and unisex bottoms (with the same thigh column), no garment, men's tee and men's long sleeve: field lists as before, a typed thigh is neither stored nor validated, and a women's bottom's `FitResult` is identical with and without it (16 tests in `aboutMenThigh.test.tsx`).
- **One behaviour change that was not asked for**: a men's bottom with an empty thigh now shows the existing note "Add your thigh measurement under Edit my measurements for a more confident result". The fit and the size are unaffected.
- The collapsed section's sentence for men still reads "we estimate waist and seat"; the thigh is estimated too, as it already was. Not changed.
- The 3D view gets the thigh for free: the embed computes the fit once and hands it to the viewer.

### 7. The real stack, switch off and on (task 4)

Six runs, all exit 0, in headless Chromium at 390 × 760 at 2× with the men's gate on. "Off": no `VITE_MALE_SHAPE`, no `MALE_SHAPE`, v1-built bundles on disk. "On": `VITE_MALE_SHAPE=v2` in the web build and `MALE_SHAPE=v2` on the api, set together by the scripts, v2-built bundles on disk.

| Run | Switch off (v1) | Switch on (v2) |
|---|---|---|
| `demo-men-chino.mjs`: five bodies, own size front / side / back and close, other legs, too large, not drawn | exit 0, 57 pictures. S 32/32, M opened in 36/32 (34/32 picked too), L 38/32, XL 40/32, XXL 44/32 | exit 0, 57 pictures, the same sizes; the 2D figure is marked v2 |
| `demo-men-chino.mjs --thigh --only-own --bodies=M` (thigh typed, tape switch on) | exit 0: the M body opens in 34/32 | exit 0: 34/32 |
| `demo-men.mjs --all-sizes` (the tee) | exit 0, 44 pictures, five bodies settled in S to XXL | exit 0, 44 pictures, the same |

- In both chino runs the M body in 30/32 and the XXL body in 38/32 are not drawn, with the sentence (10.8 and 13.1 cm); 34/30, 34/34 and 38/32 on M are drawn.
- With the bundle of the other shape on disk each script stops before it starts and prints the build command. I did not run the mixed case (one switch set, the other not) in the browser; the api and viewer tests of `men-tee-on-v2` cover it ("coming soon", nothing drawn wrong).
- No page error and no console error in any run.

### Assumed [A], new on this branch

- A sewn seam stretches 1 % at most; along the grain the cloth stretches 2 % at most and shortens 0.5 % at most. Not measured on any cloth.
- The centre seams lie 0.7 cm off the body's hull, and the taut line of the crotch seam passes 0.5 cm off the drawn torso on the centre plane.
- The leg tops are joined to the torso over 3 cm, widened by at most 10 % (v1 only).
- A size is shown as built on the table body of its waist (`SYNTHETIC_CHINO_BODY`), moved by the waist ring's height. A shopper far from that body wears trousers shaped for it.
- The thigh field's range.
- Everything `POM_CHINO_ASSUMPTIONS`, `MALE_V2_ASSUMPTIONS` and the invented measurements already assume. The back rise is still front + 9 cm on both shapes.

**Not measured:** a real chino; a phone; a production web build; any body between or outside the five table bodies beyond the cases above; the bake mount.

## The pictures (`docs/screens/claude/men-chino-v2/`)

All from the real embed (storefront → "Try it on" → About you → 3D view), 390 × 760 CSS px at deviceScaleFactor 2, men's gate on. `chino--…` is the switch off (v1 body, v1-built chino), `chino-v2--…` the switch on.

- `chino--body-{S,M,L,XL,XXL}--5-3d-size-*--{front,side,back}.png` and `…--close-{front,side,back}.png` (zoomed in on waist, crotch and seat): each v1 body in the fit engine's size. `chino-v2--…`: the same on v2.
- `sheet-{v1,v2}-own-size-front-side-back.png`, `sheet-{v1,v2}-own-size-close-front-side-back.png`: the five bodies side by side, three views.
- `compare-{front,side,back,close-front,close-side,close-back}-v1-top-v2-bottom.png`: the switch off above, on below.
- `crop-{waist,crotch,seat,hem}-v1-top-v2-bottom.png`: close-ups cut from those pictures (the hem crops are enlarged 2× from the full view, so they are soft).
- `chino[-v2]--body-M--4-3d-embed-size-36x32--*.png`: the size the embed opened in for the M body. `chino[-v2]-thigh--body-M--*.png`: the run with the thigh typed and the tape switch on (opens in 34/32); `chino-thigh--1-about-you.png` is not taken (the About-you picture is taken on the S body only): the field shows in `chino--1-about-you.png` once "I know my measurements" is open.
- `chino[-v2]--body-M--7-size-{34x30-short-leg,34x34-long-leg,38x32-too-large}--{front,side}.png`, `…--6-size-30x32-not-drawn.png`, `chino[-v2]--body-XXL--6-size-38x32-not-drawn.png`.
- `…--0-storefront-page`, `--1-about-you`, `--2-pending`, `--3-settled-*`, `--3b-2d-figure`: the flow.

Software renders are not committed this time; the embed pictures cover the same views.

**How it looks, honestly.**

- **v1** reads as a pair of stone chinos in every size, as before: waistband with button and loops, fly, slanted pockets, back welts, legs that hang with long soft folds and break on the foot. Against the first builder's pictures: the legs are smoother (fewer small wrinkles: the cloth no longer stretches and shortens along its grain), the sizes differ a little more from each other at the rise, and the short dark crease under the fly is gone at M and L. The crotch still sits visibly low, most on the S body (6 cm), where the 32/32 looks a size long in the rise. From the back the seat is still flat (the v1 body has none) with a small dark knot where the seams meet on XL and XXL.
- **v1, what is wrong**: on the S body two or three light specks at each hip at pocket-end height, front and back; one or two on XL and XXL at the back. They are what is left of the leg-top ledge. The hem still lies on the stub foot in a slightly ragged ring. The painted detail is flat.
- **v2** reads as chinos on a more natural body: the seat is round from the back, the legs hang straighter and closer, the band sits level. The side views are better than v1's.
- **v2, what is wrong, and it is plain to see**: on M, L, XL and XXL a grey patch of body shows between the legs just under the crotch, about 1 cm wide and 3 to 4 cm high in the front view and wider from the back. On the S body it is a thin line. From the back there is also a short row of dark specks at seat height on every size, where the cloth crosses the lower edge of the seat. I would not show the v2 chino to a shopper like this.
- On both shapes the trousers are told apart by the body under them more than by their own size.

## Can v2 become the default for men?

**Not yet. The tee is ready; the chino is not.**

What the two runs show:
- **Nothing breaks with the switch on.** Tee and chino both build on v2, pass their tape gates, mount, drape and settle on all five bodies in the same sizes as with the switch off, and every script exits 0. The shape gate works both ways.
- **The tee is better on v2 than on v1** (`men-tee-on-v2.md`: tape 0.17 against 0.49 cm, no high neckline at XL and XXL, no edge over 30 %).
- **The chino measures better on v2 and looks worse.** Better: band at the worn waist to W34 and nearer to it above, seat row 0.6 to 1.0 cm short against 2.4 to 3.0, the drape adds 0.9 to 2.4 cm to the crotch drop against 1.7 to 3.4, rises within 0.9 cm after the drape. Worse: 175 to 274 body pixels against 3 to 88, as a visible patch under the crotch on four of the five bodies; the base size hangs 3.3 cm under the body by construction (0.6 on v1); largest edge near the crotch point 33 % at XL (20.5 on v1).

Before the flip, in the order I would do it:
1. **Close the skin patch under the crotch on v2** (open issues, first point). This is the blocker.
2. **The founder looks** at `compare-*-v1-top-v2-bottom.png`: the look of v2 itself is their call.
3. **Both switches move together**, with the v2 bundles imported and approved. A single source for the shape (the api telling the embed) would remove the risk of one being set without the other; that is still two switches.

If men's tops went live before men's bottoms, v2 could be the default for those today from the tee's side; with the chino in the catalogue it cannot. The default was not flipped on this branch.

## Open issues

- **v2: skin behind the crotch.** The thighs of the v2 M to XXL bodies cross the centre plane by 0.2 to 1 cm from the crotch to about 12 cm under it. Each leg's cloth is kept on its own side, is exempt from collision there, and ends up inside its own thigh. Candidates: hold the two inner legs together where the thighs touch; draw the body's inner thigh under the cloth; a v2 body whose thighs part under the crotch.
- **v1: the drape still adds about 3 cm to the crotch seam's drop**, because the v1 torso's underside is flat. It will not go away on v1 without a body under the crotch.
- **v1: the seat row is still 2.4 to 3.0 cm short.** The seat's 13 to 20 cm of ease sits at the sides by construction and collapses in the drape. Spreading the ease round the seat was not tried.
- **The rises of the invented chart do not suit the bodies**: long on S (4.7 to 5.8 cm under by construction), short from W36 up (band 0.3 to 5.8 cm under the worn waist). On v2 the back rise would have to be shorter than the front asks for a level band. A real chart will have its own rises; decide what the picture should do when they do not put the band at the worn waist.
- **The bundle is 1.2 MB** (436 KB gzipped). The built sizes could be stored per waist with the leg length morphed, about a third of that. Not done.
- **The inseam reads 0.5 to 0.9 cm long** after the drape.
- **The thigh field's note and the "we estimate waist and seat" sentence**, see section 6. The demo opens the M body in 36/32 unless the tape switch is ticked.
- **`trouserField` and the grain are for `pom-chino-…` bundles only.** The tee and every reconstructed garment are draped as before. Both would probably help the tee on v1.
- Real-chino calibration, the flat-lay photo projection, a belt for too-large sizes and the other open points of `men-chino.md` stand.
- `spikes/garment-engine/viewer` (the spike's own copy of the viewer) knows none of this. The embed and `packages/garment-viewer` do.

## Commands

```sh
git checkout claude/men-chino-v2
pnpm install --frozen-lockfile
pnpm build:packages
# the bundle (out/synthetic-men-chino-wl/; without the flag on v1, the default)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts --male-shape=v2
# tests: builder and tape gate on both shapes; the drape on S…XXL on both shapes; the thigh field
pnpm --filter @curtain/garment-spike exec vitest run src/pomChino.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/maleChino.test.ts
pnpm --filter @curtain/web exec vitest run src/embed/__tests__/aboutMenThigh.test.tsx src/embed/__tests__/aboutMen.test.tsx
# software renders and metrics.json (opt-in)
CHINO_SHOTS=/tmp/chino-v1 pnpm --filter @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts
CHINO_MALE_SHAPE=v2 CHINO_SHOTS=/tmp/chino-v2 pnpm --filter @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts
# the real stack, switch off (v1 bundles on disk) and on (v2 bundles on disk)
node scripts/demo-men-chino.mjs /tmp/demo-chino-v1
node scripts/demo-men-chino.mjs /tmp/demo-chino-v1-thigh --thigh --only-own --bodies=M
node scripts/demo-men.mjs /tmp/demo-tee-v1 --all-sizes
pnpm --filter @curtain/garment-spike exec tsx scripts/build-bundle.ts --only synthetic-men-tee --skip-separation --male-shape=v2
node scripts/demo-men-chino.mjs /tmp/demo-chino-v2 --male-shape=v2
node scripts/demo-men-chino.mjs /tmp/demo-chino-v2-thigh --male-shape=v2 --thigh --only-own --bodies=M
node scripts/demo-men.mjs /tmp/demo-tee-v2 --all-sizes --male-shape=v2
npm_config_workspace_concurrency=1 pnpm check
```

> Merge note (orchestrator): of the 144 screenshots only the comparison and overview sheets are kept in the repository (size); the rest were looked at and dropped at merge.

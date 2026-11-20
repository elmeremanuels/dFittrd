# Men's chino from tape: POM builder, device bundle, drape on the male S to XXL

Branch `claude/men-chino`, from `claude/garment-engine`, 19 Nov 2026. The second men's garment of `docs/research/men-3d-plan.md` (slices M3/M4), after the tee (`men-m3-tee.md`, `men-tee-v2.md`). Every garment below is the **SYNTHETIC men's test chino W/L** (`SYNTHETIC_MENS_CHINO_WL`, "not a product"). Its measurements are invented and its surface detail is painted by code. Every picture is an estimate, and the embed labels it so ("Estimate · not measured"). Built and draped on the v1 male body (the default). No Blender, no GPU run.

## Verdict

**The route works for a chino and is not ready for a real shop's chino.** From flat measurements alone it builds one welded pair of trousers that reads as chinos in the embed, reproduces every measurement it builds to within 0.04 cm on all 24 sizes, packs into a 332 KB bundle that passes the import gate, and drapes on the male S to XXL with the waistband, thigh and inseam within 2.2 cm of the input. A size the fit engine calls too small is declared not drawn, with the reason, as the tee does.

What stops a real product today, in the order I would work on it:

1. **Nothing was measured on a real chino.** The chart, the back rise, knee, leg opening and outseam, and the builder's eleven assumptions are invented. The back rise was *chosen* so the base size sits at the fit engine's worn waist on the M body. A real chino's rises may not do that.
2. **The crotch seam hangs 3.8 to 4.6 cm under the body after the drape**, where the builder put it 0.5 to 3.2 cm under. Part is geometry (the v1 body has no seat to hold the back rise up), part is the cloth stretching (the rises read 0.6 to 3.4 cm long after the drape). It reads as a slightly dropped crotch.
3. **The strain concentrates on the crotch seam**: the worst edge near the crotch point is stretched 37 to 59 % in the body's own size (99th percentile there 11 to 24 %). The seat is at 12 to 14 %, the whole cloth at 12 to 14 %, as the tee.
4. **The device does not grade the rises.** Its morph has no vertical stretch above the hip ring, so every size keeps the base size's band height and crotch depth. On this chart that costs up to 0.3 cm at the front and 0.9 cm at the back; a chart whose rise steps more would cost more.
5. **From W36 up the synthetic rises do not reach the worn waist** on the table body of that waist: the band sits 1.8 to 6.0 cm below where the fit engine reads the waist (the bodies' crotch-to-waist grows faster than 0.5 cm of rise per waist). The builder records it; the picture on the device does not show it (point 4).
6. **The outseam is checked, not built to.** Band height, both rises and the inseam already fix it. On the base size it is 0.8 cm off the (invented) chart; on other sizes −2.0 to +3.2 cm.
7. **The embed asks no thigh**, so its fit can open in the next waist (the M body opened in 36/32; with the table's thigh the fit engine says 34/32).

## What was built

| Piece | Where | What |
|---|---|---|
| POM chino builder | `spikes/garment-engine/src/pomChino.ts` | Flat measurements → one welded mesh on the canonical body. Rows of cloth: each leg's ring is the leg's own section offset to the tape's girth (thigh from the crotch to the thigh line, straight to the knee, straight to the hem); above the crotch one ring round both, the seat's girth at the seat line, a smooth line to the waistband, constant over the band. At the crotch level each leg's ring is cut flat on the centre plane and the two legs share that line's vertices: the crotch seam. The inseams meet on it at the crotch point, forward of its middle (short front fork, long back fork). Lengths are solved: the crotch point's height and the band's tilt for the front and back rise, the hem for the inseam. |
| Waistband at the worn waist | `pomChino.ts` `wornWaistHeight` | The band's mid height sits between the body's waist ring and hip ring by the front rise, the fit engine's own rule (`WORN_WAIST_RISE_CM`: 30 cm at the waist, 18 at the seat). The fit engine interpolates the girth, the builder the height: on the five table bodies the mannequin's girth at that height is 0.4 to 1.1 cm under the engine's number. |
| UVs per panel | `pomChinoUv.ts` | Six pieces: two fronts, two backs, two waistband halves. Unrolled row by row from the side seam (no relaxation); the fork shows as the crotch extension, as on a paper pattern. Render vertices are the welded vertices first, copies after, so the viewer's weld gives the mesh back (tested, triangle order included). A 1024 px atlas painted from pattern cm: the product's colour, topstitching, fly, slant pockets, back welts, belt loops, a button. CC0, no photo, recorded in `qa.json` `texture`. |
| Device bundle | `pomChinoBundle.ts`, `scripts/build-chino-bundle.ts` | The five files, `category: 'bottom'`, `builder: 'pom-chino-0.1.0'`. Grading targets are solved against the device's own morph, so the graded mesh's tape is the size's tape. `qa.json`: `chartAgreement.kind: 'tape-built'` (flagged `tape_built_no_chart_check`), `pomTape` per size, `gradingCheck`, where each size sits on its body, the assumptions. |
| SYNTHETIC chart | `pomChinoSynthetic.ts` | The fixture's 15 rows unchanged (tested), plus W40, W42, W44 by the fixture's own steps. The fixture stops at W38, which is tight on the XL and XXL table bodies; without the extra waists those bodies have nothing to drape. Written as `payload.json` in the bundle folder; the fixture in `@curtain/schema` is not touched. |
| Viewer | `packages/garment-viewer/src/trouser.ts`, four call sites in `engine.ts`, one optional field in `bundle.ts` | Only for a bundle whose anchors.json says `builder: 'pom-chino-…'`. (a) The waist is placed against the body girth the fit engine used, not the natural waist ring. (b) The collision exemption for vertices that start inside the body holds only below the hip ring; without this half the waistband stayed inside the body (1,560 body pixels through the band on M). (c) The band slide reads the band on its own tilted plane. (d) A size whose waist, seat or thigh the fit engine bands `tight` on a larger body is not draped and not drawn. Every other bundle takes the old path; all existing viewer tests pass unchanged. |
| Demo | `apps/api/src/demo.ts`, `scripts/demo-men-chino.mjs` | With `DEMO_MEN=1` the chino is seeded next to the tee. The new script runs the embed for the five bodies. `scripts/demo-men.mjs` and `male.test.ts` are not touched. |

Not touched: `packages/fit-engine`, `packages/schema`, `packages/mannequin`, the tee builder, `.github/`. No new interface string: the not-drawn sentence is the tee's catalogue string (`view3d.notDrawn`) with the anchor's name.

## The SYNTHETIC measurements (invented, not a product)

Flat widths are half girths. W34/L32 is the base size. From the fixture chart: waist, seat, thigh, front rise, inseam. Made up here [A]: back rise = front + 9; knee girth 47 at W34, +1.5 per waist; leg opening 38, +1 per waist; outseam = inseam + 22, +0.5 per waist.

| Waist | Waistband | Seat | Thigh | Knee | Opening | Front rise | Back rise |
|---|---|---|---|---|---|---|---|
| 30 | 78.5 | 99 | 59.5 | 44 | 36 | 26 | 35 |
| 32 | 83.5 | 104 | 62 | 45.5 | 37 | 26.5 | 35.5 |
| 34 | 88.5 | 109 | 64.5 | 47 | 38 | 27 | 36 |
| 36 | 93.5 | 114 | 67 | 48.5 | 39 | 27.5 | 36.5 |
| 38 | 98.5 | 119 | 69.5 | 50 | 40 | 28 | 37 |
| 40 | 103.5 | 124 | 72 | 51.5 | 41 | 28.5 | 37.5 |
| 42 | 108.5 | 129 | 74.5 | 53 | 42 | 29 | 38 |
| 44 | 113.5 | 134 | 77 | 54.5 | 43 | 29.5 | 38.5 |

Legs: L30 76 cm, L32 81, L34 86.

Assumed by the builder [A] (`POM_CHINO_ASSUMPTIONS`): band 3.5 cm high; seat line at the body's hip ring; thigh taped 2.5 cm under the crotch point; knee line at the body's knee ring; fork half length 0.45 of the leg tube's half depth, crotch point 0.8 of that forward; a leg round again 5 cm under the crotch; crotch seam at least 0.5 cm under the body; cloth 0.7 cm off the body along the centre front and back, the rest of the ease at the sides; 0.25 cm between the legs at the centre; tilt kept within −2 to +6 cm.

## Measured versus assumed

All numbers are from runs on this branch. `docs/reports/claude/men-chino-metrics.json` holds the drape numbers.

**1. The builder's tape on its own inputs** (`qa.json` `pomTape`; each waist built on the male table body it belongs to: W30/32 on S, W34 on M, W36/38 on L, W40 on XL, W42/44 on XXL). Built minus asked, cm, L32 (the other legs are the same within 0.01):

| Size | Body | Waist | Front rise | Back rise | Seat | Thigh | Knee | Opening | Inseam | Outseam (check) | Crotch ease | Band below worn waist | Tilt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 30/32 | S | 0.00 | 0.00 | 0.00 | 0.00 | −0.01 | 0.00 | 0.00 | 0.00 | +2.75 | 4.0 | 0 | 2.6 |
| 32/32 | S | 0.00 | 0.00 | 0.00 | −0.01 | −0.01 | 0.00 | 0.00 | 0.00 | +3.20 | 3.2 | 0 | 1.3 |
| 34/32 | M | 0.00 | 0.00 | 0.00 | −0.02 | −0.01 | 0.00 | 0.00 | 0.00 | +0.78 | 0.5 | 0.2 | 2.3 |
| 36/32 | L | 0.00 | 0.00 | 0.00 | −0.02 | −0.01 | 0.00 | 0.00 | 0.00 | −0.37 | 0.5 | 1.8 | 2.7 |
| 38/32 | L | 0.00 | 0.00 | 0.00 | −0.03 | −0.01 | 0.00 | 0.00 | 0.00 | +0.89 | 0.5 | 2.0 | 1.4 |
| 40/32 | XL | 0.00 | 0.00 | 0.00 | −0.02 | −0.01 | 0.00 | 0.00 | 0.00 | −0.55 | 0.5 | 3.7 | 2.3 |
| 42/32 | XXL | 0.00 | 0.00 | 0.00 | −0.03 | −0.01 | 0.00 | 0.00 | 0.00 | −2.00 | 0.5 | 5.8 | 2.5 |
| 44/32 | XXL | 0.00 | 0.00 | 0.00 | −0.04 | −0.01 | 0.00 | 0.00 | 0.00 | −1.06 | 0.5 | 6.0 | 2.0 |

The gate (0.5 cm, every measurement but the outseam) passes with 0.04 cm to spare. Seat, thigh and knee are read a second way, by cutting the mesh with a level plane; that is the number in the table. The rest are exact because the builder solves for them. Tilt is half the height difference between the band's back and front (the back is 2.6 to 5.4 cm higher). Crotch ease is the body's crotch minus the crotch point. W30 on S and W36 and W42 on their bodies are tighter at the waist than the body (recorded as `tighterThanBody`; built at the tape's value anyway).

**2. The device's grading of the base mesh** (`qa.json` `gradingCheck`), graded minus asked, all 24 sizes: waist, seat, thigh, knee, opening, inseam 0.00 cm (the targets are solved against the morph). Front rise −0.30 to +0.26, back rise −0.43 to +0.88 (not graded). Outseam −1.1 to +1.8.

**3. After the drape**, each table body in the size the fit engine recommends for it with the table's thigh and inside leg (`prepareFit` + `relax`, the mount's own steps). Girths as full girths, cm. *Row* is the cloth row's own length; *hull* is a tape round its outside.

| Body / size | Waist tape → row | Seat tape → row / hull | Thigh tape → row | Inseam tape → along the seam | Front rise → | Back rise → | Crotch seam under the body |
|---|---|---|---|---|---|---|---|
| S / 32/32 | 83.5 → 83.5 | 104 → 101.1 / 97.2 | 62 → 63.1 | 81 → 81.3 | 26.5 → 27.1 | 35.5 → 36.5 | 4.6 |
| M / 34/32 | 88.5 → 89.8 | 109 → 106.0 / 102.8 | 64.5 → 65.8 | 81 → 81.3 | 27 → 27.6 | 36 → 37.6 | 4.2 |
| L / 38/32 | 98.5 → 98.6 | 119 → 116.1 / 110.8 | 69.5 → 70.9 | 81 → 81.4 | 28 → 28.6 | 37 → 39.1 | 4.2 |
| XL / 40/32 | 103.5 → 105.4 | 124 → 120.9 / 117.0 | 72 → 73.9 | 81 → 81.4 | 28.5 → 29.2 | 37.5 → 40.1 | 4.2 |
| XXL / 44/32 | 113.5 → 114.9 | 134 → 130.6 / 125.9 | 77 → 79.2 | 81 → 80.7 | 29.5 → 30.3 | 38.5 → 41.9 | 3.8 |

- **Waist**: 0 to +1.9 cm. The band is pinned where it was placed; where the body under it is fuller than the band it is laid on the body.
- **Seat**: the row reads 2.9 to 3.4 cm short and the hull 6 to 9 cm short of the tape. The cloth is not lost: the seat's 13 to 20 cm of ease hangs in folds, the row's polyline cuts across them and the hull spans them. The hull stays 5 to 11 cm over the body's seat. I did not fix this (the tee needed girth loops for the same effect at the chest).
- **Thigh**: +1.1 to +2.2 cm, stretched (the thigh line is 2.5 cm under the crotch point, in the strained zone).
- **Inseam**: within 0.4 cm along the seam. The vertical drop from crotch point to hem is shorter where the hem rests on the foot or the floor (L34 on M: 86 cm of seam over 79.6 cm of drop).

**4. Strain**, edge strain in %, own size:

| Body / size | Whole cloth p99 | Seat p99 | Near the crotch point p99 | Near the crotch point, largest |
|---|---|---|---|---|
| S / 32/32 | 11.7 | 12.4 | 10.7 | 36.7 |
| M / 34/32 | 12.1 | 13.0 | 15.7 | 47.0 |
| L / 38/32 | 12.4 | 13.6 | 15.7 | 45.9 |
| XL / 40/32 | 13.0 | 14.2 | 19.2 | 54.9 |
| XXL / 44/32 | 13.8 | 14.3 | 23.9 | 58.5 |

"Near the crotch point" is within 8 cm of it; "seat" is from the crotch row up to 6 cm under the band's top. The largest edge is always on the crotch seam itself (the line of vertices the two legs share), next to the crotch point. Two things were tried on the way: a fork with five short edges in front of the crotch point reached 247 %; a crotch seam that bulged round the body's underside let the crotch drop 6 cm. The fork now has even 1.1 cm edges and the seam runs straight where the body lets it.

**5. Body through the cloth** (pixels where the drawn body is in front of the cloth by under 2 cm, four views at 3 px/cm, between hem and band): 6 / 6 / 8 / 31 / 100 for S to XXL, all at the inner thigh under the crotch, where the two legs' sections of the v1 body overlap at the centre and the cloth passes between them. In the embed pictures I see none there (the specks at the hips, see below, are elsewhere).

**6. Off size on the M body** (L32): W30 and W32 are not drawn (waist, body 10.8 and 5.4 cm larger). W36 is drawn with the band slid 3 cm down to where the body fills it; W38 10.3 cm down; W40 to W44 slide 14.5 cm, past the hips ("would not stay up"), with the crotch seam 21 to 22 cm under the body. That is the existing rule for a bottom without a belt, applied to the tilted band. On the XXL body W30 to W42 are not drawn (33.7 down to 2.8 cm), W44 is drawn. On the XL and XXL bodies every size of the fixture's own chart (to W38) is declared not drawn.

**7. Bundle size and time.** Five files 331,741 bytes: base.glb 273,224 (110,213 gzip), qa.json 32,918, anchors.json 14,072, grading.json 10,713, material.json 814. 8,488 triangles, 4,317 vertices, one piece, 0 non-manifold, 0 inconsistent edges, three openings. Far inside the 3 MB import limit. Building the bundle with all 24 sizes taped takes about 1 s. A drape takes 0.5 to 0.8 s in node (not a phone).

**8. UVs** (`qa.json` `texture`). Flat ÷ on-garment edge length, 1st / 50th / 99th percentile: fronts 0.88 / 1.00 / 1.40 (left) and 0.89 / 1.00 / 1.29 (right), backs 0.80 / 1.00 / 1.15 and 0.87 / 1.00 / 1.17, band halves 0.92 to 1.11. No folded triangle. Pieces flat: fronts 30.0 × 100.3 cm, backs 35.4 × 100.3, band halves 44.3 × 3.5 (the waist width on the tape is 44.25). The row-by-row unroll stretches the front piece up to 40 % along the crotch curve; left and right differ because the mirrored quads split along the other diagonal. A flat-lay photo projection as the tee has is not built for the chino.

## Male shape v2: probed, not supported

Asked late by the orchestrating session: build on v1 and v2. Not done. The branch it names for the API (`claude/men-tee-on-v2`: `mannequinFor(payload, { maleShape })`, `Mannequin.outlines`, the shape gate) was not in `origin/claude/garment-engine` when I merged it (head `cef47a2`), so there was nothing to build against. What I measured instead, once, with a throwaway test (not committed), using what the base has (`buildMannequin(shape, { maleShape: 'v2' })`, `planAvatar(…, 'v2')`):

- **The v1-built bundle draped on v2 bodies** (each in the fit engine's size): the cloth is stretched onto the body. Waistband row 86.0 / 93.5 / 101.6 / 110.7 / 121.1 cm for S to XXL against a tape of 83.5 / 88.5 / 98.5 / 103.5 / 113.5 (+2.5 to +7.6); thigh row 66.6 / 75.2 / 77.1 / 81.3 / 87.2 against 62 / 64.5 / 69.5 / 72 / 77 (+4.6 to +10.7); inseam 82.6 to 85.4 against 81; crotch seam 0.3 to 5.9 cm under the body; body pixels through the cloth 12 to 67 (back of a leg, and the back of the torso on M). Not usable.
- **Built on the v2 M body as the builder stands** (it reads `torsoAt` / `legAt`): every input still tapes exactly, but the band lands 5.1 cm under the worn waist and the waist reads 6.9 cm tighter than the body, because v2's section ellipses are larger than its drawn outline.

So v2 needs the builder to read the body's true outline per row (for the offset sections, the crotch height and the fork), the collider to match, and the numbers of this report taken again. The v2 body has a seat and a joined crotch, which is what the crotch seam lacks on v1, so it may well look better there; that is a guess until measured.

## The pictures (`docs/screens/claude/men-chino/`)

Embed (real stack, `scripts/demo-men-chino.mjs`, men's gate on, 390 × 760 at 2×, SwiftShader):

- `chino--body-{S,M,L,XL,XXL}--5-3d-size-*--{front,side,back}.png` and the sheet `sheet-embed-all-bodies-front-side-back.png`: each male table body in the fit engine's size for it. Every frame has the "Estimate · not measured" badge.
- `chino--body-*--5-3d-size-*--close-{front,side,back}.png` (the view zoomed in on waist and crotch), sheets `sheet-embed-close-body-*.png`, and crops `crop-{waist,crotch,hem}-front-body-*.png` (the hem crops are enlarged 2× from the full view, so they are soft).
- `chino--body-M--4-3d-embed-size-36x32--*.png`: the size the embed itself opened in for the M body.
- `chino--body-M--7-size-34x30-short-leg`, `34x34-long-leg`, `38x32-too-large`: the other legs and a size too large.
- `chino--body-M--6-size-30x32-not-drawn.png`, `chino--body-XXL--6-size-38x32-not-drawn.png`: the body alone and the sentence, e.g. "Size 38/32 is not drawn: it does not close at the waist on a body like yours (the body is 13.1 cm larger than the garment, more than its fabric gives). The size advice says how it fits."
- `chino--0-storefront-page.png`, `chino--1-about-you.png`, `chino--body-S--2-pending.png`, `chino--body-*--3-settled-*.png`, `chino--body-*--3b-2d-figure.png`: the flow.

Software renders (not WebGL, no texture; the same drape): `software-all-bodies-front-side-back.png`, `software-M-three-leg-lengths.png`.

**How it looks, honestly.** It reads as a pair of stone chinos: a waistband with a button and belt loops, a fly, slanted front pockets, two back welts, a side seam line, legs that hang with long soft folds and break on the foot. The band sits under the navel and is visibly higher at the back in the side views. What looks wrong: the crotch sits low (about 4 cm), most visible from the front as a short dark crease under the fly and from the back as a small knot of lines where the seams meet; the seat is flat (the v1 body has none) and the cloth folds in under it; the legs are a little wrinkled all the way down, more like a soft twill than a pressed chino, and there is no crease line; the sizes are told apart by the body under them more than by the trousers; at the hem the cloth lies on the stub foot in a slightly ragged ring, one leg's hem flares a little and the toe of the foot shows under it; in the close-ups there are two or three small light specks at each hip, at the height of the pocket ends, whose cause I did not find (texture bleed at the side seam or a pinhole between cloth rows). No skin shows through anywhere else I can see. The painted detail is flat: pockets and fly are lines, not openings.

## Open issues

- Real-chino calibration: tape one real chino flat (all nine inputs plus where the seat and knee are taken), build it, compare with its photos. Decide what to do when its rises do not put the band at the fit engine's worn waist.
- Crotch: the seam's drop and its strain. Candidates: a girth loop or a tether that holds the fork against the body; the v2 male body (it has a seat and a joined crotch, which would hold the back rise); a gusset of more than one row of edges.
- Rise grading on the device (a vertical stretch between hip ring and band in `gradingMorph`), or per-waist base meshes.
- Seat folds: decide whether the seat should keep its hull (girth loops, as the tee's chest) or fold.
- Too-large sizes slide down with no belt; a shopper would wear a belt. Not modelled.
- The embed's fit without a thigh input opens the M body in 36/32; the 2D advice and this view agree with each other, but differ from a fit with a taped thigh.
- Male shape v2 (section above): the builder must read the body's outlines, then every number here again.
- Flat-lay photo projection for trousers; a real phone's frame rate; `male.test.ts` has no chino case (it lives in `maleChino.test.ts`).

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
# the bundle (out/synthetic-men-chino-wl/, with payload.json; prints the tape check and the grading check)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts
# tests: builder, tape gate, bundle gate, UVs; the device check, the drape on S…XXL, not drawn
pnpm --filter @curtain/garment-spike exec vitest run src/pomChino.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/maleChino.test.ts
# software renders and metrics.json (opt-in)
CHINO_SHOTS=/tmp/chino pnpm --filter @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts
# the real stack in Chromium, men's gate on: screenshots in the folder given
node scripts/demo-men-chino.mjs /tmp/demo-men-chino
npm_config_workspace_concurrency=1 pnpm check
```

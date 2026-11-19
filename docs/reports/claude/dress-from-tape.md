# A second garment and a second stature for the tape route: a babydoll dress from flat measurements

Branch `claude/dress-from-tape`, from `claude/garment-engine`, 19 Nov 2026. The skirt spike ended on "conditional go for this garment on these bodies; a second garment and a second stature are missing before 'route' is claimed" (`docs/research/step3-serverdrape-spike.md` §9.10). This is that second garment and that second stature.

Everything here is the **SYNTHETIC babydoll dress** (`synthetic-tape-babydoll-dress`, "not a product"). Its measurements are invented; nobody laid a tape on anything. Every picture is an estimate and the embed labels it so ("Estimate · not measured"). No Blender was used: the dress is built in TypeScript and draped by the viewer's own on-device solver.

## Verdict

**The route generalises as a build step, and only partly as a drape.**

- **Build: yes.** Eight flat numbers per size become one welded mesh whose own tape reads every input within 0.10 cm, on five sizes and on bodies of 156, 168 and 180 cm. Where the dress hangs is solved from the tape (strap length, bodice length, length), not assumed. The bundle passes the import gate and opens in the embed; the size advice picks each chart body's own size.
- **Drape: only with three new holds.** The device drape as it stood turned this dress into a sack (first picture below). It reads as a babydoll only after the bundle tells the viewer to hold the top edge band, to keep the seam from stretching, and to switch the cling pull off. Those are small, opt-in and tested, but they are three more things the tape does not give. The skirt needed a server drape for the same underlying reason: this solver's cloth gives way under a long hanging load.
- **The second stature showed a real effect and a real gap.** The effect: the same dress sits 0.9 cm lower on the bust of a 156 cm body and 1.0 cm higher on a 180 cm body, its seam 2.0 cm under the short body's underbust and 0.9 cm over the tall one's, and its hem moves from 9.6 cm above the knee (180 cm) to 2.9 cm below it (156 cm). The gap: **the embed does not pass a height for a women's product**, so today every woman is drawn at the bundle body's 168 cm. The stature pictures below needed a preview switch that is off in every normal build.
- **Not shown: likeness.** Nothing here was compared with a real dress. That was the skirt's open point and it is still open for both garments.

So: "route" can be claimed for *building geometry that honours a tape*. It cannot yet be claimed for *a picture of how a taped garment hangs*; that still rests on per-garment holds and on a solver that is too soft.

## What a dress needs beyond the skirt's five numbers

The skirt form asks A band relaxed, B band stretched, C hip at 20 cm, D hem, E length. This dress used eight numbers per size and one answer per garment:

| | What | How to measure | Skirt equivalent |
|---|---|---|---|
| **A** | Bust | Flat across the top edge of the bodice, side seam to side seam, under the arms. x 2. | new |
| **B** | Underbust seam | Flat along the seam, lying as it falls. x 2. If it is elastic or shirred: also pulled as far as you would to put it on. | the band (A/B) |
| **F** | Skirt top | Just under the seam, pull the gathers flat and measure straight across. x 2. Leave empty if the skirt is not gathered. | the "F" proposed in §9.11 |
| **D** | Hem | Along the hem edge. x 2. | D |
| **E** | Length | Centre front, top edge of the bodice to the hem. | E, from another start |
| **G** | Bodice length | Centre front, top edge to the underbust seam. | new |
| **H** | Strap | One strap, from where it leaves the front edge to where it meets the back edge. If adjustable: at the setting you would sell it on, and say so. | new |
| **J** | Neckline | Straight between the two straps' inner edges at the front edge. | new |
| once | Closure | Pull-on, zip, buttons. A pull-on dress needs B stretched, as the skirt does. | same |

Three of these (G, H, J) do not size the dress: they say where it sits. G and H decide at what height the seam and the top edge lie on the body, which is what a shopper of another height needs to see. The hip at 20 cm (C) has no meaning on a dress whose skirt is free at the hip and is dropped.

**Not changed in the product.** `GARMENT_TAPE_FIELDS`, `checkGarmentTapeInput` and the measuring guide are untouched: adding points changes the stored tape's schema, both merchant admins and the fit engine's pull-on reading, which is not small. Proposal for `docs/MERCHANT-MEASUREMENTS.md`: replace its one-line paragraph on tops and dresses with the table above, and add to the form a per-category point list (skirt: A, B, C, D, E; strap dress: A, B, F, D, E, G, H, J) with the same three provenances.

## Measured versus assumed

**Measured (on runs of this branch).**

*The tape gate*: every input on every size, built on that size's AU chart body, tolerance 0.5 cm (`qa.json` `pomTape`).

| Size | Provenance | Max error | Top edge above bust line | Seam above underbust | Hem above knee |
|---|---|---|---|---|---|
| AU 8 | measured (synthetic) | 0.10 cm | 1.90 | +0.28 | 5.91 |
| AU 10 | INTERPOLATED | 0.10 cm | 1.87 | +0.07 | 5.91 |
| AU 12 | measured (synthetic) | 0.10 cm | 1.80 | −0.22 | 5.25 |
| AU 14 | INTERPOLATED | 0.09 cm | 1.71 | −0.54 | 4.64 |
| AU 16 | measured (synthetic) | 0.07 cm | 1.61 | −0.87 | 3.75 |

No row is tighter than its body. The same gate holds for AU 12 built on a 156 and a 180 cm body (`pomDress.test.ts`).

*Device grading of the base size (AU 12) against the tape*, cm (`qa.json` `gradingCheck`): bust −0.03 on every size, seam within 0.04, hem within 0.13, skirt top within 0.28, length exact. Bodice length is off by ±0.47 at AU 8 and 16 and neckline by ∓0.57: the device's morph cannot move the seam or the straps, so every size is drawn with the base size's bodice length.

*After the drape* (viewer's `prepareFit` + `relax` in node; `software/metrics.json`), cm, draped / tape:

| Body, size | Seam | Bust | Hem cloth | Hem outline | Length | Skirt top | p99 strain |
|---|---|---|---|---|---|---|---|
| AU 8, 8 | 78.2 / 77 | 92 / 92 | 168.6 / 168 | 102.3 | 71.5 / 70 | 109.5 / 115 | 5.9 % |
| AU 10, 10 | 82.7 / 81.5 | 97 / 97 | 174.4 / 174 | 106.9 | 72.7 / 71 | 115.6 / 122 | 6.3 % |
| AU 12, 12 | 87.3 / 86 | 102 / 102 | 180.3 / 180 | 111.8 | 73.9 / 72 | 121.6 / 129 | 6.5 % |
| AU 14, 14 | 91.9 / 90.5 | 107 / 107 | 186.2 / 186 | 116.7 | 74.9 / 73 | 128.0 / 135.5 | 6.7 % |
| AU 16, 16 | 96.4 / 95 | 112 / 112 | 192.1 / 192 | 121.7 | 76.1 / 74 | 134.6 / 142 | 7.0 % |

Read honestly: the seam sits at its allowed limit (tape plus the fabric's 1.5 %), so the hold is doing the work. The centre front comes out 1.5 to 2.1 cm long (2 to 3 %): the solver stretches the skirt under its own weight. The gathered row is compressed by 5 to 6 %. Largest single edge strain is 17 to 22 %, at the gathering stitch. Body pixels through the cloth in four views: 0 on the bodice, 0 to 33 at the skirt (of 180,000 per view). Drape time 0.8 to 0.9 s in node.

*The second stature* (same dress, same size, typed height), cm on the drawn body:

| Body | Top edge above bust line | Seam above underbust | Hem above knee |
|---|---|---|---|
| AU 12, 156 cm | 0.7 | −2.0 | −2.9 |
| AU 12, 168 cm (bundle body) | 1.6 | −0.5 | 3.3 |
| AU 12, 180 cm | 2.6 | +0.9 | 9.6 |
| AU 8, 156 / 180 cm | 0.7 / 2.6 | −2.0 / +0.9 | −0.9 / 11.6 |
| AU 16, 156 / 180 cm | 0.7 / 2.6 | −2.0 / +0.9 | −4.9 / 7.6 |

Seam, bust, hem and length after the drape are the same at all three statures (seam 87.3 to 87.4, length 73.8 to 73.9 for AU 12). The device does not rebuild the dress for the body: it hangs the 168 cm build from the drawn body's shoulder ring. Built directly on the short and tall bodies the builder gives the same direction (top edge lower on the short bust), which is the check that the device's shortcut is not misleading here.

**Assumed [A]** (`POM_DRESS_ASSUMPTIONS`, `qa.json`): the top edge is level all round and the back is as high as the front; the back straps are as far apart as the front ones; strap width 1.5 cm, 0.4 cm off the body; the bust girth is held from the top edge down to the body's bust line and runs straight to the seam; 24 soft folds, with the hem's outline 72 % of its sweep at the start; the gathers run into the folds over 8 cm; least ease 0.5 cm (bodice) and 1 cm (skirt); the held band is the top 1.7 cm; the fabric (viscose, 140 g/m², 1.5 % stretch); the closure (zip). And the tape itself: all of it.

**Forced by the body, not free.** The v0 female mannequin's armpit is 3.8 cm above its bust line and its torso widens again right above the bust (AU 12: 95.0 cm at the bust line, 97.4 cm 2 cm higher). A level top edge of a given bust girth can lie only in a band about 2 cm high. The synthetic strap and bodice lengths were chosen to land in it. A real dress's strap would not be: expect real tapes to ask for a top edge the mannequin has no room for.

## What changed

| Piece | Where | What |
|---|---|---|
| Builder | `spikes/garment-engine/src/pomDress.ts` | Bodice rows as the body's cross-section offset to the tape's girth; top edge height bisected for the strap length; seam and hem heights solved for the two lengths; skirt rows of exact cloth length laid in folds; two straps; `measurePomDress` tapes any mesh with the builder's vertex lists. |
| Synthetic tape | `pomDressSynthetic.ts` | AU 8, 12, 16 "measured", AU 10 and 14 by `fillDressTape` (straight line on the AU number, labelled `interpolated`; a size outside the measured ones is refused). The payload: a garment chart with the bust column only. |
| Bundle | `pomDressBundle.ts`, `scripts/build-dress-bundle.ts` | The five files; `chartAgreement.kind: 'tape-built'`; `pomTape`, `tapeProvenance`, `gradingCheck`; grading knots at chest, underbust, waist, hip, thigh and one below the hem. 11,996 triangles, 240 KB. |
| Support hint | `packages/garment-viewer/src/bundle.ts`, `engine.ts` | Optional `anchors.json` `support`: `pinFromCm` (hold from the top edge band, not only the straps), `cling: false`, `seamsAtCm` + `seamStretchPct`. With it the straps are never exempt from collision. Absent: every bundle drapes exactly as before. |
| Seam loop | `cloth.ts` | A girth loop may carry `maxGirthCm`: pulled back in when it opens past it. Collision still runs after it, so a body larger than the seam wins. |
| Embed | `apps/web/src/embed/look.ts`, `Garment3D.tsx` | `VITE_WOMEN_3D_HEIGHT=1`: a women's 3D body takes the typed height. Off in every normal build. No new interface text. |
| Demo | `apps/api/src/demo.ts`, `scripts/demo-dress.mjs` | `DEMO_DRESS=1` seeds the dress (flag `tape_built_no_chart_check`); the script walks the real stack. |

Not touched: `packages/fit-engine`, `.github/`, the men's builders (`pomTee.ts`, `pomBundle.ts`), the tape schema and forms. The small hull helpers of `pomTee.ts` are copied into `pomDress.ts` instead of exported, to keep clear of the tee sessions.

## Why the holds were needed (measured)

1. **Only the straps were pinned.** The viewer pins what lies above the armpit; this top edge lies below it. The bodice hung from four strap corners: top edge dropped 4 cm, bust ring 117 cm for a 102 cm tape, largest strain 50 %.
2. **The seam opened from 86 to 98 cm.** Not collision, not bending, and 30 iterations instead of 6 changed nothing (the solver's stiffness is per-iteration-normalised). With gravity off it stayed 86.0. The tethers keep lengths but let each particle hang straight under its pin, so the bodice hung like a curtain from the bust and the seam took the bust's girth. A sewn seam does not do that; the loop with a maximum says so.
3. **The cling pull** (a heuristic that grows with the fabric's drape) folded a 180 cm hem to an 87 cm outline round the legs.

## The pictures (`docs/screens/claude/dress-from-tape/`)

Embed, real stack, 390 × 760 at deviceScaleFactor 2, SwiftShader (`node scripts/demo-dress.mjs`):

- `embed-AU{8,10,12,14,16}--size-*--{front,side,back}.png`: each AU chart body in its own size (the advice picked exactly that size for all five). `--close-front`, `--close-side`: zoomed in on the bodice and seam.
- `embed-0-storefront-page.png`, `embed-1-about-you.png`, `embed-AU8--2-result.png`: the flow.
- `height-AU{8,12,16}-{156,180}cm--size-*--{front,side,back,close-front,close-side}.png`: the same with `--heights` (the preview switch).
- `sheet-own-size-front.png`, `sheet-own-size-side.png`, `sheet-own-size-back.png`, `sheet-close-front.png`: all five sizes side by side. `sheet-stature-front.png`, `sheet-stature-side.png`: AU 12 at 156, 168 and 180 cm.

Software renders (`software/`, no WebGL): every case front, side and back, with `metrics.json`. `software-before-holds.png` is the first drape, before the three holds.

**How it looks, honestly.** It reads as a short strap dress with a plain band bodice and a gathered skirt: thin straps, a level neckline just above the bust, a seam under the bust, fine vertical folds to a hem above the knee. Weak or wrong:

- The skirt hangs as a near-straight column that bulges over the hips, not as a swinging A-line; the hem outline is about 62 % of its sweep. A real babydoll of this sweep stands further off the body.
- The folds are thin, regular stripes. They are the 24 seeded folds, more than they are drape.
- The bodice is a flat band with no bust shaping, no cups, no shirring.
- The straps are thin lines, and in profile they stand slightly off the shoulder.
- One plain colour, no print, no UVs.
- **The sizes look alike.** At phone size AU 8 and AU 16 differ mainly by the body under them, as the skirt's did.
- At 156 cm the hem covers the knee and at 180 cm it is mid-thigh. That is the one thing a shopper could read from the stature pictures.

## Open issues

1. **The solver is too soft for a hanging garment.** Length +2 to 3 %, a seam that needs a hoop, a gathered row compressed 5 %. Each tape garment will need its own holds until the cloth's edges hold. This is the main blocker for "route" as a drape.
2. **Height for women in the embed.** Decide whether a women's 3D body takes the typed height. Without it the stature finding does not reach a shopper. With it, every women's bundle moves, and the known limits of the typed body apply.
3. **A too-small size is still drawn stretched.** The AU 12 body in AU 8 shows a 92 cm bust ring stretched to 98.7. The not-drawn rule covers sewn tops only (men's tee report, open issue 4).
4. **The underbust is not a fit point.** The advice reads the bust alone. A seam shorter than the underbust it must close on is not checked; a pull-on dress would need the skirt's band check at the seam.
5. **Bodice length, strap and neckline are not graded on the device** (±0.5 cm here). A larger spread between sizes would need the seam level in the grading.
6. **The mannequin's bust-to-armpit band** (3.8 cm, widening above the bust) limits where any strap garment's top edge can lie.
7. **Likeness.** One real strap dress taped flat, built, and compared with its photos.
8. Not built: a sweetheart or V neckline, a lower back, adjustable straps, tiers, a print, an elastic or shirred seam.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
# the bundle (out/synthetic-tape-babydoll-dress/; prints the tape gate and the grading check)
pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts
# tests: tape fill, tape gate at two statures, bundle check; seam loop; the drape at three statures
pnpm --filter @curtain/garment-spike exec vitest run src/pomDress.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/seamLoop.test.ts src/pomDressDrape.test.ts
# software renders and metrics.json (opt-in)
DRESS_SHOTS=/tmp/dress pnpm --filter @curtain/garment-viewer exec vitest run src/pomDressShots.test.ts
# the real stack in Chromium: five sizes, then 156 and 180 cm with the preview switch
node scripts/demo-dress.mjs /tmp/demo-dress
node scripts/demo-dress.mjs /tmp/demo-dress --heights
npm_config_workspace_concurrency=1 pnpm check
```

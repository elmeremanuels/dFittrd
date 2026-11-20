# Head v3 (`neutral-v3`): report, branch `claude/head-v3`

19 Nov 2026. I built head `neutral-v3` behind its own option. It fixes the defects the review found in `neutral-v2`, adds short sculpted hair for both families and has 24.6k triangles instead of 46k. Defaults are unchanged: lighting `classic`, head `neutral`, mesh `egg` in the mannequin package. The `neutral` and `neutral-v2` meshes are byte for byte as before; `headV3.test.ts` pins v2's hashes. Every picture is an ESTIMATE render from headless Chromium on SwiftShader (a software renderer), **not a phone**.

## What was built

- **`packages/mannequin/src/headV3.ts`**, reached with `buildMannequinMesh(m, { head: 'neutral-v3' })`. It uses its own geometry only: hand-written profile curves, smooth bumps and a hand-written hairline. There is no scan, photo, SMPL/FLAME or any other model, and no likeness of anyone.
  - **Lids on grid rows** (`lidWarp`). In each eye, the row nearest each lid is bent onto the lid curve. The rows next to it follow the curve and let it go over six rows. The map is monotone per column, so the grid never folds. A test checks that every eye column has a vertex within 0.05 unit cm of both lid curves.
  - **Quieter eyes.** The opening is lower (upper lid 0.44 / 0.39 cm above the eye centre, against v2's 0.52 / 0.46), so the lid covers the top of the iris. The eyeball is flatter. The iris has no incised ring and the pupil no hole: both are a soft shade.
  - **Under the jaw.**
    - The front turns from the neck into the chin over 7.1 unit cm with a smootherstep (v2: 5.1 cm).
    - The chin's lowest knots start at the chin and slope at about 1 cm per cm.
    - The hard max/min where the jaw meets the tube is now smooth; it caused a crease across the cheek in v2.
    - A painted lift (`JAW_LIFT`, at most 16 % lighter) covers the parts that still face down.
    - The male chin is one wide shape; v2's two bumps read as a dark cleft at phone size.
    - Result: the steepest downward normal in the front of the under-chin is −0.84 (female) and −0.83 (male), against v2's −0.94.
  - **Ears with a back** (`earReliefV3`). Behind the ear, the relief runs into the skull over about 1 cm, so it no longer ends in a wall. The ear also has a rolled rim and a small antihelix ridge.
  - **Short sculpted hair** (`hairV3`), part of the head's own surface: no second shell and no extra triangles.
    - Male: a short crop. Female: a fuller short crop with a lower fringe over the tops of the ears.
    - Both: a side parting on the figure's right, the hair swept across from it, shallow locks, and a taper of up to 3.8 cm at the nape so there is no ledge.
    - The top of the hair is up to 1.6 cm above stature (female) and 0.8 cm (male).
  - **Grid:** 96 rows × 128 columns.
- **`Mesh.hair`** (0..1 per vertex) and, in `packages/garment-viewer`, **`tintHair` / `hairLinear`**. With a skin tone chosen, the hair is a dark brown (`HAIR_HEX #3f3027`) or the skin darkened by `HAIR_SHADE`, whichever is darker per channel. On the grey mannequin the hair is a darker grey. Before this, the hair was only a shade multiplier on the skin, which made it ash-grey on Monk 1 to 3. This is display only, like the skin.
- **`headOf('neutral-v3')`** in the viewer and **`VITE_VIEWER_HEAD=neutral-v3`** in `apps/web` (`viewerHeadFlag`). Anything else still gives the default head.
- **Spike tools**:
  - `spikes/garment-engine/viewer/look-v3-renders.mjs` (sections heads, jaw, phone, neck, frames) and `look-v3-grid.mjs`.
  - The spike page gets `avatarCheck.jawPoints()` for the under-jaw measurement.
  - `apps/web/e2e/lookV2.spec.ts` also shoots the **synthetic spike dress** (`out/aalter-studio-2`). The GPU bundles (azure dress, POM skirt, photo skirt) are not in this checkout, so all garment and embed shots here use the synthetic dress (female) and the synthetic men's tee (male).
- **Tests:**
  - `headV3.test.ts` (10 tests): v2 unchanged, closed parts, ≤ 25k triangles, levels, under-chin slope against v2, lids on rows, eyes, ears, hair, determinism, 130/220 cm.
  - `look.test.ts`: the v2 avatar tests now run for v3 as well, and the hair colour is tested.
  - `avatarFigure.test.tsx`: the build flag.

## Measured (on this machine, SwiftShader)

| | v1 `neutral` (default) | v2 `neutral-v2` | **v3 `neutral-v3`** |
|---|---|---|---|
| Head triangles | 15,808 | 46,464 | **24,576** |
| Whole mesh, female M / male | 30,016 / 30,432 | 60,672 / 61,088 | **38,784 / 39,200** |
| Body alone, throttled phone page (412×915@2x, CPU 4×), ms per frame while turning, median of 7 (first run is a warm-up), `classic` | 91.6 | 122.4 (+34 %) | **103.1 (+13 %)** |
| Same, `neutral-v2` lighting | 97.3 | 131.1 (+35 %) | **111.8 (+15 %)** |
| Mount with the synthetic dress, same page, frames/s while dragging, `classic` | 4.4 | 3.7 | **4.1** |

The under-jaw band is measured down the middle of a head-and-shoulders picture taken from 12° below, from the chin's front to the neck ring's front. The table gives the neck's lightness (CIE L\*) minus the darkest L\* above it; a larger number means a darker band:

| | classic grey | classic Monk 1 | classic Monk 6 | neutral-v2 grey | neutral-v2 Monk 1 | neutral-v2 Monk 6 |
|---|---|---|---|---|---|---|
| female v1 / v2 / **v3** | 51.5 / 24.7 / **16.1** | 53.8 / 18.0 / **11.0** | 47.5 / 23.5 / **15.2** | 19.0 / 11.2 / **4.5** | 26.0 / 15.8 / **6.8** | 17.6 / 10.7 / **4.5** |
| male v1 / v2 / **v3** | 7.3 / 13.8 / **13.9** | 3.5 / 8.5 / **8.9** | 7.2 / 13.1 / **12.8** | 5.7 / 7.4 / **4.4** | 3.5 / 8.9 / **6.4** | 5.2 / 6.5 / **4.5** |

Raw data: `docs/screens/claude-head-v3/look-v3-jaw.json` and `look-v3-frames.json`. Monk 10 bands are 2 to 9 L\* for every head; everything is dark there.

**What I measured and what I assumed**

- The triangle counts are exact.
- The frame times come from a software renderer with CPU throttling, not from a phone GPU. They are only useful as ratios between heads in the same run.
- The band number captures how deep the band is, not how hard its edge is. In the pictures, v2's male band has a crisp upper edge (the strap) and v3's is a gradient. Under `classic`, the depth for the male head is about the same as v2's.
- I did not measure contrast or garment colour for v3. Only the head changed and the lights did not, and v3's skin pixels away from the head are v2's.

## How the pictures look (I looked at each grid)

Grids are in `docs/screens/claude-head-v3/`; there are also `closeups/` and `embed/`.

- **`heads-*-views` (front, three-quarter, side, back, from below).**
  - v3 reads as a finished shop-window mannequin with sculpted hair. The female hair (side-swept, with a fringe) reads as a short women's crop. The male hair is a short crop, but from the front its straight hairline makes it a little cap-like.
  - From behind, the ears slope into the head instead of standing out as plates. The female crop covers their tops.
  - The nape has no ledge.
  - The faces are v2's faces. The female face still reads somewhat masculine, and the male face is boxy with a slit mouth. Neither was in scope; I did not change them.
- **`closeups/eyes-v2-left-v3-right.png`** (2× close-up).
  - The lash line and the lid margins run smooth along a row; v2 had steps.
  - A few small steps remain at the outer upper lid and the lower lid's outer end, where the row bending fades out.
  - The iris is a soft disc partly under the lid, no longer a ringed doll's eye.
  - The lower-lid line is a little heavy, which reads as slightly tired.
- **`heads-*-tones`.**
  - Monk 1 to 6: the brown hair reads as hair.
  - On Monk 1 and 3 there is a greyish fringe where the hair cover blends into very pale skin at the temples and sideburns. This is a linear mix between brown and pale skin.
  - Monk 9 and 10: the hair, eyes and brows nearly vanish into the skin, as they did with v2 (they are shades of an already dark skin).
- **`jaw-*`.**
  - v2's male head under `classic` has a hard dark strap under the jaw. On v3 it is a soft gradient with no edge.
  - Under `neutral-v2`, v3 shows only a faint shadow on both families.
  - Under `classic`, v3's male head is still clearly darker under the jaw than v1's, whose smaller jaw barely overhangs. It reads as shadow, not as a strap, but it is there.
- **`phone-*`** (whole figure at 390×760, plus head crops).
  - At phone size v3 is the clearest of the three: the hair gives the figure a finished head, and the chin strap is gone.
  - At this size the hair reads as a dark cap on the male figure.
- **`neck-*-bodies-*`** (mount, 4×).
  - Largest girths: v3's jaw shows a soft arc where v2's showed a band.
  - 130 cm: both v2 and v3 look "muzzled". The lower face is pinched and the neck is as wide as the cheeks. This is **not** the head's tube. The head is 13 % of stature (about 17 cm on a 130 cm body) while the neck keeps an adult girth, and the neck fit narrows the neck only to 0.9 of the jaw.
  - I tried a narrower tube-to-head band in the viewer. It did not help at 130 cm and put a collar ridge on the largest body, so I reverted it.
- **`neck-*-views`** (body alone, front, side, back).
  - The light ring at the base of the neck that an early v3 had (too few rows at the tube's end) is gone.
  - From behind, a soft horizontal shading band remains on the neck. v2 male had a hard line there; v3's is softer, but it is visible at 4×.
- **`embed-synthetic-dress*`** (the real embed, production build, 360×740 @2x; one build per column: `classic`+v1, `classic`+v2, `classic`+v3, `neutral-v2`+v3).
  - The estimate label is present.
  - v3 looks the most finished. v2's strap shows under the head in the `classic` column; v3 has none.
  - The hair on Monk 9 and 10 merges with the skin.

## Open issues

1. Under `classic`, the male under-jaw is still darker than on v1. It is softer than v2 but measures about the same depth (13 to 14 L\*). Under `neutral-v2` it is fine (4 to 6 L\*).
2. Short bodies (130 cm) get a small head on an adult neck, the "muzzle". This needs a decision in the body proportions (should the head scale less than stature?), not in the head.
3. Hair on very pale skin has a greyish edge. Hair on Monk 9 and 10 is nearly invisible. Eyes and brows on Monk 9 and 10 vanish, as in v2.
4. The male crop's straight front hairline reads slightly cap-like.
5. There are faint shading bands at the back of the neck, and small residual lid steps at the eye corners in close-ups.
6. Hair adds up to 1.6 cm above stature. Garments and fit are unaffected, but the top of the figure is that much taller in the frame.
7. I have not measured on a real phone GPU. Frame cost: v3 is +13 to 15 % over v1 in the software renderer (v2 was +34 %).

## Verdict: is v3 good enough to become the default?

**Not as the default on its own yet; it is ready for the founder's look review as the candidate default.**

- **Better:** at phone size v3 is better than v1 and v2 on every point the review named. The lids are smooth, the eyes no longer look like a doll's, there is no hard chin strap, the ears have a back, it has hair, and it costs 53 % of v2's triangles and about 13 % frame time over v1 instead of v2's 34 %.
- **Still against it:**
  - Under today's `classic` lighting the male head keeps a soft dark zone under the jaw, darker than v1's.
  - The 130 cm "muzzle" and the near-invisible hair and eyes on the darkest tones are not solved.
  - Hair is a visible change to every avatar, so the founder should see it before it ships.
- **My recommendation:** make v3 the default together with `neutral-v2` lighting, after the founder approves the grids and after one check on a real phone.

## Reproduce

```sh
pnpm install --frozen-lockfile && pnpm build:packages
# Synthetic bundles (no GPU), and a payload.json for the dress
pnpm --filter @curtain/garment-spike build:bundle -- --skip-separation
cd spikes/garment-engine && npx tsx -e "import {spikeProduct} from './src/product'; import {writeFileSync} from 'node:fs'; writeFileSync('out/aalter-studio-2/payload.json', JSON.stringify(spikeProduct('aalter-studio-2'),null,2))" && cd ../..
# Close-ups, jaw measurement, phone and neck shots (about 1.5 h on 4 cores), then frame cost alone (about 20 min)
node spikes/garment-engine/viewer/look-v3-renders.mjs /tmp/v3 --only heads,jaw,phone,neck
node spikes/garment-engine/viewer/look-v3-renders.mjs /tmp/v3-frames --only frames
# The real embed, one build per look (port 4179 so a running preview is not reused)
cd apps/web
for cfg in "classic-v1::" "classic-v2::neutral-v2" "classic-v3::neutral-v3" "neutral-v2-v3:neutral-v2:neutral-v3"; do
  IFS=: read label light head <<< "$cfg"
  env ${light:+VITE_VIEWER_LIGHTING=$light} ${head:+VITE_VIEWER_HEAD=$head} pnpm build
  E2E_PORT=4179 LOOK_SHOTS=/tmp/v3 LOOK_LABEL=$label pnpm exec playwright test -c e2e/playwright.config.ts e2e/lookV2.spec.ts -g synthetic --trace off
done
cd ../.. && node spikes/garment-engine/viewer/look-v3-grid.mjs /tmp/v3 /tmp/v3/grids
# Unit tests
pnpm --filter @curtain/mannequin test && pnpm --filter @curtain/garment-viewer test
```

`LOOK_HEADS=neutral-v3` renders only v3. `LOOK_QUICK=1` renders `classic` only, with no tone rows: a quick look while changing the head.

# Male 2D figure v2 (branch `claude/male-2d-v2`)

19 Nov 2026. Pictures are in `docs/screens/claude/male-2d-v2/`: `offline/` holds the 2D figure on its own and `stack/` holds the real stack, with the 2D figure next to the 3D view.

## What changed

- **The male 2D figure can follow the 3D male body v2.** The option is `bodyGeometry(m, h, 'male', { maleShape: 'v2' })` (`apps/web/src/render/body.ts`). It mirrors `buildMannequin(shape, { maleShape: 'v2' })`. Without the option, or with `'v1'`, the male figure is the M1b figure, byte for byte. The female figure ignores the option.
  - **Seat:** this is the v2 seat, narrower than v1. At M it is 32.1 cm across, not 36.2. The seat falls straight to the thighs.
  - **Crotch line:** the legs sit in under the seat (the v2 leg centres) and touch below the crotch. Their top edges meet in one shallow V, from the hip down to the crotch. The inner thigh line is one line in the middle, down to where the thighs part. The torso ends on that V, so the figure has no second line and no ledge.
  - **V taper:** the lats widen the torso at the armpit (ANSUR axilla height), past the chest. From there the torso narrows over a new underbust station to the waist, then to the narrower seat.
  - **Trapezius and deltoids:** the neck runs straight up to the v2 neck ring. A straight trapezius slope (the v2 one) runs down to the shoulder point under the deltoid cap. The caps sit at the v2 breadth over the deltoids, which is 0.1 cm over ANSUR.
  - **Chest and back profile:** a front view has no depth. The v2 profile reaches the 2D figure through its widths. These are the front-view breadths of the v2 superellipse sections, not of ellipses.
- **Numbers.** `MALE_V2_FIGURE_TABLE` in `render/maleBody.ts` holds ratios per size, measured on the v2 mesh. `packages/mannequin/scripts/measure-male-v2-front.ts` prints them. Because they are ratios, a typed body scales the way the 3D body scales its rings, and `maleV2RowAt` interpolates them by chest girth.
  - The chest, waist and seat ratios are written as effective depth/width ratios for the 2D width rule, `girth / (π(1 + r))`. That way the body, its garments and its size rings keep one rule, and `rings.ts` is unchanged.
  - These ratios are not the real depth/width of the v2 sections.
- **Garments on v2:**
  - Trouser legs, shoes and socks use the v2 leg centres (`BodyGeometry.legX`).
  - A sleeve's armpit uses the lats width.
  - The tee follows the narrower seat.
- **One switch:** `VITE_MALE_SHAPE=v2` (`maleShapeFlag` in `apps/web/src/embed/look.ts`; default and anything else gives `v1`). One build flag drives all three:
  - `Garment3D` sends `maleShape: 'v2'` to the viewer for a male body, which builds the v2 3D body.
  - `ResultScreen` gives the same value to the 2D figure (`AvatarView maleShape`).
  - The same value goes to the size rings (`ringOverlayFor`).

  So 2D and 3D cannot show different bodies. When v2 is on, the figure's SVG carries `data-male-shape="v2"`. When it is off, nothing changes.
- **`scripts/demo-men.mjs --male-shape=v2`** builds the web app with the switch on. With the switch on, it fails unless the figure next to the male 3D view is marked v2. Without the switch, it fails if the figure is marked. It also shoots the 2D figure in the body's own size (`--6-2d-own-size-<size>`), next to the 3D turn shots.
- **Tests:**
  - `maleFigureGolden.test.tsx` was written on the unmodified code (first commit, 12f47e5). It holds sha256 goldens of the v1 male figure: 8 bodies; the men's tee, the chino and every mock garment; AvatarView in 4 skins, compact, plain and loading; the size rings for every size of the tee and the chino.
  - `maleFigureV2.test.tsx` rebuilds the v2 meshes S to XXL from the package source and measures the drawn SVG outline against them.

## Measured vs assumed

**Measured** (this container):

- **2D v2 against the 3D v2 mesh, cm** (`maleFigureV2.test.tsx`).
  - Method: the drawn outline, with its Bézier curves flattened, cut at the mesh's heights, against the largest |x| of the mesh's loops at the same heights.
  - Breadths are full widths. The thigh and knee columns are the leg's outer edge from the middle. Each cell is 2D / 3D.
  - Every value is within **0.08 cm**. The test allows 0.5.

  | Size | Trapezius (mid) | Armpit (lats) | Chest | Underbust | Waist | Seat | Thigh ring | Knee | Leg centre | Over the deltoids |
  |---|---|---|---|---|---|---|---|---|---|---|
  | S | 25.8 / 25.7 | 34.0 / 34.1 | 31.6 / 31.6 | 29.6 / 29.7 | 27.8 / 27.8 | 30.7 / 30.7 | 15.6 / 15.6 | 13.8 / 13.8 | 7.8 / 7.8 | 46.1 / 46.1 |
  | M | 27.2 / 27.1 | 36.8 / 36.8 | 34.2 / 34.2 | 32.2 / 32.1 | 30.3 / 30.4 | 32.1 / 32.1 | 16.4 / 16.4 | 14.3 / 14.3 | 7.9 / 7.9 | 48.6 / 48.6 |
  | L | 28.4 / 28.3 | 39.5 / 39.5 | 36.7 / 36.7 | 34.7 / 34.6 | 32.9 / 32.9 | 33.8 / 33.8 | 17.3 / 17.3 | 15.0 / 14.9 | 8.2 / 8.2 | 51.1 / 51.1 |
  | XL | 29.6 / 29.6 | 42.1 / 42.1 | 39.2 / 39.2 | 37.1 / 37.1 | 35.4 / 35.4 | 35.5 / 35.5 | 18.4 / 18.4 | 15.7 / 15.7 | 8.7 / 8.7 | 53.6 / 53.6 |
  | XXL | 31.3 / 31.2 | 45.1 / 45.1 | 41.9 / 42.0 | 39.9 / 39.9 | 38.3 / 38.3 | 37.2 / 37.2 | 19.7 / 19.6 | 16.7 / 16.7 | 9.3 / 9.3 | 56.6 / 56.6 |

  - Before this branch, the v1 2D figure next to the v2 body was off at the seat by 4.1 cm at M (36.2 against 32.1) and 4.2 cm at XXL (41.4 against 37.2), as the male-shape-v2 report notes. The chest and waist were off by up to 1.6 cm. Those are the mismatches closed here.
  - The other checks are in the same test:
    - the v2 seat is at least 1.5 cm narrower than v1 in every size;
    - the armpit is wider than the chest, which is wider than the underbust, which is wider than the waist;
    - the breadth over the deltoids is more than 1.45 × the seat;
    - the legs touch;
    - the size rings sit on the v2 body;
    - trouser legs sit on the v2 leg centres.
- **v1 male and female figures unchanged with v2 off:**
  - The new v1 male golden and the existing female golden pass.
  - Pixel comparison: 379 figures were rendered once with the base code (8a03583) and once with this branch. They are all 164 female figures (every mock garment, four bodies, with fit) and 215 v1 male figures (S to XXL in every mock garment, the tee and the chino). The markup is identical in 379 of 379. The 2× screenshots (10 sheets of 4000 × 2000 px, 152,000,000 pixels in all) differ in **0** pixels.
  - Sample: `offline/05-pixel-identity-sample-branch.png`.
- **Real stack:** `demo-men.mjs --all-sizes` ran in headless Chromium with SwiftShader at 390 × 760 CSS px, 2×. That is a software renderer, not a phone. The results are under "Real stack" below.

**Assumed (not measured):**

- Everything assumed for the 3D v2 body (`MALE_V2_ASSUMPTIONS`: relief sizes, lats +8 %, the chest exponent cap, the thigh-top size, the gluteal fold) carries over, because the 2D ratios are measured on that body.
- What the 2D figure adds on its own:
  - the crotch-line V starts 40 % of the way from the seat ring to the crotch;
  - the leg below the thigh ring keeps the v1 figure's own points (0.95 × thigh half-width at the figure's thigh level);
  - the inner edges stop 0.4 px off the middle, so their two strokes meet;
  - the deltoid cap is the v1 cap, a semicircle at the v2 breadth.
- The 2D levels are the package's fixed `MALE_LEVELS`. The armpit, neck ring and thigh ring come from the v2 ratio table. The crotch stays at the M row's inseam, as in M1b.
- A typed body interpolates the measured ratios by chest girth. Only the five table rows were measured against a mesh.
- The ANSUR and EN 13402 assumptions of the male table are inherited.

## How it looks (honestly)

- `offline/01-bare-<size>-v1-vs-v2.png`, `03-bare-S-to-XXL-v2.png`:
  - v2 reads more male than v1. The shoulders slope from the neck in a straight line, and the torso narrows from the armpit to the waist (a visible V).
  - The seat is no wider than the waist plus a little. v1 flares at the seat, which read slightly feminine.
  - XL and XXL now carry their girth in the waist, not the hips.
- `offline/11-closeup-<size>-seat-and-crotch-v1-vs-v2.png`:
  - The crotch is one shallow V with one inner thigh line, and no hole.
  - A small nub shows at each hip corner, where the torso's smoothed outline meets the leg's straight top edge.
  - The V reads a little like the top line of briefs. The v1 figure has a similar horizontal line.
- `offline/10-closeup-<size>-shoulders-v1-vs-v2.png`:
  - The neck meets the trapezius with a small flare, much like v1's kink.
  - The arms' inner outlines still cross the torso from the cap to the armpit, as on v1 and on the female figure.
- `offline/02-tee-<size>-v1-vs-v2.png`, `04-tee-S-to-XXL-v2.png`: the tee's hem now follows the narrower seat. Inside the phone frame the change is subtle once the tee covers the torso: shoulders, seat and legs show it, the chest much less.
- `offline/13-chino-<size>-v1-vs-v2.png`: the trouser legs sit on the v2 leg centres. The two legs overlap a little in the middle at the crotch, as the body's legs do.
- Still the same 2D mannequin: no hands, no muscle drawing, front view only.

## Real stack

`node scripts/demo-men.mjs --all-sizes --male-shape=v2`, then the same without the flag. Both ran the M3 synthetic men's tee bundle, gate on, and both exited 0.

- **Switch on:**
  - The tee settled on the male 3D body for all five bodies, in S, M, L, XL and XXL.
  - In every one, the figure beside the 3D view was `data-figure="male"` and `data-male-shape="v2"`, and carried "Estimate · not measured" and "Body from your answers".
  - The men's shirt without a bundle still shows coming soon.
- **Switch off:** the same five, with figures that carry no `data-male-shape`, as before this branch.
- **Pictures:**
  - `stack/20-<size>-2d-next-to-3d-v2.png`: the 2D figure next to the 3D front, with side and back under it.
  - `stack/21-S-to-XXL-2d-next-to-3d-v2.png`: all five, the 2D figure over the 3D front and side.
  - `stack/30-<size>-v1-vs-v2-2d-and-3d.png`: switch off against switch on, 2D and 3D.
  - `stack/40-…`: the 2D figure alone. `41-M-page-v2.png`: the settled page.
- **How it looks:**
  - With the switch on, both views narrow at the seat together. The tee's hem and the legs line up between 2D and 3D, where v1 2D against v2 3D did not.
  - In 3D the v2 body's straighter hips and the legs under the seat are clear at XL and XXL.
  - Inside the phone frame the 2D change under the tee is modest: shoulders, seat and leg spacing show it.
  - The 3D tee is still the M3 synthetic tee draped on the v1 body (see open issues), so its hem on v2 is the one the male-shape-v2 report describes.

## Open issues

- **The switch stays off.** v2 should not be turned on for shoppers until every male bundle is draped on the v2 body. Today's bundles are draped on v1; the viewer only borrows the v1 twin for the collision exemption (see male-shape-v2.md). The 2D side no longer blocks it.
- `spikes/garment-engine`, `mannequinFor` and `build:assets` still build the v1 male body. That was not touched (another session works on the tee drape).
- The fit list and the 3D chips still say "Bust" for a men's product (M2a, fit engine); only the 2D ring says "Chest".
- The nub at the hip corners and the neck flare. Both are small; fixing them means changing the smoothing, which is not worth doing before the founder has looked.
- The ratio table is measured on the five table bodies only. A typed body far outside S to XXL is held at the end rows, as the 3D ring fits are.

## Commands

```sh
git checkout claude/male-2d-v2
pnpm install --frozen-lockfile
pnpm build:packages
pnpm --filter @curtain/web exec vitest run src/__tests__/maleFigureV2.test.tsx src/__tests__/maleFigureGolden.test.tsx src/__tests__/femaleFigureGolden.test.tsx src/__tests__/maleFigure.test.tsx
pnpm --filter @curtain/mannequin exec tsx scripts/measure-male-v2-front.ts        # the ratio table (and --v1)
pnpm --filter @curtain/garment-spike build:bundle                                 # the synthetic men's tee (M3)
node scripts/demo-men.mjs test-results/male-v2 --all-sizes --male-shape=v2        # switch on
node scripts/demo-men.mjs test-results/male-v1 --all-sizes                        # switch off
npm_config_workspace_concurrency=1 pnpm check
```

The pixel comparison was a one-off scratch harness and is not committed. It rendered the same 379 `AvatarView` SVGs with `git show 8a03583:<file>` swapped in for `render/body.ts`, `render/maleBody.ts`, `render/rings.ts` and `components/AvatarView.tsx`. It took Playwright screenshots at 2× and diffed them with PIL `ImageChops.difference` (bounding box `None`). The committed goldens are the lasting proof.

# @curtain/mannequin

The canonical mannequin v0 (`docs/ENGINE-HANDOFF.md` §The canonical mannequin, D14, D15): a procedural A-pose body in two families (female: three shapes, male: five), lofted in pure TypeScript through the anchor rings of `@curtain/anchors`, plus the fixed camera paths, the one motion clip and a minimal glTF 2.0 binary writer. Deterministic: the same shape always gives the same bytes. The only runtime dependency is `@curtain/anchors`.

## Run

```sh
pnpm --filter @curtain/mannequin build          # tsup → dist/
pnpm --filter @curtain/mannequin build:assets   # writes out/ (gitignored), see below
pnpm --filter @curtain/mannequin preview        # out/preview/families-M.png: female M and male M, front and side (committed copy: preview/families-M.png)
pnpm --filter @curtain/mannequin exec tsx scripts/render-male-v2.ts <dir> --head   # male v1 and shape v2, S…XXL, four views (PNG panels)
node packages/mannequin/scripts/compose-male-v2.mjs <dir> <out>                  # the panels at phone size (Playwright)
pnpm --filter @curtain/mannequin test
pnpm --filter @curtain/mannequin typecheck
pnpm --filter @curtain/mannequin lint
```

`build:assets` writes, per female shape, `out/<shape>/mannequin.glb` (metres, mid-grey), `out/<shape>/anchors.json` (cm), `out/<shape>/camera-paths.json`, plus `out/motion-clip.json` and `out/manifest.json` with the sha256 of every file. Male shapes get the same three files under `out/male/<shape>/`; their `anchors.json` carries `"family": "male"`. A file without `family` is a female shape, so every v0 file and bundle stays valid.

## Conventions

- Mannequin space: +Y up, +Z front (the mannequin faces +Z), +X the mannequin's left. Centimetres everywhere except the .glb, which is in metres (glTF).
- A ring is an ellipse `centre + a·sin(t)·u + b·cos(t)·v` in the plane with `normal`; `a` is the half-width, `b` the half-depth (same as `ellipseRingPoints` in `@curtain/anchors`). Torso rings lie in horizontal planes; leg rings are horizontal on the left leg; arm rings are perpendicular to the left arm axis. Mirror X for the right side.
- `morphHeights` are the positions to pass to `gradingMorph(…, { heights })`: the height above the floor for the body chain, the distance from the shoulder joint along the arm for the arm chain.

## Shapes: female family (v0)

| Shape | Stature | Chest | Waist | Hip |
| --- | --- | --- | --- | --- |
| XS | 164 | 80 | 62 | 88 |
| M | 168 | 92 | 74 | 100 |
| XXL | 170 | 116 | 98 | 122 |

Chest, waist and hip sit inside the EN 13402-3 size intervals and match the body charts in the `@curtain/schema` fixtures (for example `aalter-studio-1`, size M: 92 / 72 / 100; graded charts step 4 cm per size). The other nine girths are representative proportions, flagged `source: "proportion"` in `anchors.json`. v0 is a geometry fixture for the pipeline, not an anthropometric reference. Phase 1 swaps in a measured table with 5 shapes behind the same interface.

## Shapes: male family

`family: 'male'`, sizes S, M, L, XL, XXL (`MALE_REFERENCE`, cm). Same generator, same 12 rings, same rig and camera paths.

| Size | Chest | Waist | Seat (hip) | Shoulder width | Over deltoids | Height | Inseam | Neck |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S | 90 | 78 | 90.5 | 40 | 46 | 172.5 | 83.5 | 37.5 |
| M | 98 | 86 | 96 | 40.5 | 48.5 | 174 | 84 | 39.5 |
| L | 106 | 94 | 102 | 41.5 | 51 | 175.5 | 84.5 | 41.5 |
| XL | 114 | 102 | 108 | 42.5 | 53.5 | 177 | 85 | 43.5 |
| XXL | 123 | 111 | 114.5 | 43.5 | 56.5 | 179 | 85.5 | 45.75 |

**Sources (read 13 Nov 2026, read again at source 14 Nov 2026).**

- **Chest, waist, neck: EN 13402-3:2004 as reproduced on Wikipedia, not the standard** (`MALE_SOURCES.en`; wherever this README or the code says "EN" for the male family, it means this reproduction). Chest and waist in 4 cm steps at drop −12 cm, the neck girth the standard associates with each chest girth, and the letter intervals (S 86–94, M 94–102, L 102–110, XL 110–118, XXL 118–129). Each letter size takes the midpoint of the two steps it combines. The standard itself is sold by CEN members and was **not** read: the values were read from the tables of the Wikipedia article "Joint European standard for size labelling of clothes" (article text CC BY-SA 4.0; only numbers were taken, no text). The article cites BS EN 13402-3:2004; the 2013 and 2017 editions were not read, and neither was ISO 8559. The product must not call this ladder "EN 13402" until a bought copy of the current standard has been checked.
- **Everything else: ANSUR II**, the 2012 Anthropometric Survey of U.S. Army Personnel (report NATICK/TR-15/007). Licence as read at source: the report's cover and its box 12 "Distribution / availability statement" both say "Approved for public release; distribution is unlimited" (PDF linked from the page below, opened 14 Nov 2026). The download page itself states no licence. A work of the U.S. Government is public domain in the United States; that is an inference from the report's origin, not a sentence in it, it says nothing about other countries, and two of the report's authors work for a contractor (Anthrotech). This package ships statistics derived from the file (five rows of rounded regression values), not the file or the report. File `ANSUR_II_MALE_Public.csv` (4082 men) from https://www.openlab.psu.edu/ansur2/, sha256 `0547aea0…caac64` (full hash in `scripts/derive-male-table.ts`); for the female shoulder reference only, `ANSUR_II_FEMALE_Public.csv` (1986 women, same page, sha256 `ed7e800a…1d757a`). Neither file is in the repo. Per size, each value is the least-squares line of the measure on chest girth over all 4082 men, at the size's chest girth, rounded to 0.5 cm. `scripts/derive-male-table.ts <male csv> [<female csv>]` prints the table again.
- No SMPL, SMPL-X, Anny or other body model, and no scan, is used.

**The two sources do not measure the same waist or the same neck, and their chest is assumed, not shown, to be the same.** The table uses the EN values for all three; ANSUR does not confirm them.

- Chest: every ANSUR column is a line on ANSUR's chest circumference, read off at the EN chest girth. That treats the two as one measurement. Both are the maximum horizontal girth of the chest. EN (EN 13402-1 as quoted in the same article): normal breathing, tape over the shoulder blades, under the armpits and across the chest. ANSUR II (NATICK/TR-15/007, measurement 24, read 14 Nov 2026): at the level of the most forward point of the chest ("chest point, anterior"), at the maximum of quiet breathing. The tape level and the breathing phase can differ; the offset is **assumed zero and was not measured**. If EN's chest reads larger than ANSUR's on the same man, every ANSUR column here is that much too large for its size.

- Waist: EN means the natural waist, between the top of the hip bones and the lower ribs. ANSUR's only waist girth is at the navel (omphalion), lower on the body: 76 / 85 / 94 / 103.5 / 113.5 at the five chest girths. That these land within 2.5 cm of the EN waist is not a check of the EN drop. The mesh puts the waist ring at the natural-waist level (0.621 of stature), not at the navel (0.602). The depth / width of that ring (0.68–0.76) is still ANSUR's at the navel: ANSUR has no breadth or depth at the natural waist.
- Neck: EN measures 2 cm below the Adam's apple and at the seventh cervical vertebra, so low and slanted. ANSUR's neck girth is at the Adam's apple, perpendicular to the neck's axis (36 / 38 / 40 / 41.5 / 44, 1.5 to 2 cm under EN); its second girth is at the base of the neck (mean 43.5). The EN value lies between the two. Definitions read in NATICK/TR-15/007, measurements 62 and 63.

**Limits of the table.** ANSUR II is a military sample (young, fit, U.S.). It is not the civilian or the European population. Stature and inseam hardly follow chest girth (r = 0.25 and 0.12), so their steps per size are small. XS and 3XL are left out: 22 and 20 men in the sample.

**How the mesh uses it.**

| Ring or length | Value | `source` |
| --- | --- | --- |
| chest, waist, neck | EN 13402-3:2004 as reproduced on Wikipedia | table |
| hip, thigh, calf, ankle, wrist | ANSUR II | table |
| chest, waist, hip depth / width | ANSUR depth over breadth at that size (chest 0.79–0.95, waist 0.68–0.76, hip 0.66–0.76) | |
| shoulder | Width set so that the breadth over the deltoids (`deltoidBreadthCm`) equals ANSUR's bideltoid breadth; depth an **assumed** 0.55 of the width | proportion |
| underbust | 40 % of the way from chest to waist girth | proportion |
| knee | ANSUR has no knee girth: the lower-thigh girth stands in | proportion |
| upper arm | ANSUR measures the biceps flexed: an **assumed** 0.93 of it | proportion |
| thigh depth / width | **assumed** 1.2 (deeper than wide, so two thighs fit the hip) | |
| levels | knee 0.278, hip 0.506, waist 0.621, chest 0.735 of stature (ANSUR); crotch = inseam / stature; shoulder ring 0.811 (1.6 cm under ANSUR's acromial height) | |
| arm and head proportions | the generator's own, as for the female family. ANSUR's sleeve outseam at M is 59 cm, the mesh's sleeve line 57.8 cm | |

**Tolerances, checked by the unit tests (`src/families.test.ts`).** Every one of the 12 rings measured on the mesh is within 0.5 % of its table girth (measured: under 0.001 %). Stature, inseam and the breadth over the deltoids are within 0.05 cm of the table. Every part is closed, manifold and consistently oriented, 14.9–16.0k triangles. The arms clear the torso at the chest, underbust and waist rings in all five sizes (by 1.2 cm at XXL).

**What the ellipse cannot do.** Every section is an ellipse with the table's girth. A real torso is boxier, so an ellipse of the right girth is wider and deeper than the body: the mesh's waist and hip are 6 to 9 % over ANSUR's breadth and depth, the chest about 22 % (M: 33.8 × 28.4 cm against 27.7 × 23.2 cm measured). Girths are right; widths and depths are not measured values.

### Licence record (for `docs/LICENSES.md`, which this track may not edit)

| Source | What is used | Licence as read at source | Open point |
| --- | --- | --- | --- |
| ANSUR II working databases (male, female), U.S. Army Natick Soldier RD&E Center, hosted at openlab.psu.edu/ansur2 | Derived statistics only: five male rows of rounded regression values, six levels, three female shoulder widths. No file, no row of a person. | Report NATICK/TR-15/007: "Approved for public release; distribution is unlimited" (cover and box 12). That statement is on the report. **Neither the CSV files nor the download page carry a licence.** | "Public domain" is an inference (U.S. Government work, 17 U.S.C. §105), holds for the United States only, and two authors are contractor staff. Question for Naomi: is shipping statistics derived from ANSUR II fine in the EU? Until answered, product and marketing text must not call the data "public domain". |
| Wikipedia, "Joint European standard for size labelling of clothes" | Numbers of the EN 13402-3:2004 men's tables (chest and waist steps, drop, neck association, letter intervals). No text. | Article text CC BY-SA 4.0. The standard is copyright CEN / national bodies and sold; it was not read. | Buy and check EN 13402-3:2017 before any product text names EN 13402. |

## Families: API and the contract for the viewer and the 2D figure

```ts
import { buildBody, buildMannequinMesh, familyShape, referenceMeasurements, shapeForBody } from '@curtain/mannequin';

familyShape('male', 'L');            // a table size (BodyShape) or undefined
familyShape('female');               // the family's base size: female M, male M
referenceMeasurements(shape);        // { family, heightCm, chestCm, waistCm, hipCm, shoulderCm, inseamCm, neckCm }
const m = buildBody({ family: 'male', heightCm: 182, shoulderCm: 42, bust: 102, waist: 90, hip: 100 });
const mesh = buildMannequinMesh(m);  // closed mesh, rings exact, same Mannequin interface as before
```

`BodyInput` is the shape of `MountOptions.body` in `@curtain/garment-viewer` (wired 14 Nov 2026: `family`, `heightCm`, `shoulderCm` and `chest` next to the three girths, see that package's README) and the intended shape of the 2D figure's props (not wired by this package). D20 point 3 stands above this contract: a male body from this package does not make a men's product ready. A men's garment goes live only with the male body, a 3D drape built on it and men's fit points together; until then the product shows "Men's clothing: coming soon", and the male 2D figure alone is never the men's experience.

```ts
interface BodyInput {
  family: 'female' | 'male';
  heightCm?: number;    // stature
  shoulderCm?: number;  // shoulder width, see below
  bust?: number;        // chest girth; the wire name of the fit point stays `bust` for everyone
  chest?: number;       // the same measurement; wins over `bust` when both are given
  waist?: number;
  hip?: number;         // seat girth
}
```

Rules of `shapeForBody(input)`:

- Only `family` is required. A value that is missing, not finite or not positive is filled from the family's table at the given chest girth; with no chest girth, from the base size. With no measurement at all the result is the family's base shape, byte for byte; with the measurements of a table size it is that size. An unknown `family` is read as `female` (today's figure, as the plan asks for "not specified").
- Chest, waist and hip are the typed girths. Neck, upper arm and wrist follow the table by chest girth, the leg rings by hip girth. The underbust keeps its place between chest and waist.
- `heightCm` scales every level and length, the inseam included. Girths do not change with height.
- `shoulderCm` moves the shoulder ring by the difference to the family's reference shoulder width at that chest girth, 1 cm for 1 cm, bounded to 0.75–1.35 times the table's ring.
- **Bounds (`BODY_INPUT_LIMITS`).** A typed chest, waist or hip is held between 0.7 times the family's smallest size and 1.5 times its largest (male chest 63–184.5 cm), a typed height between 130 and 220 cm. Beyond the table's chest range the depth / width ratios, the default stature and the crotch level stay at the nearest table size; nothing is extrapolated, so no torso section gets deeper than wide. Values outside the bounds are drawn at the bound, not rejected: an adopter that wants to refuse them must check against `BODY_INPUT_LIMITS` itself.
- **Arms.** The shoulder ring is never narrower than what keeps the A-pose arms 0.5 cm outside the chest, underbust and waist rings (`armClearanceCm`). A large chest or a narrow typed shoulder width therefore widens the shoulders (male M: a typed 30 cm is drawn at 0.87 of the table ring, not 0.75). The arms can still touch the hips of a very large seat; that is not checked.
- **`shoulderCm` means the straight distance between the two shoulder points** (biacromial breadth), in both families, and the reference is ANSUR II at the shape's chest girth: male 40–43.5 cm (`MALE_REFERENCE`), female 35.5 / 36.5 / 38 cm at XS / M / XXL (`FEMALE_SHOULDER_REFERENCE`, 1986 women; the sample mean is 36.5 cm). A woman who types her measured 36.5 cm at chest 92 gets the default figure. The reference is not the width of the mesh: the female v0 shoulder ring is 42.1 cm at M and its breadth over the deltoids 50.2 cm, against 44.3 cm measured (ANSUR female bideltoid at chest 92), so **the female figure is about 6 cm too wide at the shoulders at every typed width**; that is a fault of the v0 mesh and is not corrected here (its bytes are pinned). A tape laid across the back reads more than the straight distance; this package does not convert.
- The id of such a shape is `custom`. The result is a plain `BodyShape`: `buildMannequin(shape)` gives rings, `morphHeights`, `torsoAt` / `legAt` / `armAt`, joints and length lines exactly as for a table shape, so the viewer's collision field and grading morph work on it unchanged.

What the adopters must do themselves:

- **Viewer (`body.ts`, `mount.ts`).** Pick the base with `familyShape(body.family)` instead of `bodyShape(BASE_SHAPE_ID)`. Either keep morphing the base mesh by chest, waist and hip as today, or build the body directly with `buildBody(body)`; only the second honours `heightCm` and `shoulderCm`.
- **Drape guard.** A bundle records `mannequin: { version, shape }` and no family. Every bundle today is female M. Show the 3D drape only when the drawn family equals the bundle's family; read a missing family as `female`. `anchors.json` of a male shape carries `family: 'male'` for the bundles to come.
- **Ring heights.** Use `mannequin.morphHeights`, never `NOMINAL_RING_HEIGHTS × stature`: the male rings sit at other levels (crotch 0.483 of stature against 0.455).
- **2D figure.** `referenceMeasurements(familyShape('male'))` and `mannequin.rings` (width `2a`, depth `2b`, height `centre[1]`) give a male silhouette from the same numbers.

## How the male M body reads (looked at, 13 and 14 Nov 2026)

`pnpm --filter @curtain/mannequin preview` renders female M and male M, front and side, at one scale. A committed copy is `preview/families-M.png` (female left, male right).

**Verdict: not yet acceptable to show a shopper as a man.** It is a geometry fixture with the right girths. Before it is shown it needs boxier (superellipse) chest and seat sections, so that the right girth no longer forces the chest and hip too wide and too deep, and a joined crotch. Both are built in male shape v2 (below, opt-in); the default body described here is unchanged. The unit test states the same: the shoulder ring is 5 to 15 % wider than the hip ring (a box), and shoulder against hip does not separate the families.

- It reads as a different, male-leaning figure next to the female one: 6 cm taller, legs 7.6 cm longer, a thicker neck, a straight torso with no waist (waist / hip width 0.89 against 0.73) and no swelling at the chest (chest to underbust girth −5 cm against −14 cm).
- It does **not** read as a broad-shouldered man. The torso is close to a box from shoulder to hip: the shoulder ring is 39.6 cm wide, the hip 35.9 cm. Over the deltoids the body is 48.5 cm, 1.35 times the hip; the female v0 is 1.34, because it is about 6 cm wider over the deltoids than measured women. So shoulder against hip hardly separates the two families.
- The underside of the male torso is a flat ledge above the legs, clearest in the side view. The real distance from seat level to crotch is 4 cm, and the five parts are not joined into one surface.
- Neither family has a bust or a chest as a shape: every section is an ellipse. The female chest ring is a band that is larger all the way round.
- Large sizes look like a barrel from the side (chest depth 38 cm at XXL against about 30 cm measured), for the reason given under "What the ellipse cannot do".

## Male shape v2 (`maleV2.ts`, opt-in: `buildMannequin(shape, { maleShape: 'v2' })`)

The answer to the verdict above, behind an option. **Default unchanged:** without the option (or with `maleShape: 'v1'`) the male body is byte for byte the v1 body, and a female shape ignores the option (both pinned by sha256 in `maleV2.test.ts`). The shape table, the rings (ids, heights, girths, ellipses in `rings`), the lengths, the arm frames and the morph heights are the v1 ones; only the surface, the leg centres (`landmarks.legX`, the leg rings' x, the hip and knee pivots) and what `torsoAt` / `legAt` / `armAt` return change.

- **Rings fitted to ANSUR II.** `MALE_SECTION_REFERENCE` holds ANSUR II's chest, waist and hip breadth and depth, its own waist (omphalion) and buttock girths and the axilla level, on the same least-squares lines on chest girth as the male table (`scripts/derive-male-table.ts` prints it; same file, same sha256). At each of the chest, waist and seat the section is a superellipse |x/A|^p + |z/B|^p = 1 with ANSUR's breadth and depth, its exponent solved so that the perimeter is ANSUR's girth (`fitRing`), then scaled to the table girth. Waist p = 2.67 to 2.75 and seat p = 3.26 to 3.60, from the data. The chest cannot be fitted: ANSUR's chest breadth and depth (27.7 × 23.2 cm at M) cannot reach its girth (98 cm) with any convex shape short of a rectangle. So the depth is kept, p is held at `CHEST_EXPONENT_LIMIT` (3.4, assumed) and the breadth grows until the perimeter is the girth (34.2 cm at M, about the v1 breadth).
- **Relief** (all assumed, `MALE_V2_ASSUMPTIONS`): two pectoral bulges with a shallow sternal groove, shoulder blades and a spine groove, a belly that grows with ANSUR's waist depth / breadth (front share of the waist depth 0.52 at M, 0.57 at XXL), two gluteal bulges and a cleft. Lats widen the torso by 8 % from the chest ring to the armpit (ANSUR axilla height). Above the shoulder ring a straight trapezius slope runs to the neck ring, and the front reaches the neck lower than the back, a slanted neck base like ANSUR's suprasternale (0.816) and cervicale (0.862) heights.
- **Deltoids:** the arm root is a dome under the shoulder line (no pole standing above it, which was the v1 wedge), with a bulge on the lateral, front and back side that tapers out at 0.85 of the upper-arm ring's distance. The breadth over the deltoids grows by 0.08 to 0.11 cm over ANSUR's bideltoid breadth (tested < 0.15).
- **Seat and crotch:** the legs move in so that the thigh tops sit under the seat and touch in the middle (flattened where they meet); the back of the thigh carries the lower buttock to the gluteal fold. From the seat ring down, the torso outline goes over into the two thigh outlines side by side, so torso and legs meet flush; the torso ends inside the thighs at the gluteal fold, and the thighs stay 1.5 % inside it above that. No flat ledge: the front-view breadth changes by less than 0.8 cm per 0.5 cm from the thigh ring to the seat (tested).
- **Girths:** every section is scaled so that the loop on the mesh at every anchor ring is the table girth; all 12 rings are within 0.5 % in all five sizes and for typed bodies (tested). Between rings the scale is interpolated.
- **Collision:** `torsoAt`, `legAt` and `armAt` return an ellipse about the section centre that contains the v2 outline (the viewer's cloth collides with ellipses). They no longer have the section's girth.
- **Cost:** about 25k triangles against 15k (64 torso vertices per section at 1 cm, 40 leg vertices on non-elliptical leg sections).

Measured on the mesh (breadth × depth of the torso loop, cm; v1 → v2):

| Size | Chest | Waist | Seat | Under the armpit | Over the deltoids / seat breadth |
|---|---|---|---|---|---|
| S | 31.9 × 25.2 → 31.6 × 21.0 | 29.3 × 19.9 → 27.8 × 18.9 | 34.4 × 22.7 → 30.7 × 20.7 | 32.8 → 33.3 | 1.34 → 1.50 |
| M | 33.9 × 28.4 → 34.2 × 23.2 | 31.8 × 22.6 → 30.4 × 21.5 | 35.9 × 24.8 → 32.1 × 22.6 | 34.6 → 35.9 | 1.35 → 1.51 |
| L | 35.9 × 31.6 → 36.7 × 25.4 | 34.4 × 25.1 → 32.9 × 23.9 | 37.7 × 26.8 → 33.8 × 24.6 | 36.5 → 38.5 | 1.35 → 1.51 |
| XL | 38.0 × 34.6 → 39.2 × 27.6 | 36.9 × 27.7 → 35.4 × 26.4 | 39.5 × 28.9 → 35.5 × 26.6 | 38.6 → 41.2 | 1.35 → 1.51 |
| XXL | 40.2 × 38.2 → 42.0 × 30.1 | 40.0 × 30.4 → 38.3 × 29.3 | 41.3 × 31.4 → 37.2 × 28.8 | 40.7 → 44.2 | 1.37 → 1.52 |

ANSUR II (scaled to the table girth) for comparison at M: chest depth 23.2, waist 30.2 × 21.4, seat 32.8 × 22.6. Pictures: `docs/screens/claude/male-shape-v2/` (`scripts/render-male-v2.ts` and `scripts/compose-male-v2.mjs`). In the viewer the option is `MountOptions.maleShape` (and `maleShape=v2` on the spike's `avatar.html`). A v2 body also carries `outlines` (`outlines.ts`): its drawn sections as polar outlines, which the cloth collider and the POM tee builder read, because the ellipses `torsoAt` / `legAt` / `armAt` return on v2 only contain the section (2.5 to 13 cm more girth). A men's bundle names the shape it was built on, and is shown only on that shape.

## The neutral standard head (`head.ts`, D19)

`buildMannequinMesh(m, { head: 'neutral' })` replaces the egg with a sculpted head, for both families: a sixth closed part `head` that overlaps the neck (as the limbs overlap the torso), while the torso part loses the egg and its neck runs up into the head, narrowing. The default (`head: 'egg'` or no option) is the v0 mesh, byte for byte; the pinned .glb hashes and `anchors.json` do not change, and nothing in the garment pipeline (rings, collision sections, `torsoAt`) knows about the head.

- **Own geometry only.** 76 rows × 104 columns of horizontal superellipse sections through three hand-written profile curves (front, back, half-width; a quarter ellipse for the dome), plus `faceRelief`: smooth bumps and hollows for the brow, eye sockets with a lidded eye, nose, cheekbones, lips, chin, and a lump for each ear. The proportions are the common drawing ones (eyes at half the head height, nose base at a third, mouth a third of the way from nose base to chin). No scan, photo, measurement of a person, SMPL, FLAME or other face or body model is used, and it is not derived from one. Licence: this repository's own code, nothing to record.
- **Generic, not a likeness.** One face. The male head has a slightly heavier brow, chin and jaw and a slightly larger nose (the `male` flag of `faceRelief`); nothing else differs. No eyes are painted, there is no hair.
- **Size.** Chin at 86.5 % of stature, top at 100 % (`HEAD_LEVELS`): 22.7 cm on the female M, 22.2 cm on the male M (the male levels put the shoulder line higher, and the head levels follow it). It follows `heightCm` like every other length. 15.8k triangles, so a mesh with the neutral head has about twice the triangles of the default one (30.0k against 14.9k on the female M).
- **In the viewer** the head takes a fifth of the neck's girth scale (`HEAD_SCALE_SHARE` in `garment-viewer/src/body.ts`), where the egg was widened with the torso.

**How it reads (looked at 14 Nov 2026, three.js renders from `spikes/garment-engine/viewer/avatar-renders.mjs`).** At phone size (the whole figure in a 390 px wide view, the head about 60 px high) it reads as a face: a shadow band at the eyes, the nose, a mouth. It no longer looks unfinished. Close up it is a shop-window mannequin with soft, slightly blurred features and closed-looking eyes; it is bald and has no eyebrows or lashes. It is not a person and nobody would take it for one. What is still off: the v0 neck is a long straight column, on the male body as wide as the jaw, which makes the male head look set in a collar from the side; and the head sits on a body with box shoulders. Uncanny it is not, in the sense of a face that is almost human; "plain dummy" is the fair description. Hair (plan slice 2's picker) is not built.

## Head v2 (`headV2.ts`, opt-in: `head: 'neutral-v2'`)

For the look review of 18 Nov 2026. `buildMannequinMesh(m, { head: 'neutral-v2' })`; the `neutral` head and the default `egg` mesh are byte for byte as before (`headV2.test.ts` pins the `neutral` hashes of 41c1c16).

- **Own geometry only**, as v1: hand-written profile curves (front, back, half-width per family) and smooth bumps along the surface normal. No scan, photo, measurement of a person, SMPL, FLAME or other face or body model, and nothing derived from one. One generic face per family, not a likeness of anyone. No hair.
- **Features**: open eyes (an eyeball in each socket, an upper and a lower lid with a margin step, a lid crease, a sculpted iris ring and pupil looking straight ahead); brows (a raised band over each eye, and a shade on the skin colour there); a defined nose whose underside slopes into a filled upper lip (the steepest slope under the nose is 0.9 to 1.0 cm per cm against v1's 2.1 to 2.4: no shelf, so no dark patch that reads as a moustache); lips with a line and corners; ears with a rim, a hollow and a lobe.
- **Shade** (`mesh.shade`, one value per vertex, 1 elsewhere): brows ×0.68, lash line ×0.62, iris ×0.70 of the skin colour at the darkest. The viewer draws it as a vertex colour. It is a darker tint of whatever skin colour is chosen, never a colour of its own.
- **Families differ in jaw and brow**: the male jaw is about 0.9 cm wider at the gonion (unit head) and squarer, the chin wider and further forward, the brow ridge heavier and lower, the brows flatter and lower; the female jaw is narrower with a rounder chin, the brows higher and arched, the lips a little fuller.
- **No neck seam**: the head continues down as a tube that is the visible neck from the neck ring up (0.04 unit cm outside the torso's neck, which for this head has no flare towards the old egg and stays inside the tube), and below the ring follows the torso's flare into the shoulders and sinks into it at a shallow angle. There is no collar edge under the chin or at the nape (v1 had one at the back). `mesh.headLevels` gives the chin and top, since the tube reaches below the chin. That is the geometry; what the shopper sees under the chin is shading: the underside of the chin faces down, away from the key light, and at phone size, seen from a camera below the head, it read as a dark band, a chin strap, on both families (review of 18 Nov 2026; darkest L\* 22 against 55 to 60 on the neck). The front of the tube now turns into the chin from 2.8 unit cm under it (`CHIN_TURN_FROM`, was 0.6), so the underside slopes and catches some key light, and `neutral-v2` lighting adds a floor bounce (garment-viewer README). A thin line where the chin meets the neck stays (darker on the male head), and under `classic` (no bounce) the band stays: softer on the female head, about as hard as before on the male.
- **Size**: 132 rows × 176 columns, more of them in the face band and at the ears: **46,464 triangles** for the head (v1: 15,808); the whole female M mesh 60,672 (v1 30,016, egg 14,880), male 61,088.
- **How it reads** (looked at 18 Nov 2026, renders in the look review): close up it is clearly a shop-window mannequin with open eyes, brows, ears and a jaw; the moustache shadow is gone from the front; the male and female heads are told apart at a glance (jaw, brow). What is still off: the lid margins show small steps close up (the grid); the eyes, with their incised iris, are a little doll-like; under the chin (re-rendered after `CHIN_TURN_FROM` and the bounce, 18 Nov 2026): with `neutral-v2` lighting the female head shows only a thin soft line where the chin meets the neck, at phone size and on the large (150/140/160), 130 cm and 220 cm bodies; the male head a thin but clearly darker line across the whole jaw; under `classic` lighting (no bounce) the male jaw still has a hard dark band, a chin strap, from the front and from below, and the female a softer one, so head v2 should only go out with `neutral-v2`; at the nape and the side of the neck the horizontal shading bands are faint now; on Monk 9 and 10 the eyes and brows nearly vanish at phone size (the shade is a multiplier of an already dark skin; not changed); the male face is boxy and the mouth a slit (not changed); the ears from behind are flat plates; still bald.

## Head v3 (`headV3.ts`, opt-in: `head: 'neutral-v3'`)

For the head review of 19 Nov 2026: head v2 with the review's defects fixed, short sculpted hair and about half the triangles. `buildMannequinMesh(m, { head: 'neutral-v3' })`; the default (`egg`), `neutral` and `neutral-v2` meshes are byte for byte as before (`headV3.test.ts` pins v2's hashes of 8658d21). The torso and limbs are v2's; the head sits on the neck exactly as v2's (its tube, `headLevels`), so the viewer's neck fit and `tubeWeight` work unchanged.

- **Own geometry only**, as v1 and v2: hand-written profile curves, smooth bumps along the normal and a hand-written hairline. No scan, photo, measurement of a person, SMPL, FLAME or any face, hair or body model; one generic face and hair shape per family, no likeness of anyone.
- **Lids on the grid** (`lidWarp`): inside each eye the row nearest the upper lid is bent onto the upper lid curve and the row nearest the lower lid onto the lower one; the rows above and below keep the lid's curve and let it go over six rows. It is a blend of monotone maps per column, so the grid never folds. v2's lid margins crossed rows and showed small steps close up; v3's lie on one row each (`headV3.test.ts` checks within 0.05 unit cm). Towards the eye corners, where the weight fades, the margin is softer; a few small steps remain visible there in 2x close-ups.
- **Quieter eyes**: the opening is lower (upper lid 0.44 / 0.39 unit cm above the eye centre, v2 0.52 / 0.46), so the upper lid covers the top of the iris; a flatter eyeball; no incised iris ring; the iris and pupil are a soft shade (×0.8 and ×0.7 at the darkest) instead of a ring and a hole.
- **Under the jaw**: the front turns from the neck into the chin over 7.1 unit cm (`V3_CHIN_TURN`, -4.2 to 2.9; v2 -2.8 to 2.3) with a smootherstep, the chin's lowest knots start at the chin itself and slope at about 1 cm per cm (v2's turned 2 cm forward in 1.5 cm), and the hard max/min where the jaw meets the tube are smooth (v2's left a crease across the cheek). The steepest downward normal in the front of the under-chin is -0.84 (female) and -0.83 (male) against v2's -0.94. Where the underside still faces down the shade is up to 16 % lighter (`JAW_LIFT`, a painted finish, not a light), only between a cm above the neck ring and 4.5 unit cm above the chin. The male chin is one wide shape (v2's two bumps left a cleft that read as a dark line at phone size).
- **Ears with a back** (`earReliefV3`): out of the ear's outline the relief falls off at once at the front, top and bottom, and over about a centimetre behind (Gaussian width 0.07 to 0.49 of the ear's half-width by direction), so from behind the ear runs down into the skull instead of ending in a wall; a rolled rim and a small antihelix ridge.
- **Short sculpted hair** (`hairV3`), part of the head's own surface (no second shell, no extra triangles): a hairline by angle round the head (male: above the ear, a short taper at the nape; female: a lower fringe, over the top of the ear, down to the nape), a side parting on the figure's right (`HAIR_PART`) with the hair swept across to the other side (fuller there, and on the female head a fringe lower on that side), shallow locks that leave the parting and run across and down, a rise of 0.8 cm at the front and up to 3.8 cm at the nape so the back has no ledge. Thickness 0.35 to 0.8 cm (male), 0.6 to 1.55 cm (female) above the skull; the top of the hair is up to 1.6 cm above the stature. Shade ×0.66 (`HAIR_SHADE`), the grooves and the parting a little darker. The mesh carries `hair` (0..1 per vertex): the viewer draws the hair a dark brown on a chosen skin tone, never lighter than that skin darkened (garment-viewer `tintHair`); on the grey mannequin the hair is a darker grey.
- **Size**: 96 rows × 128 columns, placed at the eyes, the mouth, the hairline, the temples and the tube's end: **24,576 triangles** for the head (v2 46,464, v1 15,808); the whole female M mesh 38,784 (v2 60,672), male 39,200 (v2 61,088).
- **How it reads**: see `docs/reports/claude-head-v3.md` (renders, measurements and the verdict).

## What a shape contains

- **Mesh:** five closed, consistently oriented parts (torso with head, two legs, two arms), 14.8–15.2k triangles. The girth of the mesh at every anchor ring equals the table value: every section is scaled so that its inscribed polygon has the ellipse's circumference. Limbs overlap the torso; there is no boolean union in v0.
- **Rings:** the 12 D15 rings with centre, normal, axes, analytic girth and the girth measured on the mesh.
- **Length lines:** `shoulder_to_waist`, `shoulder_to_hem`, `waist_to_hem` (drops from the high point shoulder or the waist front), `sleeve` (along the arm from the shoulder joint), `inseam` and `rise` (from the crotch point). A garment's length is where its edge meets the line.
- **Camera paths:** a turntable at 0.3, 0.6 and 1.1 × stature, radius 320 cm, field of view 40°, 72 frames by default. Frame 0 is the front and frame N/2 the back; stage 2 pins the merchant's photos there. `cameraMatrices(frame, aspect)` gives view and projection matrices.
- **Rig and motion clip:** 10 joints (root, spine, shoulders, elbows, hips, knees) with two-joint linear blend skinning. `MOTION_CLIP` is 6 s at 24 fps: arms raise and lower, a half turn, a step forward. It is stored as keyframed Euler angles; use `sampleClip(clip, t)` and `poseMesh(…)`.

## API

| Export | What it does |
| --- | --- |
| `BODY_SHAPES`, `bodyShape(id)`, `BASE_SHAPE_ID` | The female shape table (unchanged) |
| `familyShape(family, id?)`, `familyShapeIds(family)`, `FAMILY_BASE_SHAPE_ID`, `MALE_BODY_SHAPES`, `MALE_REFERENCE`, `MALE_LEVELS`, `MALE_ASSUMPTIONS` | Both families and the male reference table |
| `shapeForBody(input)`, `buildBody(input)`, `referenceMeasurements(shape)`, `deltoidBreadthCm(m)`, `armClearanceCm(m)`, `BODY_INPUT_LIMITS`, `FEMALE_SHOULDER_REFERENCE`, `MALE_SOURCES` | A shape or a mannequin from typed measurements; what a shopper would type for a shape |
| `levelWarp(levels)`, `NOMINAL_LEVELS` | The level stretch behind `BodyShape.levels` |
| `buildMannequin(shape)` | Parts, rings, length lines, joints, landmarks, plus `torsoAt(y)`, `legAt(y, side)`, `armAt(s, side)` |
| `buildMannequinMesh(m, { head? })`, `topology(mesh)`, `vertexNormals(mesh)` | Mesh (default: the v0 egg head; `head: 'neutral'`: the neutral standard head as a sixth part; `head: 'neutral-v2'`: head v2, with `shade` and `headLevels`; `head: 'neutral-v3'`: head v3, with `shade`, `hair` and `headLevels`), watertight/manifold/orientation report, normals |
| `buildHeadPart(m)`, `faceRelief(x, y, male?)`, `HEAD_LEVELS`, `FACE_LEVELS` | The neutral head alone, its relief function and its levels |
| `buildHeadPartV2(m, neck)`, `faceReliefV2`, `faceShadeV2`, `earRelief`, `FACE_LEVELS_V2` | Head v2 alone (`head: 'neutral-v2'`), its relief and shade functions and its levels |
| `buildHeadPartV3(m, neck, { bald? })`, `faceReliefV3`, `faceShadeV3`, `earReliefV3`, `hairV3`, `lidsV3`, `FACE_LEVELS_V3`, `V3_ROWS`, `V3_COLUMNS` | Head v3 alone (`head: 'neutral-v3'`), its relief, shade, hair and lid functions, its grid |
| `slice(positions, indices, plane)`, `loopAround`, `loopLength`, `resampleLoop` | Plane sections, used for ring measurement and for stage 5 anchoring |
| `mannequinAnchorsJson(m, mesh)`, `meshRingCircumference` | `anchors.json` |
| `turntablePaths(m)`, `motionCamera(m)`, `cameraMatrices(frame, aspect)` | Camera paths |
| `skinWeights`, `poseMesh`, `posePoint`, `MOTION_CLIP`, `sampleClip`, `clipFrameTimes` | Rig and motion |
| `writeGlb(primitives, { scale })`, `readGlb`, `glbFloatAccessor`, `glbIndexAccessor` | glTF 2.0 binary writer and reader (no textures, no Draco) |

## Not in v0

These are not built yet: a UV checker material variant, skinning inside the .glb (the rig runs in TypeScript), a single unioned surface, hands and feet beyond simple caps, 5 female shapes, a male canonical body in the garment pipeline (plan slice 8), and non-elliptical sections (a real chest, a bust, a seat). None of them changes an interface.

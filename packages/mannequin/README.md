# @curtain/mannequin

The canonical mannequin v0 (`docs/ENGINE-HANDOFF.md` §The canonical mannequin, D14, D15): a procedural A-pose body in two families (female: three shapes, male: five), lofted in pure TypeScript through the anchor rings of `@curtain/anchors`, plus the fixed camera paths, the one motion clip and a minimal glTF 2.0 binary writer. Deterministic: the same shape always gives the same bytes. The only runtime dependency is `@curtain/anchors`.

## Run

```sh
pnpm --filter @curtain/mannequin build          # tsup → dist/
pnpm --filter @curtain/mannequin build:assets   # writes out/ (gitignored), see below
pnpm --filter @curtain/mannequin preview        # out/preview/families-M.png: female M and male M, front and side
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

**Sources (read 13 Nov 2026).**

- **Chest, waist, neck: EN 13402-3 men's values.** Chest and waist in 4 cm steps at drop −12 cm, the neck girth the standard associates with each chest girth, and the letter intervals (S 86–94, M 94–102, L 102–110, XL 110–118, XXL 118–129). Each letter size takes the midpoint of the two steps it combines. The standard itself is sold by CEN members and was **not** read: the values were read from the tables of the Wikipedia article "Joint European standard for size labelling of clothes" (article text CC BY-SA 4.0; only numbers were taken, no text). Check them against a bought copy of the standard before anyone calls the table "EN 13402".
- **Everything else: ANSUR II**, the 2012 Anthropometric Survey of U.S. Army Personnel (report NATICK/TR-15/007, distribution statement on the report: "Approved for public release; distribution is unlimited"; a U.S. Government work, public domain in the United States, so commercial use is allowed). File `ANSUR_II_MALE_Public.csv` (4082 men) from https://www.openlab.psu.edu/ansur2/, sha256 `0547aea0…caac64` (full hash in `scripts/derive-male-table.ts`). The file is not in the repo. Per size, each value is the least-squares line of the measure on chest girth over all 4082 men, at the size's chest girth, rounded to 0.5 cm. `scripts/derive-male-table.ts <csv>` prints the table again.
- No SMPL, SMPL-X, Anny or other body model, and no scan, is used.

**What the two sources say about each other.** At the same chest girth ANSUR's waist (measured at the navel) is 76 / 85 / 94 / 103.5 / 113.5, within 2.5 cm of the EN waist. ANSUR's neck girth is 36 / 38 / 40 / 41.5 / 44, 1.5 to 2 cm under the EN neck girth (the two are measured at different heights on the neck). The table uses the EN values.

**Limits of the table.** ANSUR II is a military sample (young, fit, U.S.). It is not the civilian or the European population. Stature and inseam hardly follow chest girth (r = 0.25 and 0.12), so their steps per size are small. XS and 3XL are left out: 22 and 20 men in the sample.

**How the mesh uses it.**

| Ring or length | Value | `source` |
| --- | --- | --- |
| chest, waist, neck | EN 13402-3 | table |
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

## Families: API and the contract for the viewer and the 2D figure

```ts
import { buildBody, buildMannequinMesh, familyShape, referenceMeasurements, shapeForBody } from '@curtain/mannequin';

familyShape('male', 'L');            // a table size (BodyShape) or undefined
familyShape('female');               // the family's base size: female M, male M
referenceMeasurements(shape);        // { family, heightCm, chestCm, waistCm, hipCm, shoulderCm, inseamCm, neckCm }
const m = buildBody({ family: 'male', heightCm: 182, shoulderCm: 42, bust: 102, waist: 90, hip: 100 });
const mesh = buildMannequinMesh(m);  // closed mesh, rings exact, same Mannequin interface as before
```

`BodyInput` is the intended shape of `MountOptions.body` in `@curtain/garment-viewer` and of the 2D figure's props. Neither is wired yet; this package does not edit them.

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
- `shoulderCm` moves the shoulder ring by the difference to the table's shoulder width at that chest girth, 1 cm for 1 cm, bounded to 0.75–1.35 times the table's ring.
- **`shoulderCm` means the straight distance between the two shoulder points** (biacromial breadth). For the male family the reference is ANSUR. For the female family there is no measured reference: `referenceMeasurements` returns the width of the v0 shoulder ring (42.1 cm at M), which is about 5 cm over ANSUR's female biacromial breadth (36.7 cm). A tape laid across the back reads more than the straight distance; this package does not convert.
- The id of such a shape is `custom`. The result is a plain `BodyShape`: `buildMannequin(shape)` gives rings, `morphHeights`, `torsoAt` / `legAt` / `armAt`, joints and length lines exactly as for a table shape, so the viewer's collision field and grading morph work on it unchanged.

What the adopters must do themselves:

- **Viewer (`body.ts`, `mount.ts`).** Pick the base with `familyShape(body.family)` instead of `bodyShape(BASE_SHAPE_ID)`. Either keep morphing the base mesh by chest, waist and hip as today, or build the body directly with `buildBody(body)`; only the second honours `heightCm` and `shoulderCm`.
- **Drape guard.** A bundle records `mannequin: { version, shape }` and no family. Every bundle today is female M. Show the 3D drape only when the drawn family equals the bundle's family; read a missing family as `female`. `anchors.json` of a male shape carries `family: 'male'` for the bundles to come.
- **Ring heights.** Use `mannequin.morphHeights`, never `NOMINAL_RING_HEIGHTS × stature`: the male rings sit at other levels (crotch 0.483 of stature against 0.455).
- **2D figure.** `referenceMeasurements(familyShape('male'))` and `mannequin.rings` (width `2a`, depth `2b`, height `centre[1]`) give a male silhouette from the same numbers.

## How the male M body reads (looked at, 13 Nov 2026)

`pnpm --filter @curtain/mannequin preview` renders female M and male M, front and side, at one scale.

- It reads as a different, male-leaning figure next to the female one: 6 cm taller, legs 7.6 cm longer, a thicker neck, a straight torso with no waist (waist / hip width 0.89 against 0.73) and no swelling at the chest (chest to underbust girth −5 cm against −14 cm).
- It does **not** read as a broad-shouldered man. The torso is close to a box from shoulder to hip: the shoulder ring is 39.6 cm wide, the hip 35.9 cm. Over the deltoids the body is 48.5 cm, 1.35 times the hip; the female v0 is 1.34, because its shoulders are about 5 cm wider than measured women's. So shoulder against hip hardly separates the two families.
- The underside of the male torso is a flat ledge above the legs, clearest in the side view. The real distance from seat level to crotch is 4 cm, and the five parts are not joined into one surface.
- Neither family has a bust or a chest as a shape: every section is an ellipse. The female chest ring is a band that is larger all the way round.
- Large sizes look like a barrel from the side (chest depth 38 cm at XXL against about 30 cm measured), for the reason given under "What the ellipse cannot do".

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
| `shapeForBody(input)`, `buildBody(input)`, `referenceMeasurements(shape)`, `deltoidBreadthCm(m)` | A shape or a mannequin from typed measurements; what a shopper would type for a shape |
| `levelWarp(levels)`, `NOMINAL_LEVELS` | The level stretch behind `BodyShape.levels` |
| `buildMannequin(shape)` | Parts, rings, length lines, joints, landmarks, plus `torsoAt(y)`, `legAt(y, side)`, `armAt(s, side)` |
| `buildMannequinMesh(m)`, `topology(mesh)`, `vertexNormals(mesh)` | Mesh, watertight/manifold/orientation report, normals |
| `slice(positions, indices, plane)`, `loopAround`, `loopLength`, `resampleLoop` | Plane sections, used for ring measurement and for stage 5 anchoring |
| `mannequinAnchorsJson(m, mesh)`, `meshRingCircumference` | `anchors.json` |
| `turntablePaths(m)`, `motionCamera(m)`, `cameraMatrices(frame, aspect)` | Camera paths |
| `skinWeights`, `poseMesh`, `posePoint`, `MOTION_CLIP`, `sampleClip`, `clipFrameTimes` | Rig and motion |
| `writeGlb(primitives, { scale })`, `readGlb`, `glbFloatAccessor`, `glbIndexAccessor` | glTF 2.0 binary writer and reader (no textures, no Draco) |

## Not in v0

These are not built yet: a UV checker material variant, skinning inside the .glb (the rig runs in TypeScript), a single unioned surface, hands and feet beyond simple caps, 5 female shapes, a male canonical body in the garment pipeline (plan slice 8), and non-elliptical sections (a real chest, a bust, a seat). None of them changes an interface.

# @curtain/mannequin

The canonical mannequin v0 (`docs/ENGINE-HANDOFF.md` §The canonical mannequin, D14, D15): a procedural A-pose body in three shapes, lofted in pure TypeScript through the anchor rings of `@curtain/anchors`, plus the fixed camera paths, the one motion clip and a minimal glTF 2.0 binary writer. Deterministic: the same shape always gives the same bytes. The only runtime dependency is `@curtain/anchors`.

## Run

```sh
pnpm --filter @curtain/mannequin build          # tsup → dist/
pnpm --filter @curtain/mannequin build:assets   # writes out/ (gitignored), see below
pnpm --filter @curtain/mannequin test
pnpm --filter @curtain/mannequin typecheck
pnpm --filter @curtain/mannequin lint
```

`build:assets` writes, per shape, `out/<shape>/mannequin.glb` (metres, mid-grey), `out/<shape>/anchors.json` (cm), `out/<shape>/camera-paths.json`, plus `out/motion-clip.json` and `out/manifest.json` with the sha256 of every file.

## Conventions

- Mannequin space: +Y up, +Z front (the mannequin faces +Z), +X the mannequin's left. Centimetres everywhere except the .glb, which is in metres (glTF).
- A ring is an ellipse `centre + a·sin(t)·u + b·cos(t)·v` in the plane with `normal`; `a` is the half-width, `b` the half-depth (same as `ellipseRingPoints` in `@curtain/anchors`). Torso rings lie in horizontal planes; leg rings are horizontal on the left leg; arm rings are perpendicular to the left arm axis. Mirror X for the right side.
- `morphHeights` are the positions to pass to `gradingMorph(…, { heights })`: the height above the floor for the body chain, the distance from the shoulder joint along the arm for the arm chain.

## Shapes

| Shape | Stature | Chest | Waist | Hip |
| --- | --- | --- | --- | --- |
| XS | 164 | 80 | 62 | 88 |
| M | 168 | 92 | 74 | 100 |
| XXL | 170 | 116 | 98 | 122 |

Chest, waist and hip sit inside the EN 13402-3 size intervals and match the body charts in the `@curtain/schema` fixtures (for example `aalter-studio-1`, size M: 92 / 72 / 100; graded charts step 4 cm per size). The other nine girths are representative proportions, flagged `source: "proportion"` in `anchors.json`. v0 is a geometry fixture for the pipeline, not an anthropometric reference. Phase 1 swaps in a measured table with 5 shapes behind the same interface.

## What a shape contains

- **Mesh:** five closed, consistently oriented parts (torso with head, two legs, two arms), 14.8–15.2k triangles. The girth of the mesh at every anchor ring equals the table value: every section is scaled so that its inscribed polygon has the ellipse's circumference. Limbs overlap the torso; there is no boolean union in v0.
- **Rings:** the 12 D15 rings with centre, normal, axes, analytic girth and the girth measured on the mesh.
- **Length lines:** `shoulder_to_waist`, `shoulder_to_hem`, `waist_to_hem` (drops from the high point shoulder or the waist front), `sleeve` (along the arm from the shoulder joint), `inseam` and `rise` (from the crotch point). A garment's length is where its edge meets the line.
- **Camera paths:** a turntable at 0.3, 0.6 and 1.1 × stature, radius 320 cm, field of view 40°, 72 frames by default. Frame 0 is the front and frame N/2 the back; stage 2 pins the merchant's photos there. `cameraMatrices(frame, aspect)` gives view and projection matrices.
- **Rig and motion clip:** 10 joints (root, spine, shoulders, elbows, hips, knees) with two-joint linear blend skinning. `MOTION_CLIP` is 6 s at 24 fps: arms raise and lower, a half turn, a step forward. It is stored as keyframed Euler angles; use `sampleClip(clip, t)` and `poseMesh(…)`.

## API

| Export | What it does |
| --- | --- |
| `BODY_SHAPES`, `bodyShape(id)`, `BASE_SHAPE_ID` | The shape table |
| `buildMannequin(shape)` | Parts, rings, length lines, joints, landmarks, plus `torsoAt(y)`, `legAt(y, side)`, `armAt(s, side)` |
| `buildMannequinMesh(m)`, `topology(mesh)`, `vertexNormals(mesh)` | Mesh, watertight/manifold/orientation report, normals |
| `slice(positions, indices, plane)`, `loopAround`, `loopLength`, `resampleLoop` | Plane sections, used for ring measurement and for stage 5 anchoring |
| `mannequinAnchorsJson(m, mesh)`, `meshRingCircumference` | `anchors.json` |
| `turntablePaths(m)`, `motionCamera(m)`, `cameraMatrices(frame, aspect)` | Camera paths |
| `skinWeights`, `poseMesh`, `posePoint`, `MOTION_CLIP`, `sampleClip`, `clipFrameTimes` | Rig and motion |
| `writeGlb(primitives, { scale })`, `readGlb`, `glbFloatAccessor`, `glbIndexAccessor` | glTF 2.0 binary writer and reader (no textures, no Draco) |

## Not in v0

These are not built yet: a UV checker material variant, skinning inside the .glb (the rig runs in TypeScript), a single unioned surface, hands and feet beyond simple caps, and 5 shapes. None of them changes an interface.

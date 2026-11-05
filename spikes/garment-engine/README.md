# Garment engine spike (Phase 0, model-free parts)

Spike code for Phase 0 of `docs/ENGINE-HANDOFF.md` (builder rule 1: spike code lives here, and only what passes the gate is promoted). It covers the parts of the pipeline that need no GPU and no video model:

- **Stage 3**, separation, tested on our own synthetic renders.
- **Stage 5**, anchoring and calibration.
- **Stage 6**, grading.
- **Stage 8**, the bundle files.

It runs on synthetic garments built on the canonical mannequin (`@curtain/mannequin`). Stages 2 and 4 (image → video, reconstruction) are the GPU part; the interfaces they must meet are listed at the end.

```sh
pnpm --filter @curtain/garment-spike build:bundle   # writes out/<productId>/ (gitignored)
pnpm --filter @curtain/garment-spike test
pnpm --filter @curtain/garment-spike typecheck
pnpm --filter @curtain/garment-spike lint
```

The dependencies are `@curtain/anchors`, `@curtain/mannequin` and `@curtain/schema`, used from their `dist/`. Run `pnpm build:packages` first. The package has no `build` script of its own because nothing in it ships.

## Result of `build:bundle` (Nov 5, 2026, synthetic data)

| Product (schema fixture) | Chart | Before calibration, max abs error | After global scale, max abs (QA metric) | After calibration, chart agreement | Separation IoU (72 frames, 192 px) | Triangles | Bundle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aalter-studio-2` shirt dress, long sleeves | body chart + ease | 6.31 cm | 1.65 cm | 0.00 cm, pass | 0.9955 (lowest frame 0.988) | 14,720 | 295 KB |
| `monochrome-03` boxy tee, short sleeves | garment chart (bust only) | 6.64 cm | 0.00 cm (one ring) | 0.00 cm, pass | 0.9912 (lowest frame 0.982) | 7,808 | 165 KB |

The "before" error is the simulated reconstruction error: 3.5 % too large, chest +1.8 cm, waist −1.2 cm, hip +0.8 cm, plus 1.5 mm of surface noise. After per-ring calibration, chart agreement is about 0 by construction. The number that carries information is the **residual after the global scale**: it shows how much per-ring correction a reconstruction needed. Its tolerance must be set from real Phase 0 data.

## What is real and what is synthetic

| Part | Status | Where |
| --- | --- | --- |
| Canonical mannequin: 3 shapes, anchor rings, length lines, camera paths, motion clip, rig | **Real** (v0, procedural) | `packages/mannequin` |
| Plane slicing of a mesh at every anchor ring → loop, girth, offset from the body; skirt loops that enclose both legs are flagged | **Real**: works on any mesh in mannequin space | `src/anchoring.ts` `measureGarment`, `measureRing` |
| Length points (hem on the front drop line, sleeve end along the arm axis) | **Real** | `measureGarment` |
| Calibration: least-squares global scale, then per-ring corrections applied with the `@curtain/anchors` morph; merchant sample measurements win over the chart | **Real** | `calibrate`, `applyCalibration` |
| Body/arm chain per vertex from geometry and normals (no part labels needed) | **Real**, but a heuristic | `assignChains` in `src/garment.ts` |
| Grading: per size, target = base + chart delta; standard increments where the chart has no column (logged as estimates); device-side morph | **Real** | `src/grading.ts` |
| Garment mask = dressed frame vs bare frame difference, 3×3 majority vote, IoU vs ground truth | **Real algorithm**, tested on synthetic frames only | `src/separation.ts` `differenceMask`, `separate` |
| material.json from the `@curtain/schema` fabric library (`resolveFabric`) | **Real** | `src/product.ts` `materialJson` |
| Bundle writer (base.glb, anchors.json, grading.json, material.json, qa.json), input hash, determinism | **Real format**, no Draco, no KTX2 textures | `src/bundle.ts` |
| Garment meshes | **Synthetic**: lofted around the mannequin from the size chart at base size M (product ease or the category default), A-line flare, sleeves along the arms | `generateGarment` |
| Reconstruction error | **Synthetic**: `distortGarment` (global scale, per-ring bias, noise) | `src/garment.ts` |
| "Video" frames | **Synthetic**: our software rasterizer, flat Lambert with a head light, chroma-green background, Gaussian pixel noise (σ = 2) on both frames | `src/raster.ts` |
| Products | Schema fixtures `aalter-studio-2` and `monochrome-03`, not pilot products | `src/product.ts` |

## Limits found in the spike

- **The shoulder width is not the shoulder ring.** The chart column `shoulder` is a width (shoulder to shoulder). The D15 ring `shoulder` is a girth. Since review finding R1 the vocabulary says so: the fit point `shoulder` maps to the breadth anchor `shoulder_width` (`@curtain/anchors`), and the fit engine's `anchorGaps` keys the shoulder gap that way, never under the ring. The spike still does not calibrate the shoulder ring against the chart (no chart has a shoulder girth); it grades the ring by the standard increment. grading.json does not carry `shoulder_width` yet (the spike reads only the girth columns of the chart).
- **A garment the colour of the mannequin cannot be separated by difference alone.** A test shows IoU < 0.5 for a mid-grey tee. Stage 3 needs the segmentation model and the motion signal, or a mannequin colour chosen per product.
- **The difference method assumes the generated video keeps the mannequin's look** (mid-grey, same light) wherever no cloth covers it. A real video model will not hold this exactly. Expect the threshold and the cleanup to need tuning, and use the bare-mannequin mask only as a prior.
- **Near the armhole, a roomy torso and a sleeve can occupy the same place.** `assignChains` decides by the outward normal, and the sleeve cap above the armpit grades with the body. This needs outward-oriented triangles from stage 4.
- **The synthetic garments are open, manifold surfaces.** The handoff's mesh-health check ("watertight where expected") must allow the neckline, hem and sleeve openings.
- The tee has 7.8k triangles, below the 8–15k guidance; the budget check only enforces the upper bound.

## What Phase 0 still needs from a GPU service and video models

The candidates, licences and costs are in `docs/research/garment-engine.md`. The stages below plug into the spike by replacing `generateGarment` + `distortGarment` in `buildBundle` (`src/bundle.ts`). Everything after that point stays as it is.

### Stage 2: image to video (GPU or hosted video model)

**Input** (one job per product and clip):

| Field | Type | Source |
| --- | --- | --- |
| `mannequin` | `{ version, shape: 'M', glbSha256 }` | `packages/mannequin` `out/M/` |
| `cameraPath` | `CameraFrame[]` (`position`, `lookAt`, `up`, `fovYDeg` per frame; `turntable_mid` with 72 frames, or all three heights) | `turntablePaths(mannequin)` |
| `motion` | `MotionClip` (keyframed joint angles) plus `clipFrameTimes` | `MOTION_CLIP` |
| `control` | Per-frame depth (cm, float) and silhouette of the bare mannequin along the same path, for control-video models (Wan2.2-Fun Control) | `render([...]).depth`, `.ids` in `src/raster.ts` |
| `pinned` | `{ frame: 0, image: dressedFront }`, `{ frame: N/2, image: dressedBack }`, plus merchant video frames at their estimated azimuths | Stage 1 cut-outs, try-on onto the mannequin render |
| `references` | Detail photos | Merchant |
| `model`, `version`, `seed` | Pinned (builder rule 5) | Provider registry |

**Output:**

| Field | Type | Contract |
| --- | --- | --- |
| `frames` | RGB images, one per camera frame, same resolution for all | Frame `i` is seen from `cameraPath[i]`. For hosted models without camera control, also return `poses: CameraFrame[]` re-estimated per frame and their reprojection error |
| `motionFrames` | RGB images, one per `clipFrameTimes` entry, from `motionCamera(mannequin)` | Same mannequin, same light |
| `meta` | `{ model, version, seed, gpuSeconds, costCents }` | Goes into the asset record and `qa.json` |

We render the bare-mannequin frames ourselves along the same path (`render` with only the mannequin). They cost nothing and need no model.

### Stage 3: separation (completion)

The spike implements the difference part. Two more pieces are still missing:

- A segmentation refinement: SAM 2 (Apache-2.0) or BiRefNet (MIT), prompted with the difference mask.
- The motion signal: cloth that lags the posed mannequin during the clip.

Interface: input `frames`, the bare frames and the masks from `differenceMask`. Output, per frame: `{ mask: Uint8Array (w×h), confidence: Float32Array (w×h) }`. Acceptance on synthetic frames today: IoU > 0.95. On generated frames, the threshold comes from Phase 0 data.

### Stage 4: reconstruction (GPU: gsplat 2DGS + TSDF, or a NeuS-style SDF)

**Input:** the stage 2 frames with their `CameraFrame`s (or K and [R|t] derived from them via `cameraMatrices`), the stage 3 masks and confidences, the bare-mannequin depth per frame (the inside of the garment is the mannequin surface plus ease), the mannequin .glb, the merchant's front and back photos for texture projection, and a triangle budget of 8–15k.

**Output:** a `Mesh` as defined in `@curtain/mannequin`:

- `positions` as `Float64Array` in cm, in mannequin space (+Y up, +Z front, +X the mannequin's left), the M shape in A-pose.
- `indices` as `Uint32Array`, with outward-oriented triangles.
- `vertexPart` may be all zeros; `assignChains` derives the chains.

The mesh must be manifold and may be open at the neckline, hem and cuffs. Textures come with it (front and back projected from the merchant photos; real pixels win). After that, call `measureGarment` → `calibrate` → `applyCalibration` → `gradeGarment` → bundle, unchanged.

### Stage 7 (not in the spike)

Drape simulation and the "3 s settle" check, colour and view agreement against the merchant photos, Draco compression and KTX2 textures.

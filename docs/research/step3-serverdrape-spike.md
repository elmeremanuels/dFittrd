# Step 3 spike: server-side per-size drapes, morph blending on the device (route R2)

Date: 10 Nov 2026. Branch `claude/step3-serverdrape`. Plan: `docs/research/shortcut-to-step3.md` §4, days 2-5 (R2 spike). Product: the pilot maxi skirt (`out/eval/crimson-wildflower-maxi-skirt`, run 17d bundle). Every render and every number below is an **estimate** from a simulation. Nothing was measured on a real garment or a real phone.

## 1. Answer

- **Go/no-go measure (plan):** more than about 60 % of the graded hip spread survives on a held-out body.
- **Result:** on the held-out body (hip 100, waist 73.5, AU ≈ 10.4), the server drape keeps **12.1 cm of the 20.1 cm graded hip spread (60 %)**. The morph blend on the device keeps **11.9 cm (59 %)**. At the hem line the figures are **18.8 cm (86 %) direct** and **20.3 cm (93 %) blended**, against a graded 21.9 cm. The browser drape today keeps 5.7 cm on mannequin M, which has the same hip of 100 cm (`sizes-drape.ts`, y = 87). REFINEMENT R3 quotes 5.4 cm.
- **Verdict: a marginal GO on the hip, a clear GO on the hem.** It is go only with the caveats in §6. The waistband is not measured, so the band in the main run is an ASSUMED value (W-6). The hip number does not depend on the band assumption (58-65 % over four band models, §4.3). The hem number does.
- **Blend error:** the girth from the blended morphs is within 0.2 cm of the direct drape at the hip and within 1.7 cm at the hem. Per vertex, the error is 0.4-2.2 cm RMS (p95 0.7-2.8 cm). In the side-by-side render the blend and the direct drape are hard to tell apart (§5).
- **Bundle:** 3 sizes × (base + 2 morph targets, positions and normals) come to **379 KB with meshopt (321 KB gzip)**, or 791 KB quantised only. That is about 126 KB per size.
- **Cost:** **95 CPU-s median per drape** (74-115 s; Blender 4.2 cloth, 6,558 particles, 72 frames at 24 fps, quality 10, self-collision on). One product with 3 sizes × 3 grid bodies is 9 drapes, about 15 CPU-minutes. With 5 sizes it is about 25 CPU-minutes.
- **fps:** not measurable here. Headless Chromium uses SwiftShader (software WebGL) on a 4-core container that other agents were loading (load average 8-17). Every configuration gave 3.5-8 fps at 1x and 4x CPU throttle, with and without morph targets, and the noise is larger than any morph effect. **This is EMULATED, not a phone.** The real-device fps is still open (§7).

## 2. What was installed (server side only)

| Tool | Version | How | Licence / use |
|---|---|---|---|
| Blender | 4.2.23 LTS (build 2026-07-21) | Official tarball from download.blender.org into `/opt/tools`, sha256 checked against the published `.sha256` | GPL. Runs as a separate server-side process only; nothing of it is bundled or shipped |
| Anny | 0.6.2 (`pip install anny==0.6.2`) | venv `/opt/tools/anny-venv` | Apache-2.0 code, CC0 assets. **No `[smpl]` or `[examples]` extras.** Only the default `anny` topology and rig; the smplx topology is never loaded |
| torch | 2.15.0+cpu | CPU wheel index | BSD (Anny dependency) |
| warp-lang, roma, trimesh | 1.19.0, 1.8.0, 5.2.0 | Anny dependencies | Apache-2.0 / BSD / MIT. Warp is used only for Anny's skinning. It is **not** `warp.sim` and **not** NvidiaWarp-GarmentCode |
| meshoptimizer (npm) | 1.1.1 | Already in the lockfile (through `@types/three`), now a direct devDependency of the spike | MIT. Encoder in the spike bake; the decoder ships with three.js |

Newton was not installed because Blender was available. While doing this work, NvidiaWarp-GarmentCode was added to the banned list (`packages/tryon-providers/src/bannedModels.ts`, `docs/research/garment-engine.md` §7).

## 3. Method

Code: `spikes/garment-engine/serverdrape/` (Python, server) and `spikes/garment-engine/viewer/scripts/serverdrape/`, `viewer/src/morph*.ts` and `viewer/morph.html` (TS, spike only). Data is in `out/serverdrape/` (gitignored). `serverdrape/drape.sh` runs the whole pipeline.

### 3.1 Bodies: one shape axis (`anny_bodies.py`)

- **Axis.** t ∈ [-1, 1] runs along the skirt's own AU body chart: hip = 104 + 10t, waist = 77.5 + 10t. t = -1, 0, 1 are the chart bodies for AU 8, 12 and 16. The **held-out body is t = -0.4** (hip 100, waist 73.5). It is not a grid point, and it has the same hip as mannequin M, so it compares directly with the viewer baseline.
- **Body parameters.** Each body is a female Anny (gender 1, age 0.5, muscle 0.5) at mannequin M's stature of 168 cm. Gauss-Newton solves phenotype `height` and `weight` (with a soft prior weight ≈ 0.5 + 0.3t), the local change `measure-hips-circ-incr`, and a waist knob. The waist knob is `measure-waist-circ-incr` up to +1, then `torso-scale-horiz/depth-incr`, because on its own the local change tops out at about 79 cm on the AU 16 body. No phenotype is extrapolated.
- **Pose.** The arms are raised 20° beyond Anny's rest A-pose. In the rest pose the hands hang at the hip line, where the larger sizes would touch them.
- **Measures** (tape-like): convex-hull perimeter of the torso slice with the arms removed. Hip is taken at the fullest point of the buttocks; waist is the smallest girth between 59 % and 67 % of stature.

| Body | Target hip / waist | Achieved hip / waist | Hip height | CPU |
|---|---|---|---|---|
| t-1.00 (AU 8) | 94 / 67.5 | 94.0 / 67.5 | 89.8 | 1.4 s |
| t+0.00 (AU 12) | 104 / 77.5 | 104.0 / 77.5 | 89.7 | 1.7 s |
| t+1.00 (AU 16) | 114 / 87.5 | **113.2** / 87.2 (`hips` local change at its +1 limit) | 89.1 | 6.8 s |
| t-0.40 held out | 100 / 73.5 | 100.0 / 73.5 | 89.8 | 1.5 s |

**Mapping to the mannequin frame and anchors.** The mannequin frame is Y up, cm, floor at y = 0, front +Z (`packages/mannequin`). The conversion is `(x, y, z)_mannequin = 100 · (x, z − z_min, −y)_Anny`, a proper rotation with no mirror. x and z are then shifted so that the hip slice's bounding box is centred on the axis, as the mannequin's hip ellipse is (cx = cz = 0).

| Mannequin anchor | Taken from the Anny body |
|---|---|
| `hip` | girth and height from the slice at the fullest buttock |
| `waist` | the minimum girth in the window above |
| Knee and ankle heights | bone heads `lowerleg01.L` and `foot.L` |
| Crotch height | lowest torso vertex near the midline |

**Not mapped yet:** `thigh`, `calf`, the upper-body rings and the length lines.

**Placing the garment.** The garment is moved up by (body hip height − 87.36 cm, the mannequin hip) so that it sits on each body where it sat on mannequin M. The shift is +1.8 to +2.5 cm.

### 3.2 Rest geometry and the band (`export-rest.ts`, `band-model.json`, `band_model.py`)

- **Rest geometry per size.** This is exactly what the viewer drapes: `gradedMesh` (base.glb + grading.json, 6,558 vertices, 12,940 triangles).
  - Graded girth at y = 87: 97.6 / 107.6 / 117.7 cm for AU 8 / 12 / 16, a spread of **20.1 cm**.
  - Graded girth at y = 20: 107.9 / 118.9 / 129.8 cm, a spread of 21.9 cm.
  - The waistband particles are the top 4 cm (`waistbandPins`). Their graded girth is 77.4 / 85.4 / 93.3 cm.
- **Band model.** The waistband is **not measured**. `band-model.json` keeps `measured: null` and a template. When the founder has tape numbers, she fills `sampleSize`, `relaxedGirthCm`, `stretchedGirthCm` and `hemSweepCm`, and `BAND=measured serverdrape/drape.sh` reruns everything. Until then, these **ASSUMED** variants apply:

| Variant | Relaxed band girth (AU 8 / 12 / 16) | Meaning |
|---|---|---|
| W-6 (main run) | 61.5 / 71.5 / 81.5 | chart waist − 6 cm, graded |
| W-0 | 67.5 / 77.5 / 87.5 | chart waist |
| W-12 | 55.5 / 65.5 / 75.5 | chart waist − 12 cm (tight) |
| ONE-70 | 70 for every size | one band for all sizes ("every size hangs from the same band") |

All variants also assume a stretched girth of relaxed × 1.5, and elastic stiffness at 0.08 × the fabric stiffness. `hemSweepCm` is read but not yet used: the hem comes from the grading.

### 3.3 Drape (`drape_blender.py`, `run_grid.py`)

- **Solver.** Blender cloth: implicit mass-spring with angular bending, body collision (friction 10, outer thickness 3 mm), self-collision (2 mm), a floor at y = 0, gravity, **no pins and no cling**. The band is held up only by its own elastic tension and friction.
- **Band.** The band particles' rest lengths are shortened to the relaxed girth with Blender's per-vertex shrink. The shrink is isotropic, so the 4 cm band also gets shorter by the same factor.
  - **Defect found and fixed:** the first version set the band through a "rest shape key", and Blender 4.2 ignored it. Drapes with different band girths came out bit-identical (md5). They are kept as the control `NOBAND`: band at its graded girth, no elastic shortening.
- **Start shape.** The rest geometry is pushed radially out of the body plus 8 mm (rays from outside; arms ignored).
  - Blender builds its springs from this start shape. So where a size is smaller than the body, it starts at the body's girth and its tension there is **not** modelled. This matters for AU 8 on bodies above hip 97.6 cm; the band is the only part shortened on purpose.
- **Material.** Physical mass: 165 gsm spread over the particles, about 2.8e-5 kg each. Tension 10, compression 10, shear 5, bending 0.005; the band's tension and compression are 0.8.
  - These are **not calibrated** to the fabric. Stage 7 calibration is open.
  - Blender's preset vertex mass (0.15 kg) made the skirt fall to the floor (band at y = 35 cm), so the physical mass is used.
  - Bending between 0.0005 and 0.1 made no visible difference.
- **Settling.** After 72 frames (3 s) the mean particle movement is ≤ 0.04 cm per 4 frames. The maximum is ≤ 0.69 cm per 4 frames, from local jitter in a few particles (the hem at the feet). The drape is settled but not perfectly still. No particle ended inside the body in any drape.

### 3.4 Bake (`bake.ts`)

- **Contents per size.** The base is the drape on the grid body t = 0. Two morph targets carry POSITION and NORMAL deltas: drape(t = −1) − base and drape(t = +1) − base.
- **Device weights:** piecewise linear, `[max(0, −t), max(0, t)]`, clamped to [−1, 1] (`morphBlend.ts`). The one-target alternative `linear` ((D(+1) − D(−1)) / 2 · t) was measured too.
- **Packing.**
  - KHR_mesh_quantization. Positions and position deltas are int16 on a 0.005 cm grid, applied through the node's scale and translation. Normals and normal deltas are int8.
  - A second file adds EXT_meshopt_compression.
  - three.js loads both with `GLTFLoader` + `MeshoptDecoder`.
  - The page's CPU blend of the decoded file gives the same girths as the bake to 0.1 cm, which checks the quantisation round trip.

### 3.5 Device page (`viewer/morph.html`, `fps-morph.mjs`)

The page shows AU 8 / 12 / 16 side by side on the held-out body, labelled "estimate". The shopper's hip is typed in, stays in the tab and gives t (D3). three.js blends the morphs on the GPU. The page also blends on the CPU to measure the hip and hem girth with the same `girthAt` measure.

`fps-morph.mjs` (Playwright) runs a mobile viewport (412 × 915 at DPR 2.625 and DPR 1, touch) with CDP `Emulation.setCPUThrottlingRate` at 1x and 4x, with and without morph targets (`morph=0`).

## 4. Numbers

Girth means the convex-hull perimeter of the garment slice (`girthAt`, the same measure as `sizes-drape.ts`). Hip is measured at the body's hip height; hem is measured at y = 22 cm (≈ y = 20 on the mannequin plus the shift).

### 4.1 Direct server drapes, band W-6 (ASSUMED)

| Body | AU 8 hip / hem | AU 12 hip / hem | AU 16 hip / hem | Hip spread | Hem spread |
|---|---|---|---|---|---|
| t-1.00 (AU 8 body) | 102.9 / 111.9 | 109.6 / 120.6 | 118.0 / 130.8 | 15.1 | 18.9 |
| t+0.00 (AU 12 body) | 110.3 / 111.5 | 113.0 / 120.4 | 119.4 / 131.3 | 9.1 | 19.8 |
| t+1.00 (AU 16 body) | 118.8 / 112.5 | 119.0 / 120.0 | 121.4 / 130.4 | 2.6 | 17.9 |
| **t-0.40 held out** | 106.6 / 112.4 | 111.2 / 121.2 | 118.7 / 131.2 | **12.1 (60 %)** | **18.8 (86 %)** |

Graded spreads (rest geometry): hip 20.1 cm, hem 21.9 cm.

The hip spread shrinks as the body grows. On a large body every size that is smaller than the body is stretched to the body's girth. That is physics, not solver loss: it is what the shopper should see (tight). The hem stays free and keeps 82-90 % everywhere.

### 4.2 Blend on the held-out body versus its direct drape

| Basis | AU 8 hip / hem (direct) | AU 12 hip / hem (direct) | AU 16 hip / hem (direct) | Hip spread | Hem spread | Vertex RMS (cm), AU 8 / 12 / 16 |
|---|---|---|---|---|---|---|
| piecewise (2 targets) | 106.8 / 110.7 (106.6 / 112.4) | 111.2 / 120.2 (111.2 / 121.2) | 118.7 / 131.0 (118.7 / 131.2) | **11.9 (59 %)** | **20.3 (93 %)** | 2.21 / 1.39 / 0.37 |
| linear (1 target) | 107.1 / 111.0 | 111.4 / 119.7 | 119.1 / 131.5 | 12.0 (60 %) | 20.5 (94 %) | 2.04 / 1.33 / 0.57 |

- Vertex p95 is 0.7-2.8 cm and the maximum is 2.4-7.7 cm.
- The largest error is AU 8, where the band sits 2 cm higher on the AU 8 grid body (105.3 cm) than on the AU 12 grid body (103.2 cm).
- **Polish** (projection-only push-out, no cling; `polish_blender.py`): at most 4 particles of a blend were inside the body, at most 1.0 cm deep. The spreads with and without polish are identical, so the polish is not needed here.

### 4.3 Band sensitivity on the held-out body (direct drapes)

| Band (all ASSUMED) | Band height after settling, AU 8 / 12 / 16 (cm) | Hip spread | Hem spread |
|---|---|---|---|
| NOBAND (graded band, no elastic) | 102.2 / 103.5 / 101.2 | 12.3 (61 %) | 18.4 (84 %) |
| W-0 | 103.1 / 103.6 / 101.4 | 11.6 (58 %) | 17.5 (80 %) |
| W-6 | 105.3 / 106.1 / 102.8 | 12.1 (60 %) | 18.8 (86 %) |
| W-12 | 107.9 / 108.0 / 105.6 | 12.6 (63 %) | 24.9 (114 %) |
| ONE-70 | 103.0 / 106.6 / 107.4 | 13.1 (65 %) | **9.8 (45 %)** |

- The hip spread is robust to the band (58-65 %).
- The band does decide **how high the skirt sits**. A tight band climbs towards the narrower waist, which lifts the skirt up to about 5 cm. That moves the hem line, so the fixed-height hem measure swings from 45 % to 114 %.
- With one band for every size (ONE-70), the large size is pulled up the most and the hem difference halves.
- **This is why the measured band girth matters:** it decides the length and the hem difference, not the hip.

### 4.4 Bundle and device

| File (3 sizes, base + 2 targets each) | Bytes | gzip |
|---|---|---|
| `skirt-W-6-quant.glb` (KHR_mesh_quantization) | 790,892 | 539,101 |
| `skirt-W-6-meshopt.glb` (+ EXT_meshopt_compression) | **379,432** | 321,121 |

No texture or UVs are included. The production bundle would keep the stage-4t texture unchanged; morphs do not touch it.

Device page, EMULATED (Playwright, headless Chromium, SwiftShader, 4-core container under load average 8-17):

| Measure | Result |
|---|---|
| Load + decode (meshopt) | 90-112 ms at 1x, 300-410 ms at 4x CPU throttle |
| CPU blend + girth measure of 3 sizes | 10-59 ms |
| fps, all configurations (meshopt or quant, DPR 2.625 or 1, morph on or off, 1x or 4x) | 3.5-8 |

The fps spread comes from software rendering and machine load. Morph on versus off does not show above that noise, so **no fps conclusion can be drawn** from this container. The girths the page measured matched the bake to 0.1 cm in all 20 runs, with no page or console errors.

## 5. Renders (look at them; all labelled estimate)

Saved in `/tmp/claude-0/-home-user/45896997-2c70-517e-89a4-f66870da365e/scratchpad/step3/serverdrape/`. They are not committed: they are review images, flat colour, with no product texture.

| File | What it shows | Honest read |
|---|---|---|
| `heldout-front.png` | AU 8 / 12 / 16 direct drapes on the held-out body, front | The difference is visible: AU 16 is clearly wider at hip and hem, and AU 8 is narrower and sits a bit higher. All three look like **stiff, smooth tubes**: no vertical drape folds, unlike real viscose. That comes from the reconstructed rest shape plus uncalibrated stiffness |
| `heldout-side.png` | Same, side view | AU 16 has more depth. The hem **balloons in at the feet** (it looks like harem trousers from the side). The reconstructed hem reaches the floor and folds in against the feet and floor. This is the known R2 hem-over-feet defect of the stills, now visible in 3D |
| `blend-vs-direct.png` | Held-out body: blended morphs (B) next to the direct drape (D), AU 8 and AU 16 | B and D are hard to tell apart; small differences show at the band and the hem folds |
| `grid.png` | Grid drapes: b8 s8, b8 s16, b12 s12, b16 s8, b16 s16 | On the AU 16 body the AU 8 skirt is stretched and sits lower than AU 16; on the AU 8 body the AU 16 skirt is visibly baggy |
| `morph-W-6-t-0.40-meshopt-dpr2.625-m1-x1.png` | The device page in a 412 × 915 mobile viewport (emulated) | Works. The table shows the measured girths and the "estimate" label |

## 6. Caveats (what is assumed, simulated or unverified)

1. **The band is ASSUMED** (W-6 in the main run) and so is its stiffness. Band height, length and the hem difference depend on it (§4.3). The hip spread does not.
2. **The fabric is not calibrated.** The Blender stiffnesses are guesses between the silk and cotton presets. The skirt looks stiffer and smoother than viscose. More real folds would change the convex-hull girth only a little, but that is untested.
3. **A size smaller than the body has no tension modelled**, because the springs come from the pushed-out start shape. The band is the exception. AU 8 on the held-out body (graded hip 97.6 against a body of 100) therefore shows no strain. That is a fit-map question; sizing stays with `@curtain/fit-engine`.
4. **The rest geometry is the reconstructed run-17d mesh**, which has a hem that reaches the feet (REFINEMENT R2). It is not a sewing pattern, so R1 would give cleaner input.
5. **One axis, 3 grid bodies, 1 held-out body.** The axis is the chart line, so bodies off that line are untested, for example the same hip with a different waist, or a different height. The AU 16 body misses its hip target by 0.8 cm (Anny's `hips` local change hits its limit).
6. **fps is emulated and inconclusive** (SwiftShader on a loaded container). No real Android phone was available.
7. **CPU seconds** were measured while other agents loaded the 4-core machine (load average 7-17). CPU seconds are less affected than wall time, but expect ±30 %.
8. The hem girth is measured at a fixed height (y = 22). When the band lifts the skirt, the measure compares different parts of the hem. A hem-relative measure, at a fixed distance above the hem edge, would be fairer.

## 7. Next steps (if go)

1. Tape-measure the band (relaxed and stretched) and the hem sweep. Then run `BAND=measured serverdrape/drape.sh`. This is the single most important input.
2. Model tension for sizes smaller than the body: start from a cylinder that clears the body and sew it to the rest geometry, or shrink per vertex from the push-out.
3. Calibrate the fabric (stage 7) against a merchant video or the existing photos, so the cloth folds.
4. Measure fps and load time on one real mid-range Android (WebGL2), against `morph=0` as the control.
5. Add a second shape axis (height) and decide the grid density per size (plan risk: 8-12 drapes per size for 2 axes).
6. Production bundle: add UVs and texture, and the morph-weight rule in `grading.json` or the glTF extras (already in the spike's extras).

# Step 3 spike: server-side per-size drapes, morph blending on the device (route R2)

Date: 10 Nov 2026. Branch `claude/step3-serverdrape`. Plan: `docs/research/shortcut-to-step3.md` §4, days 2-5 (R2 spike). Product: the pilot maxi skirt (`out/eval/crimson-wildflower-maxi-skirt`, run 17d bundle). Every render and every number below is an **estimate** from a simulation. Nothing was measured on a real garment or a real phone.

## 1. Answer

Revised after review (second pass, same day). The first pass called this "a marginal GO on the hip, a clear GO on the hem". That overclaimed: the hem number was a fixed-height measure that the assumed band moved around, and the hip number depends on a solver parameter (the push-out offset). The numbers below replace it.

- **Go/no-go measure (plan):** more than about 60 % of the graded hip spread survives on a held-out body.
- **Measures.** Two families, both reported (§4):
  - *fixed height* (the first pass, `sizes-drape.ts` style): girth at the body's hip height and at y = 22;
  - *garment-relative* (new, `relgirth.ts`): **hipRel** = girth 14.2 cm below the garment's settled top edge (where the mannequin hip line sits in the rest geometry), **hemRel** = girth 15 cm above the settled bottom edge, and **hipRing** = the hull of the very particles that lie on the rest hip line. The graded reference is the same measure on the rest geometry (hip 20.0 cm, hem 22.5 cm). These do not slide along the garment when the band makes a skirt ride higher or lower.
- **Hip, held-out body (hip 100, waist 73.5), band W-6 (ASSUMED), push-out 0.8 cm (main run):**
  - direct server drape: fixed 12.1 cm (**60 %**), hipRel 13.5 cm (**68 %**), hipRing 14.4 cm (72 %);
  - device blend (what would ship): fixed 11.9 cm (**59 %**), hipRel 12.9 cm (**65 %**), hipRing 13.6 cm (68 %);
  - the viewer today: 5.7 cm (28 %, fixed height, mannequin M with the same 100 cm hip).
- **Hip sensitivity.** The push-out offset of the start shape (a solver parameter, §3.3) moves the hip result by about as much as the margin: offset 0.3 / 0.8 / 1.5 cm gives fixed 65 / 60 / 48 % and hipRel 70 / 68 / 57 % (§4.5). The assumed band (girth and stretch) moves it 58-65 % (fixed) and 61-78 % (hipRel) (§4.3). Modelling tension for sizes smaller than the body, which would remove the offset, was tried and failed in Blender (§4.5).
- **Hem.** The fixed-height hem number (45-114 % over the assumed bands) is not a garment property and is withdrawn. With the garment-relative measure the hem keeps **75-83 % on every band variant and push-out offset tried** (82 % direct and 87 % blended for W-6). The band is still unmeasured, so this is an estimate under assumed bands, but the band no longer drives the number.
- **Verdict: AT THE THRESHOLD on the hip, not a clean GO.** The blend is just below 60 % on the fixed-height measure and 65 % on the garment-relative one, and an unphysical solver offset moves either by 5-10 points. R2 keeps 2-2.5x what the viewer keeps (5.7 cm), so it is the better route, but the plan's 60 % bar is met only on the garment-relative measure and only for push-out ≤ 0.8 cm. **Hem: about 80 %, robust to the assumed band.** The decision on the hip should wait for the measured band and a solver that models tension (§7).
- **Blend error:** the girth from the blended morphs is within 0.2 cm of the direct drape at the fixed hip height, within 1.0 cm on hipRel and hipRing, and within 1.7 cm at the hem. Per vertex: 0.4-2.2 cm RMS (p95 0.7-2.8 cm).
- **Bundle:** 3 sizes × (base + 2 morph targets, positions and normals) come to **379 KB with meshopt (321 KB gzip)**, or 791 KB quantised only.
- **Cost:** **95 CPU-s median per drape** in the main run (74-115 s; 6,558 particles, 72 frames, quality 10, self-collision). 3 sizes × 3 grid bodies ≈ 15 CPU-minutes per product. The second-pass drapes ran at load average 4-12 and took 71-215 CPU-s.
- **fps:** not measurable here (SwiftShader in headless Chromium on a loaded container; 3.5-8 fps in every configuration, morph on or off). **EMULATED, not a phone.**

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
- **Band model.** The waistband is **not measured**. `band-model.json` keeps `measured: null` and a template. When the founder has tape numbers, she fills `sampleSize`, `relaxedGirthCm`, `stretchedGirthCm` and `hemSweepCm`, and `BAND=measured serverdrape/drape.sh` reruns everything. What each field does (also in the JSON's README):

| Field | Effect |
|---|---|
| `relaxedGirthCm` (+ `gradePerSizeCm`) | The band's rest girth per size: drives the drape (per-vertex shrink of the band particles) |
| `stretchedGirthCm` | The stretch ratio stretched / relaxed sets the band's tension stiffness: elastic = 0.08 × (1.5 − 1) / (ratio − 1) × the fabric stiffness. Drives the drape. The mapping (a linear spring, reference ratio 1.5 = the first pass's fixed 0.08) is ASSUMED |
| `hemSweepCm` | A **check**, not an input (the hem comes from the reconstructed garment): `drape.sh` prints a WARNING when the rest geometry's hem (largest girth in the bottom 25 cm, 109.1 / 120.7 / 132.2 cm for AU 8 / 12 / 16) differs from it by more than 5 % |

Drapes are cached by a key of the resolved band girths, stiffness, push-out and rest mode (`band_model.drape_key`), so correcting `measured` later re-drapes instead of silently reusing old drapes (first-pass drapes get their key from their recorded band numbers and the old defaults). Until then, these **ASSUMED** variants apply:

| Variant | Relaxed band girth (AU 8 / 12 / 16) | Meaning |
|---|---|---|
| W-6 (main run) | 61.5 / 71.5 / 81.5 | chart waist − 6 cm, graded |
| W-0 | 67.5 / 77.5 / 87.5 | chart waist |
| W-12 | 55.5 / 65.5 / 75.5 | chart waist − 12 cm (tight) |
| ONE-70 | 70 for every size | one band for all sizes ("every size hangs from the same band") |

All variants assume a stretched girth of relaxed × 1.5 (elastic stiffness 0.08 × the fabric's), except two stretch-sweep variants of W-6: `W-6-s1.25` (stretches 25 %, stiffness 0.16) and `W-6-s2.0` (stretches 100 %, stiffness 0.04).

### 3.3 Drape (`drape_blender.py`, `run_grid.py`)

- **Solver.** Blender cloth: implicit mass-spring with angular bending, body collision (friction 10, outer thickness 3 mm), self-collision (2 mm), a floor at y = 0, gravity, **no pins and no cling**. The band is held up only by its own elastic tension and friction.
- **Band.** The band particles' rest lengths are shortened to the relaxed girth with Blender's per-vertex shrink. The shrink is isotropic, so the 4 cm band also gets shorter by the same factor.
  - **Defect found and fixed:** the first version set the band through a "rest shape key", and Blender 4.2 ignored it. Drapes with different band girths came out bit-identical (md5). They are kept as the control `NOBAND`: band at its graded girth, no elastic shortening.
- **Start shape.** The rest geometry is pushed radially out of the body plus an offset (`--pushout`, 0.8 cm in the main run; rays from outside; arms ignored).
  - Blender builds its springs from this start shape (rest mode `pushed`). So where a size is smaller than the body, it starts at the body's girth **plus the offset** and has no tension there. The offset therefore sets the girth of a too-small size: on the held-out body AU 8 (graded hip 97.6) settles at 106.6 cm, and 2,089 / 1,059 / 410 of 6,558 particles are pushed for AU 8 / 12 / 16. The band shrink also acts on the pushed band girth, not on the graded one.
  - Rest mode `graded` (experimental, §4.5) adds a per-vertex shrink r_rest / r_start (floored at 0.9, only in the hip/waist zone) so the springs return towards the graded lengths. It did not work (§4.5); `pushed` stays the default.
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

Girth means the convex-hull perimeter of the garment slice (`girthAt`, the same measure as `sizes-drape.ts`). Fixed-height measures: hip at the body's hip height, hem at y = 22 cm (≈ y = 20 on the mannequin plus the shift). Garment-relative measures (`relgirth.ts`, §1): hipRel, hemRel and hipRing, against graded spreads of 20.0 / 22.5 / 20.0 cm on the rest geometry. Spreads are AU 16 − AU 8.

### 4.1 Direct server drapes, band W-6 (ASSUMED)

| Body | AU 8 hip / hem | AU 12 hip / hem | AU 16 hip / hem | Hip spread | Hem spread |
|---|---|---|---|---|---|
| t-1.00 (AU 8 body) | 102.9 / 111.9 | 109.6 / 120.6 | 118.0 / 130.8 | 15.1 | 18.9 |
| t+0.00 (AU 12 body) | 110.3 / 111.5 | 113.0 / 120.4 | 119.4 / 131.3 | 9.1 | 19.8 |
| t+1.00 (AU 16 body) | 118.8 / 112.5 | 119.0 / 120.0 | 121.4 / 130.4 | 2.6 | 17.9 |
| **t-0.40 held out** | 106.6 / 112.4 | 111.2 / 121.2 | 118.7 / 131.2 | **12.1 (60 %)** | **18.8 (86 %)** |

Graded spreads (rest geometry): hip 20.1 cm, hem 21.9 cm.

Garment-relative spreads, same drapes (hipRel / hemRel / hipRing, cm): AU 8 body 18.4 / 18.7 / 18.4; AU 12 body 8.7 / 18.4 / 9.7; AU 16 body 0.8 / 16.7 / 0.4; **held out 13.5 (68 %) / 18.5 (82 %) / 14.4 (72 %)**.

The hip spread shrinks as the body grows. On a large body every size that is smaller than the body is stretched to the body's girth. That is physics, not solver loss: it is what the shopper should see (tight). The hem stays free and keeps 82-90 % everywhere.

### 4.2 Blend on the held-out body versus its direct drape

| Basis | AU 8 hip / hem (direct) | AU 12 hip / hem (direct) | AU 16 hip / hem (direct) | Hip spread | Hem spread | Vertex RMS (cm), AU 8 / 12 / 16 |
|---|---|---|---|---|---|---|
| piecewise (2 targets) | 106.8 / 110.7 (106.6 / 112.4) | 111.2 / 120.2 (111.2 / 121.2) | 118.7 / 131.0 (118.7 / 131.2) | **11.9 (59 %)** | 20.3 (93 %) | 2.21 / 1.39 / 0.37 |
| linear (1 target) | 107.1 / 111.0 | 111.4 / 119.7 | 119.1 / 131.5 | 12.0 (60 %) | 20.5 (94 %) | 2.04 / 1.33 / 0.57 |

Garment-relative (hipRel / hemRel / hipRing spread): piecewise **12.9 (65 %) / 19.6 (87 %) / 13.6 (68 %)**; linear 12.5 (63 %) / 19.1 (85 %) / 13.9 (70 %). Blend minus direct, per size: hipRel +0.9 / +1.0 / +0.3, hemRel −1.5 / −1.0 / −0.4, hipRing +1.0 / +0.9 / +0.2 cm (AU 8 / 12 / 16).

- Vertex p95 is 0.7-2.8 cm and the maximum is 2.4-7.7 cm.
- The largest error is AU 8, where the band sits 2 cm higher on the AU 8 grid body (105.3 cm) than on the AU 12 grid body (103.2 cm).
- **Polish** (projection-only push-out, no cling; `polish_blender.py`): at most 4 particles of a blend were inside the body, at most 1.0 cm deep. The spreads with and without polish are identical, so the polish is not needed here.

### 4.3 Band sensitivity on the held-out body (direct drapes, push-out 0.8)

| Band (all ASSUMED) | Top edge after settling, AU 8 / 12 / 16 (cm) | Hip fixed | hipRel | hipRing | Hem fixed (y = 22) | hemRel |
|---|---|---|---|---|---|---|
| NOBAND (graded band, no elastic) | 104.6 / 105.8 / 103.4 | 12.3 (61 %) | 13.2 (66 %) | 12.8 (64 %) | 18.4 (84 %) | 18.2 (81 %) |
| W-0 | 105.2 / 105.7 / 103.6 | 11.6 (58 %) | 13.0 (65 %) | 13.5 (68 %) | 17.5 (80 %) | 17.3 (77 %) |
| W-6 | 106.9 / 108.0 / 104.8 | 12.1 (60 %) | 13.5 (68 %) | 14.4 (72 %) | 18.8 (86 %) | 18.5 (82 %) |
| W-12 | 109.1 / 109.6 / 107.2 | 12.6 (63 %) | 15.3 (77 %) | 16.9 (85 %) | 24.9 (114 %) | 18.3 (81 %) |
| ONE-70 | 105.1 / 108.6 / 108.4 | 13.1 (65 %) | 12.1 (61 %) | 8.1 (41 %) | 9.8 (45 %) | 17.5 (78 %) |
| W-6-s1.25 (stretches 25 %, stiffness 0.16) | 109.1 / 109.8 / 105.1 | 12.3 (61 %) | 15.5 (78 %) | 17.0 (85 %) | 25.0 (114 %) | 17.7 (79 %) |
| W-6-s2.0 (stretches 100 %, stiffness 0.04) | 105.3 / 106.8 / 104.4 | 12.6 (63 %) | 13.4 (67 %) | 13.8 (69 %) | 18.4 (84 %) | 17.4 (77 %) |

- **The stretched girth now matters** (review finding 3): with the same relaxed girth, a firm band (s1.25) holds the skirt 2-3 cm higher than a stretchy one (s2.0) and moves hipRel from 67 % to 78 %. So both band numbers the founder measures change the drape.
- The band decides **how high the skirt sits** (top edge 103-110 cm). That moved the fixed y = 22 hem line onto different parts of the hem, which is why the fixed hem number swung 45-114 %. Measured from each drape's own hem edge (hemRel), the hem spread is 77-82 % for every band and stretch variant.
- The hip is less robust than the first pass said: 58-65 % fixed, 61-78 % hipRel. hipRing collapses for ONE-70 (41 %): with one band for every size, AU 16 rides 3 cm higher than AU 8, so its hip-line fabric sits on a narrower part of the body.

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

The fps spread comes from software rendering and machine load. Morph on versus off does not show above that noise, so **no fps conclusion can be drawn** from this container. The girths the page measured matched the bake to 0.1 cm in all 10 runs (one per configuration, `fps-W-6.jsonl`; the first pass said 20 by mistake), with no page or console errors. Re-run after the review (`fps-W-6-v2.jsonl`, load average about 10): 10 of 10 runs again match the bake (piecewise AU 8 / 12 / 16 hip 106.8 / 111.2 / 118.7, hem 110.7 / 120.2 / 131.0), 0 errors, load + decode 68-83 ms at 1x and 297-351 ms at 4x, fps 6.4-11.1 (still SwiftShader noise, morph on or off).

### 4.5 Push-out offset and tension (held-out body, W-6, review finding 2)

| Start shape | AU 8 hip fixed / hipRel (cm) | AU 8 top edge | Hip fixed | hipRel | hipRing | hemRel | Inside body (AU 8) |
|---|---|---|---|---|---|---|---|
| pushed, offset 0.3 cm | 105.5 / 103.9 | 105.8 | 13.1 (65 %) | 14.0 (70 %) | 14.2 (71 %) | 18.6 (83 %) | 0 |
| **pushed, offset 0.8 cm (main)** | 106.6 / 104.6 | 106.9 | 12.1 (60 %) | 13.5 (68 %) | 14.4 (72 %) | 18.5 (82 %) | 0 |
| pushed, offset 1.5 cm | 109.0 / 107.2 | 106.6 | 9.7 (48 %) | 11.3 (57 %) | 11.8 (59 %) | 16.9 (75 %) | 0 |
| graded rest, floor 0.9, hip/waist zone | 102.9 / 107.9 | **96.5** | (16.4) | (10.4) | (11.8) | (18.5) | **336** |
| graded rest, floor 0.8 | n/a / 101.1 | **84.5** | n/a | (16.9) | (38.6) | (19.7) | **215** |
| graded rest, everywhere, no floor | n/a / 76.4 | **83.9** | n/a | n/a | n/a | n/a | 0 |

- **The offset matters.** AU 8 is smaller than this body at the hip, so it settles at body + offset + 3 mm collision thickness, and its girth follows the offset almost 1:1 (2π × 0.7 cm ≈ 4.4 cm from 0.8 to 1.5 cm; observed 2.4 cm fixed, 2.6 cm hipRel). AU 16 is larger than the body and does not change (118.6-118.7 cm). The review's estimate (about 80 % at 3 mm) did not hold: 3 mm gives 65 % fixed / 70 % hipRel, because the band and the vertical springs, not the offset alone, hold AU 8 out.
- **Tension (graded rest) failed.** Restoring the graded rest lengths with Blender's per-vertex shrink squeezes the too-small AU 8 hard enough that it slides 10-23 cm down the body, with the band crumpled, 215-336 particles inside the body and no settling (max move 2-2.7 cm per 4 frames at frame 72). Without the zone limit the legs (A-pose) and the inward-turned hem make it worse: some particles were pushed out by 1.9x. Values in brackets are measured on these failed drapes and are not usable. AU 12 and AU 16 behave normally in this mode. A rest shape key, the exact tool for this, is ignored by Blender 4.2 (re-tested: a cloth grid with a half-size rest key falls bit-identical to one without). See `tension-au8.png`.
- So the 60 % headline is a function of a solver parameter. The physically closest setting is the smallest offset that avoids start penetration (0.3 cm here, 65 % / 70 %); 0.8 cm was a robustness choice of the first pass.

## 5. Renders (look at them; all labelled estimate)

Saved in `/tmp/claude-0/-home-user/45896997-2c70-517e-89a4-f66870da365e/scratchpad/step3/serverdrape/`. They are not committed: they are review images, flat colour, with no product texture.

| File | What it shows | Honest read |
|---|---|---|
| `heldout-front.png` | AU 8 / 12 / 16 direct drapes on the held-out body, front | The difference is visible: AU 16 is clearly wider at hip and hem, and AU 8 is narrower and sits a bit higher. All three look like **stiff, smooth tubes**: no vertical drape folds, unlike real viscose. That comes from the reconstructed rest shape plus uncalibrated stiffness |
| `heldout-side.png` | Same, side view | AU 16 has more depth. The hem **gathers in at the ankles** (it looks like harem trousers from the side). Corrected cause (review): the settled hem bottom is 7-9 cm above the floor (lowest particle; bottom-ring mean 9-12 cm), so it is not floor contact. The reconstructed rest geometry itself turns inward below y ≈ 10 (AU 8: 107.9 cm girth at y = 20, 90.7 at y = 8, 72.5 at y = 3; hem edge 72.2 cm against a hem sweep of 109.1 cm). That inward-turned bottom (REFINEMENT R2 input defect) is what draws in |
| `blend-vs-direct.png` | Held-out body: blended morphs (B) next to the direct drape (D), AU 8 and AU 16, side view | Re-rendered: the first version cut the ESTIMATE title off (labels now placed from the camera frame). B and D are hard to tell apart; AU 16 is visibly deeper than AU 8. The hem gathers in at the ankles |
| `tension-au8.png` | Held-out body, AU 8: push-out 0.8 (main), 0.3, and the experimental tension mode | 0.8 and 0.3 look alike (the 1 cm hip difference is not visible). The tension drape has slid down to the hip line, with a crumpled band: a solver failure, not a fit |
| `grid.png` | Grid drapes: b8 s8, b8 s16, b12 s12, b16 s8, b16 s16 | On the AU 16 body the AU 8 skirt is stretched and sits lower than AU 16; on the AU 8 body the AU 16 skirt is visibly baggy |
| `morph-W-6-t-0.40-meshopt-dpr2.625-m1-x1.png` | The device page in a 412 × 915 mobile viewport (emulated) | Works. The table shows the measured girths and the "estimate" label |

## 6. Caveats (what is assumed, simulated or unverified)

1. **The band is ASSUMED** (W-6 in the main run) and so is its stiffness. Band height, length and the hem difference depend on it (§4.3). The hip spread does not.
2. **The fabric is not calibrated.** The Blender stiffnesses are guesses between the silk and cotton presets. The skirt looks stiffer and smoother than viscose. More real folds would change the convex-hull girth only a little, but that is untested.
3. **A size smaller than the body has no tension modelled**, because the springs come from the pushed-out start shape, and its girth there is set by the push-out offset (§4.5: hip result 48-65 % fixed, 57-70 % hipRel for offsets 1.5-0.3 cm). The attempt to model tension with Blender's per-vertex shrink failed (§4.5). AU 8 on the held-out body (graded hip 97.6 against a body of 100) therefore shows no strain. That is a fit-map question; sizing stays with `@curtain/fit-engine`.
4. **The rest geometry is the reconstructed run-17d mesh**, whose bottom turns inward below y ≈ 10 (REFINEMENT R2). It is not a sewing pattern, so R1 would give cleaner input, and it is also why "restore the graded rest lengths" is ill-posed: the rest shape is a drape on mannequin M, not the fabric's flat lengths.
5. **One axis, 3 grid bodies, 1 held-out body.** The axis is the chart line, so bodies off that line are untested, for example the same hip with a different waist, or a different height. The AU 16 body misses its hip target by 0.8 cm (Anny's `hips` local change hits its limit).
6. **fps is emulated and inconclusive** (SwiftShader on a loaded container). No real Android phone was available.
7. **CPU seconds** were measured while other agents loaded the 4-core machine (load average 7-17). CPU seconds are less affected than wall time, but expect ±30 %.
8. The fixed-height measures (hip at the body's hip y, hem at y = 22) compare different parts of the garment when the band lifts a skirt. They are kept for comparison with the viewer baseline; the garment-relative measures (§1) are the ones to decide on. They have their own assumption: the "hip line" is placed 14.2 cm below the settled top edge, as on mannequin M.
9. The stiffness mapping from the stretch ratio (§3.2) is a linear-spring assumption, calibrated only so that the first pass's 0.08 corresponds to ratio 1.5.

## 7. Next steps (if go)

1. Tape-measure the band (relaxed and stretched) and the hem sweep. Then run `BAND=measured serverdrape/drape.sh` (it re-drapes automatically and warns if the hem sweep disagrees with the reconstruction by more than 5 %).
2. Model tension for sizes smaller than the body with a solver that takes rest lengths separately from the start shape (Blender's per-vertex shrink failed, §4.5): e.g. a small custom XPBD/mass-spring pass server-side with rest lengths from the graded mesh (or from R1 pattern pieces), started from a clearance cylinder. Until then, report the hip result as a range over the push-out offset.
3. Calibrate the fabric (stage 7) against a merchant video or the existing photos, so the cloth folds.
4. Measure fps and load time on one real mid-range Android (WebGL2), against `morph=0` as the control.
5. Add a second shape axis (height) and decide the grid density per size (plan risk: 8-12 drapes per size for 2 axes).
6. Production bundle: add UVs and texture, and the morph-weight rule in `grading.json` or the glTF extras (already in the spike's extras).

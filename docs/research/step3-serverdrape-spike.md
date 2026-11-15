# Step 3 spike: server-side per-size drapes, morph blending on the device (route R2)

Date: 10 Nov 2026. Branch `claude/step3-serverdrape`. Plan: `docs/research/shortcut-to-step3.md` §4, days 2-5 (R2 spike). Product: the pilot maxi skirt (`out/eval/crimson-wildflower-maxi-skirt`, run 17d bundle). Every render and every number below is an **estimate** from a simulation. Nothing was measured on a real garment or a real phone.

> **Caveat added 14 Nov 2026 (shop tape of the pilot skirt):** every "% of the graded spread survives" figure in this document divides the draped spread by the graded spread of the *reconstructed mesh* (about 20 cm AU 8→16, from the chart's 5 cm hip step), not of the real garment. The tape shows that mesh has 46–50 % of the real hem sweep and a chart hip 6–20 cm below the tape's. The figures describe what the drape does to the mesh; they do not say how much of the real skirt's size difference shows. See `docs/REFINEMENT.md` R3 (13–14 Nov) and "Tape measurements of the pilot skirt" in `spikes/garment-engine/README.md`.

**Update 14 Nov 2026:** the shop tape-measured the skirt. §8 has the measured band on this mesh, the finding that the reconstructed mesh has half the real hem, and variant POM (a rest geometry from tape measurements alone). §1-§7 are the 10 Nov state under assumed bands.

**Update 15 Nov 2026:** §9 applies the founder's answers (worn just below the navel, pull-on, gathered into the band, on-model images AI-generated): POM v2. It withdraws §8.6 (the photo comparison) and the tier and slit readings of §8, and replaces §8.5's band model and §8.8's verdict.

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

## 8. Tape measurements of the real skirt, and variant POM (14 Nov 2026)

Branch `claude/tape-serverdrape`. The shop tape-measured the pilot skirt in AU 8, 10 and 14 (`spikes/garment-engine/data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json`, the single source of truth). Everything below is still an **estimate** from a simulation; only the five tape numbers per measured size are measurements.

Provenance used everywhere in this section: **AU 8, 10, 14 = measured. AU 12 = INTERPOLATED** (linear in the AU size number between 10 and 14). **AU 16 = EXTRAPOLATED** (the AU 10-14 slope continued by one size: value(16) = value(14) + (value(14) − value(10)) / 2). Rule in `band_model.tape_value`; `rest.json`, the drape JSON and the render labels carry it.

| Full girth, cm | AU 8 (measured) | AU 10 (measured) | AU 12 (INTERPOLATED) | AU 14 (measured) | AU 16 (EXTRAPOLATED) |
|---|---|---|---|---|---|
| Band relaxed | 67 | 71 | 75.5 | 80 | 84.5 |
| Band stretched | 94 | 100 | 105 | 110 | 115 |
| Hip | 112 | 122 | 124 | 126 | 128 |
| Hem sweep | 230 | 248 | 254 | 260 | 266 |
| Length | 103 | 103 | 103.5 | 104 | 104.5 |

### 8.1 What the tape says about the reconstructed mesh (verified)

- **Hem.** `band_model.py` on the reconstructed rest geometry warns for every size: hem sweep 109.1 / 114.9 / 120.7 / 126.4 / 132.2 cm (AU 8-16, widest ring; the hem edge itself is 72-88 cm) against the tape's 230 / 248 / 254 / 260 / 266: **−50 to −54 %**. The reconstruction has half the real hem.
- **Hip.** The reconstructed rest hip (hull at the mannequin hip line) is 97.4 / 102.4 / 107.4 / 112.4 / 117.4 cm against the tape's 112 / 122 / 124 / 126 / 128: **14.6 / 19.6 / 16.6 / 13.6 / 10.6 cm too small**. The reconstruction is the garment as it hangs on a model (folds closed), not the cut.
- **Band.** Relaxed 67 cm (AU 8) is the chart waist of the size (67.5); stretched 94 cm is the chart hip (94). A pull-on band that just clears the hips. Stretch ratio 1.36-1.41 (assumed before: 1.5).
- **Uneven hip steps (reported, not corrected):** 112 → 122 (+10 cm for one size) → 126 (+4 cm for two sizes). The hem steps are also uneven (+18, then +12 for two sizes); the band steps are even (4-4.5 cm per size relaxed). The hip line of an A-line skirt is not a seam, so the measuring height probably differed per size. Consequence here: AU 12 (interpolated) gets hip 124, and the POM "hip spread" AU 8-14 of 14 cm rests on that uneven AU 10 step. To ask the shop: at what distance below the band was the hip measured?

### 8.2 Measured band on the reconstructed mesh (`BAND=measured serverdrape/drape.sh`)

`band-model.json` `measured` now points at the tape file; `band_model.py` resolves relaxed and stretched girth per size (the single-sample form still works; tests in `test_band_model.py`). Held-out body (hip 100, waist 73.5), direct drapes, push-out 0.8 cm, spread = AU 16 − AU 8 (AU 16 band extrapolated, AU 12 interpolated):

| Band | Top edge after settling, AU 8 / 12 / 16 (cm) | Hip fixed (cm) | hipRel (cm) | hipRing (cm) | Hem fixed, y = 22 (cm) | hemRel (cm) |
|---|---|---|---|---|---|---|
| **measured** (67 / 75.5 / 84.5, ratio 1.36-1.40) | 105.9 / 106.5 / 104.0 | 11.6 | 13.3 | 13.5 | 17.9 | 17.7 |
| W-0 (ASSUMED 67.5 / 77.5 / 87.5) | 105.2 / 105.7 / 103.6 | 11.6 | 13.0 | 13.5 | 17.5 | 17.3 |
| W-6 (ASSUMED) | 106.9 / 108.0 / 104.8 | 12.1 | 13.5 | 14.4 | 18.8 | 18.5 |
| W-12 (ASSUMED) | 109.1 / 109.6 / 107.2 | 12.6 | 15.3 | 16.9 | 24.9 | 18.3 |
| ONE-70 (ASSUMED) | 105.1 / 108.6 / 108.4 | 13.1 | 12.1 | 8.1 | 9.8 | 17.5 |

- **W-0 was closest** (band = chart waist): same hip spread, top edges within 0.4-0.8 cm, hem within 0.4 cm. The main run's W-6 sat the skirt 0.8-1.5 cm too high. W-12 and ONE-70 were wrong.
- Settled band (mean height / girth): AU 8 103.8 cm / 82.2 cm, AU 12 104.3 / 81.9, AU 16 101.9 / 86.6. Blend on the held-out body (piecewise): hip fixed 12.0, hipRel 13.1, hipRing 13.2, hemRel 18.6 cm; vertex RMS 1.18 / 0.84 / 0.50 cm. Bundle 377,072 bytes meshopt (790,916 quantised). 0 particles inside the body. 109-143 CPU-s per held-out drape.
- So the measured band changes little on this mesh. The spreads are given in cm only: §1-§4 quote them as a percentage of the reconstruction's own graded spread (20 cm hip, 22 cm hem), and the tape shows that reference is wrong (the mesh's hip is 11-20 cm smaller and its hem half the real one), so a percentage of it means nothing. The real spread AU 8 to AU 16 is 16 cm at the hip and 36 cm at the hem on the flat garment (AU 16 extrapolated). The hem-sweep warning is the important output of this run.

### 8.3 Variant POM: a rest geometry from the five tape numbers alone (`pom_rest.py`)

Our own numpy code, no pattern library, no photo reconstruction. Per size, one plain A-line cone over an ellipse, developable (every ring has exactly its girth, every meridian exactly the tape length; `test_pom.py`).

What the tape pins and what is placed by assumption:

| Tape number | How it enters the shape | Status |
|---|---|---|
| Hem sweep | girth of the bottom edge | pinned by the tape |
| Length | length of every meridian | pinned by the tape |
| Hip | girth of the ring **20 cm below the top edge** | value from the tape, **position ASSUMED** (the shop's sketch gives no distance) |
| Band stretched | girth of the fabric at the top edge | value from the tape, **role ASSUMED** (an elastic casing stretches until the fabric lies flat) |
| Band relaxed | rest length of the top 4 cm (ASSUMED band height) | value from the tape; the force behind it is ASSUMED (§8.5) |

So two of the five numbers shape the skirt without an assumption about where they apply. The girth profile between them is ASSUMED piecewise linear. **The product photos show that the real skirt is not one plain cone**: it has a gathered tier seam at roughly 60 % of the length (a near-straight upper part with a gathered flounce below, which is where most of the 230-266 cm sweep comes from) and a side slit to mid-thigh. Five numbers on a cone cannot express either (§8.6).

Mesh (changed after review): 12,197 particles, 24,126 triangles, one topology for all sizes, **uniform density** (each ring has girth / 1.3 cm particles, rings 1.0-1.14 cm apart; fabric area per particle varies 1.21-1.39 cm² within AU 8 and 1.33-1.56 cm² (mean) across sizes). The first POM mesh had 120 particles on every ring and wider ring spacing towards the hem; Blender gives every particle the same mass, so its hem fabric was about 6 times lighter per unit area than its band fabric. On the uniform mesh the same drape (AU 8, held-out body, band force 3 ×, floor at 0) has a hem-edge hull of 147.1 cm instead of 156.8 cm: the heavier hem collapses further. UVs map onto the stage-4t texture's cylinder layout (the print is then stretched sideways about 2x).

Cloth preset `viscose-soft` (`drape_blender.py`), **ASSUMED, not calibrated**: Blender's Silk mass 0.15, bending 0.05, shear and compression 5, air drag 1; Cotton's tension 15 and damping 5. Rationale: the first runs used the physical particle mass with stiffness constants Blender tunes for 0.15-0.3 kg particles, which made the cloth orders of magnitude too stiff per unit weight (the "stiff tubes"); this preset runs in the regime of Blender's own fabric presets and takes the drapiest one that does not stretch. **The fabric's 165 gsm does not enter the simulation at all.** The particle mass is the preset's (scaled by the size's area per particle, so every size has the same simulated weight per unit area) and the band force is a multiple of that simulated weight, so a heavier or lighter fabric would drape identically. "Viscose 165 gsm" is met only by the choice of preset. Gravity ramps on over frames 10-30; 144 frames.

### 8.4 What is imposed and what is a result

`pom_measure.py` reports, for the ring of particles at the tape's hip line and at the hem edge, the length of that ring after draping. On the held-out body these are 112.4 / 121.2 / 122.9 / 125.2 / 127.2 cm (hip) and 230.0 / 248.0-248.1 / 254.0 / 260.0 / 266.0 cm (hem) for AU 8-16, and the length along the fabric is 102.3-104.1 cm. **These equal the tape because `pom_rest.py` built those rings at the tape girth and the cloth hardly stretches** (strain mean 0.1 %, p5-p95 −0.7 to +1.0 %). They are a sanity check that nothing stretched, not agreement with ground truth, and their "spread" (12.8 cm hip, 30 cm hem for AU 8-14) is the input read back. The same holds for the hem check of +0.0 % that `band_model.py` prints for the POM rest geometry. The first version of this section presented them as results; that was wrong.

The simulation's outputs are: the convex hulls of cross-sections, where the band settles, the silhouette, and whether the drape comes to rest. Only those are used below.

### 8.5 POM on the held-out body (hip 100, waist 73.5): simulation outputs

Uniform mesh. **Floor lowered 40 cm** (as if the body stood on a plinth), so that every hem hangs free: on the 168 cm body the 103 cm skirt reaches the floor, and in the first runs the hems of AU 14 and 16 crumpled on it, which made their hem hulls a measure of floor contact (156.8 / 166.2 / 168.3 / 185.1 / 178.2 cm then). The lowered floor also showed that in the first runs the piled-up hem had been holding the larger sizes up.

The band force is **ASSUMED**: the pull at the measured stretched girth, as a multiple of the skirt's (simulated) weight. Nobody measured it. Three values:

| Band force | | AU 8 (measured) | AU 10 (measured) | AU 12 (INTERPOLATED) | AU 14 (measured) | AU 16 (EXTRAPOLATED) |
|---|---|---|---|---|---|---|
| 3 × | Band height (cm) | 104.3 | 102.3 | 100.2 | 97.2 | 90.8 |
| 5 × | | 106.1 | 104.5 | 102.0 | 100.0 | 97.9 |
| 8 × | | 106.6 | 106.0 | 103.7 | 101.2 | 99.0 |
| 3 × | Band girth, settled (cm; relaxed 67 / 71 / 75.5 / 80 / 84.5) | 79.6 | 83.7 | 84.8 | 90.2 | 103.7 |
| 5 × | | 80.9 | 78.9 | 82.8 | 86.2 | 88.5 |
| 8 × | | 72.8 | 80.7 | 80.0 | 82.2 | 86.2 |
| 3 × | Hem-edge hull, mean of the last 24 frames (min-max) (cm) | 146.2 (144.8-147.1) | 148.5 (147.7-149.0) | 150.5 (150.2-150.8) | 155.2 (153.6-156.5) | 159.1 (158.4-160.0) |
| 5 × | | 143.5 (140.3-145.9) | 146.6 (144.6-148.4) | 156.8 (154.8-157.6) | 158.4 (156.0-159.7) | 156.7 (155.4-157.6) |
| 8 × | | 142.9 (141.3-144.3) | 144.5 (142.9-146.9) | 150.8 (149.8-152.8) | 160.4 (157.1-163.1) | 154.2 (152.6-157.4) |
| 3 × | Hull 15 cm above the hem (cm) | 140.5 | 143.2 | 144.5 | 149.2 | 152.4 |
| 8 × | | 138.0 | 140.7 | 145.8 | 153.9 | 150.1 |
| 3 × | Hull at the body's hip height (cm) | 107.5 | 109.6 | 108.8 | 108.8 | 107.4 |
| 8 × | | 109.4 | 110.3 | 110.7 | 110.9 | 110.7 |
| 3 × | Hull of the tape's hip-line ring (cm; flat 112 / 122 / 124 / 126 / 128) | 107.9 | 112.5 | 112.8 | 114.9 | 116.7 |
| 8 × | | 102.9 | 108.8 | 112.1 | 114.2 | 115.1 |
| 3 × | Particle movement at frame 144, max / mean (cm per frame) | 0.75 / 0.06 | 0.74 / 0.05 | 0.66 / 0.03 | 0.68 / 0.05 | 0.92 / 0.15 |
| 8 × | | 1.17 / 0.17 | 1.17 / 0.11 | 0.85 / 0.08 | 0.52 / 0.06 | 0.40 / 0.07 |
| 3 × | Particles inside the body (p95 depth, cm) | 0 | 0 | 0 | 0 | 6 (0.4) |
| 5 × | | 3 (0.4) | 0 | 0 | 0 | 0 |
| 8 × | | **112 (5.7)** | 0 | 0 | 0 | 0 |

Reading (outputs only):

- **No hip signal.** At the body's hip height the hull is 107.4-110.9 cm for every size and every band force: each size is wider than this body there and hangs past it. The hull of the hip-line ring spreads 7.0 cm (3 ×) or 11.3 cm (8 ×) between AU 8 and AU 14, against 14 cm on the flat garment, and that ring sits at a different height in every size because the band does.
- **The hem hull does separate the sizes, weakly.** AU 14 − AU 8: 9.0 cm (3 ×), 14.9 cm (5 ×), 17.5 cm (8 ×), against 30 cm of flat sweep. The range over the last 24 frames of one drape is 0.6-6 cm, AU 16 falls below AU 14 at 5 × and 8 ×, and the result moves by up to 6 cm with the band force. Treat the hem hull as good to about ±5 cm. The 28.3 cm reported in the first version came from hems lying on the floor.
- **Where the band sits is not a prediction.** It moves 2.3-8.2 cm with the assumed band force (AU 16: 90.8 → 99.0 cm) and, in the first runs, with whether the hem rested on the floor. The size-to-size drop in band height (7.1 cm at 3 ×, 5.4 cm at 8 ×, AU 8 to AU 14) was the main visible size difference in the renders, so that cue is an assumption until the band pull is measured. The reconstructed mesh with the same measured band sat at 103.8 / 104.3 / 101.9 cm (AU 8 / 12 / 16).
- **Neither band force gives clean drapes across the range.** At 3 × a size much larger than the body slides off: with the gravity ramp moved later (frames 40-60, to let the band contract first) AU 16 fell to the floor on both the held-out and the AU 8 body, and at 5 × it fell on the AU 8 body. The band does not reach its relaxed girth in the simulation (AU 16 lay on the floor at 93.6 cm, relaxed 84.5 cm): the gathered fabric resists it. At 8 × a size much smaller than the body cuts into it: 112-304 particles up to 5.7-8.5 cm inside the body in 4 of 12 drapes (AU 8 on the held-out, AU 12 and AU 16 bodies; AU 12 on the AU 16 body). The band model, as simulated, is not validated.
- **None of these drapes is at rest.** With the hem free, mean particle movement stays at 0.03-0.17 cm per frame (0.7-4 cm/s) and does not decay between frame 120 and frame 216 (one 216-frame run). The trace is per frame, sampled every fourth frame; the first version called it "per 4 frames" and called 0.02-0.04 settled. In the first run's grid, four of twelve drapes were failed or clearly still sliding, not the two reported: AU 16 on the AU 8 body (fell to 22 cm), AU 16 on the held-out body (1.98 / 0.20), AU 12 on the AU 8 body (1.56 / 0.13), AU 16 on the AU 12 body (2.19 / 0.13); AU 8 on the AU 16 body was also above the rest (0.78 / 0.10).
- **AU 8 on this body is a combination the tape rules out**: its band stretches to 94 cm and the body's hip is 100 cm, so it could not be pulled on. The drape starts with the skirt already at the waist. Sizing stays with `@curtain/fit-engine`; the render titles now say this.

Morph bake and blend (band force 8 ×, floor lowered; 9 grid drapes + 3 held-out):

- Bundle: **749,004 bytes meshopt (663,825 gzip)**, 1,467,096 quantised (1,067,632 gzip); 3 sizes × (base + 2 targets), 12,197 vertices. 2.0x the reconstructed mesh's 377 KB.
- Blend against the direct drape on the held-out body, vertex RMS / p95: AU 8 8.5 / 16.0 cm, AU 12 2.9 / 5.6 cm, AU 16 2.3 / 4.3 cm. AU 8's three grid drapes include two with the band inside the body and AU 12's include one, so only **AU 16 (extrapolated size) is a clean test: 2.3 cm RMS, blended hem hull 146.0 against 150.1 cm direct, hip-line ring 113.8 against 115.1 cm**. The reconstructed mesh blended at 0.5-1.2 cm RMS.
- So the first version's "2.3-2.6 cm RMS" was partly contaminated by sliding drapes, and this run's AU 8 and AU 12 figures are contaminated by cut-through. On the one clean case the error is still 2-5 cm per vertex and the hem loses 4 cm of hull. The cause (folds in different places on each grid body, or drapes that never come to rest) is not separated.
- Cost: 189 CPU-s median per POM drape (154-252; 24 drapes), about 40 CPU-minutes per product for 3 sizes × 4 bodies. Measured with other agents on the 4-core machine (load average 5-12): expect ±30 %.

### 8.6 Silhouette against the product photos

The shop has three on-model photos (front, back, side/three-quarter; not in the repo). `pom_measure.py --photo-mask` gives the garment mask's width as a fraction of its visible length; `front` in its output gives the same for a drape. The photographed size and the model's measurements are **unknown**; perspective and pose are not corrected, so this is good to a few percent of the length. Compared with AU 8 on the held-out body, band force 3 × (AU 10, the AU 8 body and 8 × differ by at most 0.03):

| Width / length at | 20 % (hip) | 50 % (knee) | 70 % | 80 % | 90 % |
|---|---|---|---|---|---|
| Front photo (weight on one leg, legs together, slit side away) | 0.33 | 0.37 | 0.43 | 0.44 | 0.37 |
| Back photo (feet apart; above 40 % the arms cover the edges) | ≥ 0.36 | 0.44 | 0.50 | 0.53 | 0.55 |
| POM AU 8 | 0.41 | 0.47 | 0.50 | 0.52 | 0.54 |
| POM AU 8 on the AU 8 body, 8 × | 0.39 | 0.46 | 0.50 | 0.51 | 0.53 |
| Reconstructed mesh AU 8 | 0.40 | 0.38 | 0.43 | 0.43 | 0.43 |

- From the knee down, POM's front width is within 0.03 of the length (3 cm) of the **back** photo, and 7-17 cm wider than the **front** photo. The reconstructed mesh matches the front photo it was built from and is 7-13 cm narrower than the back photo.
- At the hip line POM is 7 cm wider than the front photo (and up to 5 cm wider than the back photo, whose edges the arms cover there): the real skirt lies close over the hips and POM stands off them. That is consistent with the real cut being near-straight down to the tier seam.
- The two photos of the same skirt differ from each other by more than POM differs from the back photo. So the photos do not show that POM is too wide (the review's concern: POM's hull 15 cm above the hem is 138-154 cm against about 112 cm for the reconstruction), and they do not validate it either: a width is one projection, the depth is unseen, and the photos show a tier and a slit that POM does not have.

### 8.7 Renders (all labelled ESTIMATE; measured / INTERPOLATED / EXTRAPOLATED in the labels)

In `/tmp/claude-0/-home-user/45896997-2c70-517e-89a4-f66870da365e/scratchpad/tape/serverdrape/`, not committed (the first run's are in `v1/` there). AU 8 / 12 / 16 side by side because the reconstructed drapes exist for those sizes; `pom-all-front.png` shows all five. POM drapes: band force 3 × (ASSUMED), floor lowered 40 cm, so the bodies appear to float and the hems hang below the feet.

| File | Honest read |
|---|---|
| `compare-front.png` | Reconstruction (left three): narrow lumpy sacks, hem narrower than the hip, sizes differ only in width. POM (right three): a plain flared maxi skirt, smooth cone with a few broad, shallow vertical folds and a slightly rippled hem. AU 8 at the waist, AU 12 lower, AU 16 on the hips with the hem 10 cm below the feet. It reads as an A-line skirt, not as this product: no tier, no slit, far fewer and shallower folds than the photos, band gathers barely visible. Flat colour reads pink, not crimson |
| `compare-side.png` | Reconstruction: hem drawn in at the ankles in every size. POM: clean A-line, AU 12 and 16 swing backwards at the hem; AU 16 hangs from the hips |
| `pom-all-front.png` | AU 8-16: the band drops steadily from waist to hip and the hem gets a little wider. The width difference between neighbouring sizes is hard to see; the band height is the visible cue, and that follows the assumed band force |
| `pom-bandforce.png` | AU 8 and AU 14 at 3 × / 5 × / 8 ×. AU 14 rises about 4 cm from 3 × to 8 ×; AU 8 changes little in height but at 8 × the band is visibly bunched (it cuts into the body) |
| `pom-textured.png` | AU 8 and 14 with the stage-4t texture: print blurred, washed out and stretched sideways, pale bands. Not usable; needs a texture made for this layout |

### 8.8 Verdict

**Tape measurements are necessary. Whether they are sufficient is not shown.** NO-GO for treating the photo reconstruction as the garment's cut. **No GO yet** for "five tape numbers as the engine's main input for skirts"; the earlier GO is withdrawn.

- **Supported by measurement:** the reconstruction has half the real hem (−50 to −54 %) and a hip 11-20 cm too small, in every size, and no band or solver setting repairs that. Any engine that needs the garment's girths needs them from a tape (or a flat-lay), not from on-model photos.
- **Not supported:** that a cone built from five numbers hangs like the real skirt. Its "agreement with the tape" is imposed (§8.4). Against the photos it is close to one and 7-17 cm wider than the other (§8.6). It lacks the tier and the slit. The cloth parameters, the band force, the hip depth and the role of the stretched girth are assumed; one product, one body height, one shape axis.
- **What the simulation outputs say about size:** on a body smaller than the garment, the hip hull does not distinguish sizes; the hem hull does by 9-18 cm over AU 8-14, within ±5 cm; the band height does visibly but follows an unmeasured force.
- **Still not solved, independent of the input:** the band model (slides off at 3-5 ×, cuts in at 8 ×), drapes that do not come to rest, and the device blend (2-5 cm error on the one clean case).

What to ask of each merchant, per skirt, flat, on at least 3 sizes (smallest, largest, one in between; others interpolated and labelled; measuring the end sizes avoids extrapolation such as AU 16 here):

1. waistband relaxed;
2. waistband stretched to its comfortable limit;
3. hip width at a **stated distance below the band** (20 cm, the same for every size);
4. hem sweep;
5. length, band to hem.

This product shows five are not enough for a tiered or slit skirt. Also needed there, once per style (not per size): the distance from the band to each tier seam and the girth just above it, and the slit length. And one number that decided the drapes here: the pull needed to stretch the band to its limit (a luggage scale), or failing that the garment's weight.

Before a go/no-go on POMs as the main input: (a) the shop states the photographed size and the model's height, hip and waist, and the same comparison is run on a matching body, ideally against a flat-lay or hanger photo too; (b) a tiered POM variant (two cones with a gathered seam) is tried on this product; (c) the band pull is measured.

Sizing decisions remain with `@curtain/fit-engine`; nothing here feeds it.

### 8.9 Open after this run

1. Hip depth (20 cm ASSUMED) and the uneven hip steps (112 → 122 → 126): ask the shop. AU 16's hip (128) continues the +2 cm per size slope of AU 10-14 although AU 8-10 is +10; keep AU 16 out of any headline.
2. Band force ASSUMED; the simulated band neither grips like a real elastic nor stays out of the body (§8.5).
3. Cloth parameters ASSUMED; 165 gsm does not enter; folds are far broader and shallower than the photos.
4. Tier seam and slit are not modelled.
5. Drapes do not come to rest with a free hem; the blend is untested on clean, settled drapes for AU 8 and 12. The morph page was not re-run for POM.
6. No texture for the POM layout.
7. Only 168 cm bodies, one shape axis, one held-out body; the hem measurements use a lowered floor.
8. `--bandforce`, `--air`, `--floor` and `--ramp` are now part of the drape cache key (`band_model.drape_key`).

## 9. POM v2: the founder's answers applied (15 Nov 2026)

Branch `claude/pom-v2`. The founder answered the open questions of §8.9 (`founderAnswers` in `spikes/garment-engine/data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json`; in chat, not yet confirmed with the shop). This section applies them and re-runs variant POM. Run: `serverdrape/pom2.sh` (from `spikes/garment-engine`). Everything below is still an **estimate** from a simulation; only the five tape numbers of AU 8, 10 and 14 are measurements. **AU 12 = INTERPOLATED, AU 16 = EXTRAPOLATED**, as in §8.

**Answer in one paragraph** (corrected after review, §9.12). With the band pinned at a level set by rule and the panel gathered into it, "tape measurements in, 3D skirt out" runs without a tuned force and gives a picture that reads as a gathered maxi skirt: all 35 drapes that were started finished with no particle inside the body. **25 of the 32 free-hem drapes are at rest** after 144 frames by the stated threshold; seven still have a particle moving 0.25-0.35 cm per frame, among them AU 14 on the held-out body, and the two drapes with the floor in place do not settle at all. The band cannot fail because it is pinned: that is the rule, not a result. One combination is not draped because the band is 1.7 cm short at the **assumed** level; it would be drawn if the band sat 0.7 cm higher, so that refusal is a property of the assumed offset, not of the garment (§9.2). The verdict is a **conditional GO for this one garment on these bodies** (§9.10), not a route proven for elastic-waist skirts in general. It is **not** shown to be a likeness of this skirt: the only pictures it was ever compared with are AI-generated, the cut between the tape points is assumed, and the drape says little about size (on one body the five sizes differ by 1-4 cm in front width). The size information is in the band table (§9.2), which is arithmetic on the tape and an assumed level, and belongs to `@curtain/fit-engine`.

### 9.1 What changed, and what is withdrawn from §8

| Founder answer | Applied as | Status |
|---|---|---|
| Worn above the hip, just below the navel | The band is **pinned** on rings round the body at that level (`wear_rule.py`, `drape_blender.py --wear navel`). Band height and band girth are no longer simulated | **imposed by rule** |
| Pull-on elastic, no zip, no drawstring | No closure is modelled. Reported: stretched band against the body's widest girth below the band (§9.2) | arithmetic on the tape; not a sizing decision |
| On-model images are AI-generated | The images are no longer evidence of anything about the garment | see "withdrawn" below |
| Gathered directly into the waistband | The panel's top edge is longer than the band and is laid onto it in folds (§9.3) | fold count at the seam **imposed**, top-edge girth **ASSUMED** |
| Slit length unknown, estimate it | No slit is built (§9.4) | no non-AI evidence that there is one |
| Garment weight unknown | Cloth preset still ASSUMED; weight sensitivity in §9.7 | open |
| Hip depth not answered | 20 cm below the band's top edge, still ASSUMED | open |

**Withdrawn from §8** (kept there as the record of that run, not as findings):

- **§8.6, the comparison with the product photos**, entirely. The photos are AI-generated; neither "POM is within 3 cm of the back photo" nor "7-17 cm wider than the front photo" says anything about the real skirt. With it goes the review's worry that POM is too wide and the reply that the photos do not show it: there is no reference left either way.
- **"A gathered tier seam at roughly 60 % of the length"** (§8.3, §8.8) and **"a side slit to mid-thigh"**: both were read off those images. The repo's product text has neither (§9.4). The request in §8.8 to measure tier seams is withdrawn for this product; whether it has tiers is now a yes/no question to the shop.
- **"Elastic drawstring waist visible in every photo"** (`products.json` `selection.why`): from the same images; the founder says there is no drawstring.
- **§8.5's band results** (band height per size, "slides off at 3-5 x", "cuts in at 8 x") describe a band model that is no longer used. In v2 those two failures **cannot occur, by construction**: the band's particles are pinned, so nothing slides and nothing is squeezed. That is the rule being imposed, not the simulation getting better. What v1 called the main visible size cue (the band dropping 13.5 cm from AU 8 to AU 16 on the held-out body) was an artefact of an assumed force and is gone.
- **§8.8's request for "the pull needed to stretch the band"**: not needed any more; the band's force no longer enters.

Still valid from §8: the tape table, §8.1 (the reconstruction has half the real hem), §8.4 (ring lengths equal the tape because they were built that way), the mesh and cloth-preset description in §8.3.

### 9.2 The wear rule and the pull-on check (numbers only, no simulation)

**Navel.** A landmark, not a proportion: Anny's mesh is MakeHuman's, and MakeHuman's own navel modifier (`stomach-navel-in`) moves exactly 19 vertices; the navel height is their mean height on the posed body (`anny_bodies.py`, `achieved.navelY`). On the six bodies it is 102.5-103.0 cm, 0.610-0.613 of the 168 cm stature (the usual anthropometric figure is about 0.60, so Anny's navel is about 2 cm high). The mean of the 19 vertices is 0.3 cm above the navel pit itself (the 9 vertices with the full displacement: 101.8-103.4 cm, centre about 102.7; review). **"A landmark, not a proportion" is untested**: all six bodies are 168 cm tall, and on them the landmark cannot be told from 0.613 x stature. Whether it follows the navel on a taller, shorter or long-waisted body has not been run.

**Rule** (`wear_rule.py`): the band's top edge sits **2 cm under the navel (ASSUMED offset)**, the band is **4 cm high (ASSUMED)**, so the gather seam is 6 cm under the navel (about 97 cm above the floor). The band's girth is the body's girth at the band's mid height (convex hull of the torso section, as a tape lies), clamped to the tape's [relaxed, stretched]. The body widens quickly there: on the held-out body the hull is 82.7 cm at the band's top edge, 87.0 at its middle and 91.0 at the seam.

How the band holds, every size on every body (cm the band is stretched beyond relaxed; AU 12 INTERPOLATED, AU 16 EXTRAPOLATED):

| Body (hip / girth at the band / widest hull below it) | AU 8 (67-94) | AU 10 (71-100) | AU 12 (75.5-105) | AU 14 (80-110) | AU 16 (84.5-115) |
|---|---|---|---|---|---|
| chart AU 8 (94.0 / 80.8 / 96.0) | +13.8 | +9.8 | +5.3 | +0.8 | **loose by 3.7** |
| chart AU 10 (99.0 / 86.0 / 100.9) | +19.0 | +15.0 | +10.5 | +6.0 | +1.5 |
| held-out (100.0 / 87.0 / 101.9) | +20.0 | +16.0 | +11.5 | +7.0 | +2.5 |
| chart AU 12 (104.0 / 89.8 / 106.0) | +22.8 | +18.8 | +14.3 | +9.8 | +5.3 |
| chart AU 14 (109.0 / 92.8 / 111.1) | +25.8 | +21.8 | +17.3 | +12.8 | +8.3 |
| chart AU 16 (113.2 / 95.7 / 115.4) | **cannot be worn** (body 1.7 over the stretched limit) | +24.7 | +20.2 | +15.7 | +11.2 |

- No size holds relaxed on any of these bodies: below the navel every body is wider than every band's relaxed girth except AU 16 on the AU 8 body, which is **loose by 3.7 cm at the assumed level**. By the rule it is still drawn at that level and flagged; a real loose band would slip down to where the body is as wide as the band, which is not simulated.
- AU 8 on the AU 16 body is **1.7 cm over the stretched limit at the assumed level** and is **not draped** (`pom2-edge-cases-front.png` shows the body alone with that label).
- On its own chart body every size is stretched by 11-15 cm, about half its stretch range (27-30.5 cm).

**Every cell depends on the assumed level; the two edge cases are inside its uncertainty** (review finding; `pom2_measure.py placement`, `wear_rule.placement_sensitivity`). Below the navel the body's girth changes by **2.1-2.4 cm per cm of height** (held-out body: 91.0 / 89.1 / 87.0 / 84.9 / 82.7 cm with the band 2 cm lower, 1 lower, as assumed, 1 higher, 2 higher). So moving the band 1 cm moves every number in the table above by about 2 cm. The level is uncertain by at least 2 cm: the 2 cm offset and the 4 cm band height are ASSUMED and Anny's navel is about 2 cm high. With a stated uncertainty of ±2 cm (not measured), **7 of the 30 cells change class**:

| Size on body | At the assumed level | Changes to | when the band sits |
|---|---|---|---|
| AU 8 on chart AU 16 | cannot be worn (1.7 over) | holds | 0.7 cm higher |
| AU 8 on chart AU 14 | stretched +25.8 (1.2 under the limit) | cannot be worn | 0.6 cm lower |
| AU 10 on chart AU 16 | stretched +24.7 | cannot be worn | 1.9 cm lower |
| AU 16 (EXTRAPOLATED) on chart AU 8 | loose by 3.7 | holds | 1.5 cm lower |
| AU 14 on chart AU 8 | stretched +0.8 | loose | 0.6 cm higher |
| AU 16 (EXTRAPOLATED) on chart AU 10 | stretched +1.5 | loose | 0.9 cm higher |
| AU 16 (EXTRAPOLATED) on held-out | stretched +2.5 | loose | 1.5 cm higher |

Two more change between 2 and 2.5 cm (AU 8 on chart AU 12: cannot be worn 2.1 cm lower; AU 12 on chart AU 8: loose 2.4 cm higher). The other 21 cells keep their class over ±2.5 cm, among them every size on its own chart body and one size either side of it. **What the table supports:** a size holds, stretched, on its own chart body and on the neighbouring ones. **What it does not support:** "AU 8 cannot be worn by the AU 16 body" or "AU 16 is loose on the AU 8 body" as findings about the garment. Those two are true only at 2 cm under an Anny navel; the refusal to drape is a consequence of that choice. A band three sizes too small or too large is still plainly a poor fit, but the tape and this rule cannot say on which side of the limit it falls.

**Pull-on.** The band at its stretched limit against the body's girth it has to pass. Margin in cm, two readings: against the chart **hip** (hull at the fullest point of the seat) / against the **widest hull** between the band and the crotch, which is about 2 cm more and 4 cm lower (y = 85-86 cm). Negative = the band does not pass at the pull the shop called comfortable.

| Body | AU 8 | AU 10 | AU 12 INTERPOLATED | AU 14 | AU 16 EXTRAPOLATED |
|---|---|---|---|---|---|
| chart AU 8 | +0.0 / −2.0 | +6.0 / +4.0 | +11.0 / +9.0 | +16.0 / +14.0 | +21.0 / +19.0 |
| chart AU 10 | −5.0 / −6.9 | +1.0 / −0.9 | +6.0 / +4.1 | +11.0 / +9.1 | +16.0 / +14.1 |
| held-out (hip 100) | −6.0 / −7.9 | +0.0 / −1.9 | +5.0 / +3.1 | +10.0 / +8.1 | +15.0 / +13.1 |
| chart AU 12 | −10.0 / −12.0 | −4.0 / −6.0 | +1.0 / −1.0 | +6.0 / +4.0 | +11.0 / +9.0 |
| chart AU 14 | −15.0 / −17.1 | −9.0 / −11.1 | −4.0 / −6.1 | +1.0 / −1.1 | +6.0 / +3.9 |
| chart AU 16 | −19.2 / −21.4 | −13.2 / −15.4 | −8.2 / −10.4 | −3.2 / −5.4 | +1.8 / −0.4 |

- **Every size passes its own chart body by 0-2 cm on the hip and misses by 0.4-2 cm on the widest hull.** The stretched band is cut to the chart hip with nothing to spare. One size down is 4-6 cm short on the hip; one size up clears it by 5-6 cm.
- **The widest-hull reading is refuted by its own diagonal** (review finding). A shop's size 8 goes on a size 8 body; a check that says it misses by 2.0 cm is measuring something else: the shop's *comfortable* stretch against a rigid convex hull of a posed mesh, stepping in only (a real hip compresses, a band stretches past comfortable, a skirt can go on over the head). So the check has no absolute zero. It is usable only **relative to the diagonal**: "as on its own chart body" (hip margin within ±2.5 cm), "clear" (more), "short at the shop's stretch" (less). The renders now print both margins and one of those three phrases, and no longer print "FAILS" or "marginal" (v2's first renders labelled AU 8 on its own chart body "pull-on: FAILS by 2.0 cm").
- On the held-out body (hip 100): AU 8 is short (−6 / −7.9), AU 10 is as on its own chart body (0 / −1.9), AU 12 and up are clear. The drapes of AU 8 and AU 10 on it are drawn anyway, with that on the label; whether a short band hides a size is `@curtain/fit-engine`'s decision.

### 9.3 The gathered panel (`pom_rest.py --profile tube | cone`)

The tape does not give the panel's top-edge girth. Two readings, both **ASSUMED**; the first is the default:

| Profile | Top edge | Below | Tape hip at 20 cm |
|---|---|---|---|
| **tube** (default) | = the tape hip girth (112 / 122 / 124 / 126 / 128) | constant to the hip line 20 cm below the top, then linear to the hem | honoured |
| **cone** (comparison) | = the tape hip girth | one cone to the hem | **not** honoured: 134.9 / 146.5 / ... there (it reads the tape "hip" as the girth of the gathered top edge, hip depth 0) |

Not offered: one cone through the tape hip at 20 cm and the hem. Its top edge would be 83.6 / 91.6 / 94.1 cm (AU 8 / 10 / 14), shorter than the band's measured stretched girth (94 / 100 / 110), so the band could not stretch that far. The tape rules a plain cone out, if the hip was measured at 20 cm (`test_wear_rule.py`).

How the gather is built (`wear_rule.pleated_ring`, `drape_blender.py`): the start shape is the developable rest shape with its top edge at the wear level; the band's particles are then moved over frames 1-24 onto their rings. The four band rings above the seam become smooth rings 0.6 cm off the body (a collision margin, not a garment property). The seam ring keeps the fabric's full length and is laid in radial folds, **one fold per 4 mesh particles (ASSUMED)**: 30 folds round the seam, 3.3 cm apart, 0.9-1.4 cm deep. Real gathers are finer (1-2 cm); the pitch here is set by the mesh (16,071 particles, 1.0 cm along a ring; §8's mesh had 1.3 cm). Because of the margin and the fold depth the simulated seam's centre line is 97.7-99.1 cm on the held-out body where the body is 91.0 cm: the fabric (112-128 cm) is gathered 1.15-1.29 : 1 in the simulation, against 1.29-1.47 : 1 on the real band at 87 cm. The band casing itself is drawn smooth; a real elastic casing is ruched.

Imposed: the seam's fold count and depth, and with them the seam ring's stand-off from the body (§9.5). Simulated: what the folds do from about 5 cm below the seam (§9.5).

**The drawn band is not a model of the band** (review finding). The four rings above the seam are the panel's own mesh rings, whose rest length is the fabric's 112-128 cm, pinned as smooth rings of 86.4 / 88.6 / 90.7 / 92.8 cm on the held-out body: 17-31 % shorter than their rest length, with no folds, and then a jump to the folded seam ring (hull 99.9-102.5 cm) within 1 cm of height. They are the same for every size on one body (the one exception: AU 16's top ring is 88.2 cm, because the body there, 82.7 cm, is smaller than AU 16's relaxed band). Nothing simulated depends on them, since pinned particles do not move and their springs to each other do nothing; they are only what the render shows as a band, and in the render the fabric under the band stands out from it like a ledge. A stretched elastic band does lie on the body at the body's girth whatever the size, so "the same for every size" is what the rule says; but the casing's ruching, its thickness and its height are not modelled.

### 9.4 Slit, tiers, lining, fabric: what the repo's product text says

Searched `spikes/garment-engine/data/bohohippychic/` for slit, tier, lining and fabric. The only shop text about this product is the sentence quoted in `products.json` `evidence`: *"Crafted from lightweight, breathable rayon, this flowing maxi skirt features a rich crimson base adorned with soft floral detailing and a contrasting border hem"*, plus *"elasticated waistband"* and the sizing note. **No slit, no tier, no lining is mentioned.** Every other mention of a slit or a tier in the data (`selection.why` "side with slit", `phase0-written.md`, `review.json`) describes the on-model images or frames generated from them.

So: **v2 is built without a slit and without tiers**, and that is an assumption by absence, not a finding. A slit variant was not built (there is nothing to estimate its length from). The "contrasting border hem" is a print or a facing at the hem; it adds no geometry here. Rayon = viscose: consistent with the preset's fabric, no weight stated.

### 9.5 Simulation outputs on the held-out body (hip 100, waist 73.5), profile tube

16,071 particles, 144 frames, cloth preset `viscose-soft` (ASSUMED, §8.3), **floor lowered 40 cm** (the body on a plinth, as §8.5) so the hem hangs free. One drape per size; a repeat of AU 10 and AU 14 gives the run-to-run noise (Blender's solver is not deterministic across threads).

**Imposed (read back, not results):** band top edge at 100.97 cm; the band's girth by rule is the body's at the band's mid height, 87.0 cm, on every size (the rings actually drawn are 86.4-92.8 cm, §9.3); the hip-line ring is 112.0 / 121.6 / 123.5 / 125.4 / 127.4 cm and the hem ring 230.0 / 248.1 / 254.0 / 260.0 / 266.1 cm long (the tape; fabric strain mean 0.04 %, p5-p95 −0.5 to +0.6 %, **over the mesh edges that touch no pinned particle**: the band rings, compressed 17-31 %, and the seam are left out).

**Follows from what is imposed** (listed as simulated before the review; `followsFromImposed` in `pom2_measure.py`). These are not drape results:

| | AU 8 (measured) | AU 10 (measured) | AU 12 (INTERPOLATED) | AU 14 (measured) | AU 16 (EXTRAPOLATED) |
|---|---|---|---|---|---|
| Hem height above the soles (cm): draped / band top minus tape length | −1.9 / −2.0 | −1.8 / −2.0 | −2.4 / −2.5 | −2.8 / −3.0 | −3.3 / −3.5 |
| Pinned seam ring: hull (cm), over the body's 91.0 there | 99.9 | 101.6 | 101.9 | 102.2 | 102.5 |
| Folds two mesh rings (2 cm) under the seam: count (30 imposed at the seam), ring length / hull | 33, 1.09 | 36, 1.16 | 38, 1.18 | 35, 1.18 | 35, 1.20 |
| Particles inside the body in the band and seam rings | 0, by construction (pinned 0.6 cm off the body) | | | | |

- The hem's height is the rule plus the tape: the drape changes it by 0.1-0.2 cm.
- A count of 33-38 folds two rings under a pinned 30-fold sinusoid is the counter's noise on a shape the pins still dictate, not folds appearing.
- The seam ring stands 8.9-11.5 cm of girth off the body (clearance plus fold depth), 7 cm above the body's hip.

**Simulated:**

| | AU 8 (measured) | AU 10 (measured) | AU 12 (INTERPOLATED) | AU 14 (measured) | AU 16 (EXTRAPOLATED) |
|---|---|---|---|---|---|
| Hem-edge hull, mean of the last 24 frames (min-max) (cm) | 140.4 (140.3-140.5) | 143.6 (143.2-143.7) | 146.3 (145.8-146.5) | 146.9 (146.2-147.3) | 148.2 (147.7-148.4) |
| same, repeat run | | 143.1 | | 145.6 | |
| Hem: front width / side depth (cm) | 49.7 / 34.8 | 51.0 / 35.8 | 52.6 / 36.0 | 52.6 / 35.7 | 53.7 / 35.6 |
| At the knee (y = 47.5): hull, width / depth (cm) | 122.7, 44.7 / 30.5 | 125.8, 44.9 / 31.4 | 126.7, 44.9 / 31.9 | 128.0, 46.5 / 31.9 | 128.0, 46.9 / 31.5 |
| At the body's hip (y = 89.8): hull, width / depth (cm) | 106.6, 38.2 / 27.4 | 108.6, 39.1 / 28.1 | 108.9, 39.0 / 28.2 | 109.6, 39.8 / 27.9 | 109.9, 40.0 / 28.1 |
| Folds 5.5 cm below | 22 | 24 | 23 | 24 | 26 |
| Folds 11 cm below: count, depth p95 (cm) | 14, 1.2 | 16, 1.9 | 16, 2.1 | 15, 2.3 | 17, 2.4 |
| Folds at the tape's hip line (18 cm below): count, depth p95 (cm) | 15, 1.9 | 15, 2.7 | 16, 2.9 | 14, 3.1 | 16, 3.1 |
| Particle movement, last 24 frames: mean / largest (cm per frame) | 0.006 / 0.22 | 0.008 / 0.11 | 0.009 / 0.10 | 0.011 / 0.26 | 0.013 / 0.23 |
| At rest by the stated threshold | yes | yes | yes | **no** (largest 0.26) | yes |
| Particles inside the body, below the seam | 0 | 0 | 0 | 0 | 0 |
| Particles pushed out of the body in the start shape | 240 | 0 | 0 | 0 | 0 |

Reading (outputs only):

- **Most drapes are at rest at frame 144, not all.** By the stated threshold (mean < 0.02 and largest < 0.25 cm per frame over the last 24 frames) **25 of the 32 free-hem drapes of 144 frames are at rest**. The seven that are not all pass on the mean (0.010-0.015) and miss on the largest single particle (0.25-0.35 cm per frame): AU 14 on the held-out body (0.264; its repeat 0.254; at 200 gsm 0.324), AU 16 on the chart AU 8 body (0.347) and on the chart AU 12 body (0.292), and the cone's AU 10 (0.309) and AU 16 (0.277). Five of the seven are AU 14 or AU 16: the sizes with the most fabric settle last. Mean movement is 0.004-0.015 cm per frame over all 32 (§8.5: 0.03-0.17 and not decaying); the hem hull moves 0.1-1.1 cm over the last 24 frames (§8.5: 0.6-6 cm). The one 288-frame run (AU 10) decays to 0.001 cm per frame by frame 230 and its hem hull ends at 142.8 cm, **0.8 cm below its value at frame 144**: "at rest" at 144 frames still means the hem hull is within about 1 cm of where it ends. Whether AU 14 and AU 16 settle with more frames was not run. The two drapes with the floor in place are not at rest at all (below). That the cloth settles this far is a simulation result which the pinned band makes possible: nothing slides any more.
- **0 particles inside the body in all 35 drapes** (free hem, floor, both profiles, three weights, the clearance run). Below the seam that is a result of the collision handling; in the five pinned rings it is by construction.
- **The gathers carry down.** From the 30 imposed folds at the seam the cloth has 22-26 folds at 5.5 cm and 14-17 from 11 cm down, where they are 1.2-3.1 cm deep: the fine folds merge into about 15 broader ones that run on over the hip. That larger sizes have deeper folds (1.9 → 3.1 cm at the hip line) is what one expects from more fabric on the same band, but how much more fabric is the **assumed** top edge (= the tape hip girth, §9.3); it is not evidence about the real skirt's grading.
- **Sizes differ little on one body.** Hem hull AU 8 → AU 14: +6.5 cm (30 cm on the flat garment); AU 8 → AU 16: +7.8 cm. Front width at the hem 49.7 → 53.7 cm, at the knee 44.7 → 46.9 cm, at the hip 38.2 → 40.0 cm. The single runs are in size order, but two repeats differ from their first run by 0.5 and 1.3 cm and the long run by 0.8 cm, so **only steps larger than about 1.5 cm are resolved**: AU 8 against AU 10 (3.2 cm) and AU 10 against AU 12 (2.7) are; AU 12 against AU 14 (146.3 against 146.9; the repeat of AU 14 is 145.6, which would put it *below* AU 12) and AU 14 against AU 16 (1.3) are not. "Monotone in all five sizes" is not shown; "AU 8 < AU 10 < the three larger sizes" is.
- **The hull at the body's hip is not a clean drape output, and there is no hip signal in it.** It is 106.6-109.9 cm for every size (body 100), 6.6-9.9 cm more than the body. But the fabric is held off the body by the pinned seam ring 7 cm above, and keeps most of that distance on the way down (garment hull minus body hull, held-out body):

  | cm below the seam | 0 (pinned) | 1 | 3 | 5 | 7 (body's hip) | 10 | 13 |
  |---|---|---|---|---|---|---|---|
  | AU 8 (measured) | 8.9 | 7.8 | 7.2 | 7.0 | 6.5 | 6.0 | 6.8 |
  | AU 14 (measured) | 11.2 | 9.8 | 9.7 | 9.9 | 9.5 | 9.6 | 11.6 |

  To see how much of the hip hull is the seam's, AU 8 and AU 14 were draped once more with the pinned rings 1.6 cm off the body instead of 0.6 (`--clearance 1.6`, set `clear16`; one run each):

  | Held-out body | AU 8, 0.6 cm | AU 8, 1.6 cm | AU 14, 0.6 cm | AU 14, 1.6 cm |
  |---|---|---|---|---|
  | Pinned seam ring, hull (cm) | 99.9 | 105.0 (+5.1) | 102.2 | 107.7 (+5.5) |
  | Hull at the body's hip (cm) | 106.6 | 108.2 (+1.6) | 109.6 | 111.8 (+2.2) |
  | Hull at the knee (cm) | 122.7 | 122.7 (0.0) | 128.0 | 129.0 (+1.0) |
  | Hem-edge hull (cm) | 140.4 | 140.4 (0.0) | 146.9 | 146.8 (−0.1) |

  The hip hull moves by 30-40 % of what the seam ring moves (run-to-run noise there: 0.2 cm); the knee and the hem do not follow (within the 0.5-1.3 cm noise). So of the 6.6-9.9 cm by which the skirt stands off the hip, roughly 3-4 cm is the imposed seam (a linear extrapolation to a seam lying on the body, which cannot be run: the collision margin needs the 0.6 cm), and the rest is the fabric being wider than this body. Some stand-off is real (112-128 cm of fabric gathered onto about 90 cm does not lie flat), but its size here comes from the collision margin and the mesh-limited fold depth, not from the garment. The same goes for the "body's hip plus 6.6-8.7 cm" of the own-body table below. What survives: every size is wider than this body at the hip and hangs past it; the hip hull follows the body and the seam, not the size. The garment's hip line (20 cm below the band's top) lies at y = 81 cm with the wear rule, 9 cm below the body's hip and at crotch height; the tape's "hip" is not measured where the hip is when the skirt is worn below the navel.
- **The hem is at or below the soles, by arithmetic.** Band top at 101 cm (rule, assumed level) minus 103-104.5 cm of tape length puts the hem 2.0-3.5 cm below the soles of a 168 cm body before any drape; the drape leaves it at 1.8-3.3 cm. This is not a simulation finding, and it moves cm for cm with the assumed band level and with the 2 cm by which Anny's navel is high. With the floor where it is (`floor0`, AU 10 and 14) the hem piles up, does **not** come to rest (mean 0.10 cm per frame, largest 1.0-1.2) and its hull is 146 and 161 cm, a measure of the pile. Either the real skirt is worn with heels or by taller women, or "length" was measured differently (from the band's lower edge the hem would be 4 cm lower still), or the wear level is higher than 2 cm under the navel. To ask.
- AU 8 on this body: 240 start particles were pushed out of the body at the seat (ratio ≥ 0.94), so that zone starts up to 6 % larger than the tape; its hull at the hip may be overstated by up to that.

**Each size on its own chart body** (band stretched 11-15 cm; AU 12 INTERPOLATED, AU 16 EXTRAPOLATED):

| | AU 8 on AU 8 | AU 10 on AU 10 | AU 12 on AU 12 | AU 14 on AU 14 | AU 16 on AU 16 |
|---|---|---|---|---|---|
| Hem-edge hull (cm) | 140.5 | 143.2 | 146.1 | 149.0 | 150.0 |
| Hem width / depth (cm) | 50.7 / 34.6 | 50.4 / 35.4 | 52.6 / 36.5 | 52.4 / 36.1 | 53.2 / 37.9 |
| At the knee: hull (cm) | 119.3 | 125.0 | 128.7 | 132.4 | 135.2 |
| At the body's hip: hull (cm), body hip | 101.4, 94.0 | 107.7, 99.0 | 111.8, 104.0 | 115.9, 109.0 | 119.8, 113.2 |
| Pinned seam ring, hull (cm), body there (imposed) | 95.0, 85.2 | 100.7, 90.0 | 104.4, 93.9 | 107.7, 97.4 | 110.7, 100.4 |
| Movement mean / largest (cm per frame); at rest | 0.006 / 0.08; yes | 0.007 / 0.19; yes | 0.009 / 0.14; yes | 0.012 / 0.14; yes | 0.011 / 0.09; yes |

The hem hull is set by the size, not the body (140.5 against 140.4 for AU 8 on the two bodies; AU 14: 149.0 against 146.9; noise about 1.5 cm). The hull at the hip is the body's hip plus 6.6-8.7 cm in every case: it follows the body and the pinned seam ring (body + 9.8-10.5 there), not the garment's 112-128 cm.

### 9.6 What moves the result besides size

Held-out body, hem-edge hull (cm):

| Change | AU 8 (measured) | AU 10 (measured) | AU 12 (INTERPOLATED) | AU 14 (measured) | AU 16 (EXTRAPOLATED) |
|---|---|---|---|---|---|
| tube (default) | 140.4 | 143.6 | 146.3 | 146.9 | 148.2 |
| **cone** (top edge = hip, one cone) | 145.5 | 147.5 | 148.1 | 148.6 | 149.9 |
| cone − tube | +5.1 | +3.9 | +1.8 | +1.7 | +1.7 |
| mesh edge 1.3 cm instead of 1.0 (12,365 particles, 24 folds) | | 149.9 (+6.3) | | | |
| repeat of the same drape | | 143.1 (−0.5) | | 145.6 (−1.3) | |
| 288 frames instead of 144 | | 142.8 (−0.8) | | | |
| pinned rings 1.6 cm off the body instead of 0.6 (§9.5) | 140.4 (0.0) | | | 146.8 (−0.1) | |

- **Profile.** The cone is 1.7-5.1 cm wider at the hem and 3-5 cm wider at the knee (127.8-132.0 against 122.7-128.0), and its size spread is smaller (AU 8 → 14: 3.1 cm against 6.5). In the renders the two are hard to tell apart. Which the real skirt is, is not known.
- **Mesh.** The same garment on the coarser mesh has a 6.3 cm larger hem hull. That is as large as the whole AU 8 → AU 14 difference. Absolute hull values are good to about ±6 cm; differences between sizes on one mesh are good to about ±1.5 cm (two repeats: 0.5 and 1.3 cm; 144 against 288 frames: 0.8 cm). That is two repeats and one long run, not a noise distribution.

### 9.7 Fabric weight

The band no longer depends on weight (v1's band force was a multiple of the skirt's weight; that is gone). Weight still enters in one way: in Blender's cloth gravity scales with the particle mass and the spring and bending forces do not, so a heavier fabric of the same stiffness sags more. The preset stands for 165 gsm (ASSUMED); two other plausible viscose weights, stiffness unchanged (`--massscale`):

| Hem-edge hull (cm), held-out body | 120 gsm | 165 gsm (preset; two runs) | 200 gsm |
|---|---|---|---|
| AU 10 (measured) | 145.6 | 143.6, 143.1 | 144.2 |
| AU 14 (measured) | 145.7 | 146.9, 145.6 | 145.7 |

**Weight barely enters.** The hem hull moves by at most 2.5 cm between 120 and 200 gsm, not monotonically, against 0.5-1.3 cm between two runs of the same drape; at the hip and knee the differences are under 1.6 cm, and the renders look the same. So the unknown garment weight is not what limits this result. What "weight" cannot stand in for is the fabric's stiffness and bending, which are the preset's and uncalibrated.

### 9.8 v1 against v2, and the device blend

Held-out body:

| | v1 (§8.5, band force 3 x, plain cone) | v2 (band placed, tube, gathered) |
|---|---|---|
| Band height AU 8 / 14 / 16 (EXTRAPOLATED) (cm) | 104.3 / 97.2 / 90.8 (**simulated**, followed the assumed force) | 99.0 for every size (**imposed by rule**) |
| Hem height AU 8 / 14 / 16 (EXTRAPOLATED) (cm) | +5.7 / −2.9 / −10.3 | −1.9 / −2.8 / −3.3 (**imposed**: band top minus the tape length) |
| Hem-edge hull AU 8 / 10 / 12 (INTERPOLATED) / 14 / 16 (EXTRAPOLATED) (cm) | 146.2 / 148.5 / 150.5 / 155.2 / 159.1 | 140.4 / 143.6 / 146.3 / 146.9 / 148.2 |
| Hem hull AU 8 → AU 14 | +9.0 | +6.5 |
| Hull at the body's hip (cm) | 107.4-109.6 | 106.6-109.9 (about 3-4 cm of it from the pinned seam ring, §9.5) |
| Movement at frame 144, mean (cm per frame) | 0.03-0.15 | 0.006-0.013 |
| At rest at frame 144 | none | 25 of 32 free-hem drapes; the floor drapes not |
| Band failures | slides off (AU 16), cuts in at higher force (AU 8) | cannot occur (pinned); one combination not draped, 1.7 cm over at the assumed level |
| Mesh | 12,197 particles, 1.3 cm | 16,071 particles, 1.0 cm (so the two hem hulls are not directly comparable: §9.6) |

v1's larger hem spread came partly from the band sitting lower on the larger sizes (a wider part of the cone at the same height) and its hems were still moving.

**Device blend** (`pom2_measure.py blend`): each size draped on the chart AU 8 and AU 12 bodies, blended linearly to the held-out body (weight 0.6 on AU 12), against the direct drape:

| | AU 8 | AU 10 | AU 12 INTERPOLATED | AU 14 | AU 16 EXTRAPOLATED |
|---|---|---|---|---|---|
| Vertex error RMS / p95 / max (cm) | 1.5 / 3.2 / 4.8 | 1.4 / 2.9 / 4.6 | 1.2 / 2.4 / 4.3 | 1.6 / 3.4 / 6.3 | 1.6 / 3.2 / 6.2 |
| of which the pinned band, RMS (cm) | 0.18 | 0.18 | 0.18 | 0.14 | 0.14 |
| Hem hull, blend / direct (cm) | 137.1 / 140.5 | 139.3 / 143.7 | 140.8 / 146.5 | 142.2 / 147.3 | 143.9 / 148.3 |
| Hem ring length, blend / direct (cm) | 190.8 / 230.0 | 203.6 / 248.1 | 208.9 / 254.0 | 209.9 / 260.0 | 227.8 / 266.1 |

All five are clean cases now (§8.5 had one: 2.3 cm RMS). The error is 1.2-1.6 cm RMS. But the blend **flattens the folds**: the folds lie in different places on the two grid bodies, so the blended hem is 14-19 % shorter than the fabric and its hull 3.4-5.7 cm smaller. The size order survives (137.1 → 143.9). The morph bake and the device page were not re-run (`bake.ts` and `morph.html` expect a 3 × 3 grid; AU 8 has no drape on the AU 16 body by rule).

Cost: 255 CPU-s median per drape (188-573; the first 33 drapes), measured at load average 4-14 next to another workflow.

### 9.9 Renders

In `/tmp/claude-0/-home-user/45896997-2c70-517e-89a4-f66870da365e/scratchpad/tape/pom-v2/`, not committed. All 13 were re-made after the review (the geometry of the first 12 is unchanged; the labels and titles changed). Every title says ESTIMATE; the ten with the standard title also say that the band level is ASSUMED (the v1-against-v2 pair and the close-up do not, the floor render does); every label carries measured / INTERPOLATED / EXTRAPOLATED, how the band holds at the assumed level, "NOT A VERDICT (level ASSUMED)" with the shift where that changes class within ±2 cm, and the pull-on margins hip / widest hull with one of "as on its own chart body", "clear", "short at the shop's stretch" (no pass or fail word). Flat colour (reads pink, not crimson); no texture. Bodies stand on a 40 cm plinth except in `pom2-floor-front.png`.

| File | Honest read |
|---|---|
| `pom2-all-front.png` | AU 8-16 on the held-out body. Five plain, softly flared maxi skirts that look almost the same. The band is at the same height on all, a smooth collar under the navel; fine vertical folds start under it and fade towards the hip; a few broad folds lower down. The hem gets slightly wider and a little longer from left to right; without the labels one could not put them in order with confidence. AU 16's label carries the "not a verdict" lines (loose if the band is 1.5 cm higher) |
| `pom2-all-side.png` | Same from the side. The skirts hang nearly straight at the front and swing back a little at the hem; the larger sizes have more folds at the back. **Directly under the band the skirt steps out past the band, most clearly at the back and on AU 14 and AU 16: the ledge of the pinned seam ring (§9.5), not a garment feature.** No clear size cue |
| `pom2-own-front.png`, `-side.png` | Each size on its own chart body. The bodies differ more than the skirts; the skirt widens with the body at the hip. All five pull-on lines read "as on its own chart body" (hip +0.0 to +1.8, hull −0.4 to −2.0); nothing on the image says a size fails. The ledge under the band shows from the side here too |
| `pom2-gathers-close.png` | Close-up, raking light, AU 8 / 10 / 14. Regular vertical folds 10-15 cm long under a smooth band, deeper on AU 14 than AU 8. They look like soft pleats, not like fine elastic gathering; a faint diamond pattern from the mesh triangles shows in the light. The band looks like a flat ribbon narrower than the fabric under it, which is what it is in the mesh (§9.3). The labels lie over the band and the top of the folds |
| `pom2-seam-clearance-side.png` (new) | AU 8 and AU 14, the pinned rings 0.6 against 1.6 cm off the body. With 1.6 cm the band stands visibly off the back and the skirt under it starts further out; from the thigh down the pairs are the same by eye. It shows that the shape just under the band is set by the pinned ring |
| `pom2-v1-vs-v2-front.png`, `-side.png` | v1 AU 8 / 14 / 16 beside v2. v1: smooth cones whose band slides from the waist (AU 8) to the hips (AU 16), hem 16 cm lower on AU 16. v2: the three bands level, folds from the band, skirts more alike. v2 reads as a gathered skirt; v1 as a cone. The v2 bands are level because they are pinned |
| `pom2-tube-vs-cone-front.png`, `-side.png` | AU 8 and AU 14, tube beside cone. The cone is a touch fuller from the hip down; by eye the difference is marginal |
| `pom2-weight-front.png` | AU 10 at 120 / 165 / 200 gsm. No visible difference beyond where individual folds fall |
| `pom2-floor-front.png` | AU 10 and AU 14 with the floor at the soles: the hem crumples into a ruffle on the floor and covers the feet except the toes. This is band level (assumed) minus tape length on a 168 cm barefoot body; these two drapes are not at rest |
| `pom2-edge-cases-front.png` | AU 8 on the AU 16 body: the bare body, labelled "band 1.7 cm short: not draped / NOT A VERDICT (level ASSUMED): 'holds' if band 0.7 cm higher". AU 16 on the AU 8 body: drawn at the wear level, "band LOOSE by 3.7 cm / NOT A VERDICT: 'holds' if band 1.5 cm lower" (drawn, not simulated: a loose band would slip). AU 16 on the AU 16 body for comparison |

### 9.10 Verdict

**Conditional GO, narrowed after review (§9.12): for this garment on these bodies, a pinned-band drape from the tape runs and reads as a gathered maxi skirt. That is all the outputs support. Do not present its output as how this skirt looks until it has been checked once against something real, and do not read it as a route proven for elastic-waist skirts.**

What the outputs support:

- **It runs.** 35 drapes started, 35 finished, no particle in the body. 25 of the 32 free-hem drapes are at rest at frame 144 by the stated threshold; the seven others (mostly AU 14 and AU 16) still have a particle moving 0.25-0.35 cm per frame, and the two drapes with the floor in place do not settle. The hem hull repeats to 0.5-1.3 cm (two repeats) and drifts 0.8 cm between frame 144 and 288 (one run). v1 needed a band force nobody measured and failed at both ends of it; v2's band cannot fail **because it is pinned**, which removes the failure from the simulation without showing that the real band holds.
- **It reads as the right kind of garment**: a gathered, softly flared maxi skirt hanging from a band below the navel.
- **Fabric weight is not a blocker** (§9.7).
- **The band table is arithmetic** on two tape numbers per size, a body and an **assumed level**. On its own chart body and the neighbouring ones every size holds, stretched; that survives ±2.5 cm of band level. The two edge cases (cannot be worn, loose) do not survive ±1.5 cm (§9.2). The pull-on margin has no absolute zero: every size is "at the limit" on the body it is cut for.

What they do not support:

- **Scope.** One product, one stature (168 cm), one body-shape axis, a static A-pose, one cloth preset. No second skirt, no other elastic waist, no tall or short body was run. "Route for elastic-waist skirts" is a hypothesis this run is consistent with, not a result.
- **What the drape adds over the arithmetic is small.** The band's height and girth, the hem's height, the seam's folds and the stand-off at the seam are imposed (§9.5). What the cloth itself contributes is the fold pattern from about 5 cm under the seam down and the hem's hull and extent, and those differ between sizes by 1-4 cm in front width, with steps under 1.5 cm unresolved; the mesh density alone moves the hem hull by 6.3 cm, as much as AU 8 to AU 14.
- **The hull at the hip** is not a clean output: about 3-4 cm of the 6.6-9.9 cm stand-off there comes from the pinned seam ring (§9.5).
- **A loose band is drawn, not simulated**: at the wear level, where a real one would slip.
- **Likeness.** There is no non-AI picture of this skirt in the repo. Nothing in §9 has been compared with the real garment. The cut between the tape points (tube or cone, 2-5 cm at the hem), the cloth's stiffness, the gather pitch and the band's level are assumed.
- **Size in the picture.** The 3D view will not show a shopper which size to take; it can show that the skirt is long, full and gathered. That may well be true of the real skirt (an elastic gathered skirt is forgiving), but it means the size message has to come from the band table, with the caveats above.
- **Device blend** loses 3-6 cm of hem hull and 14-19 % of the hem's fold length (§9.8).

Still missing, in order of what it would buy:

1. **One real reference**: a photo of the actual skirt on a person (or a dress form) of known hip, waist and height in a known size, or failing that on a hanger, front and side. Without it this stays unvalidated.
2. **The top-edge girth** (the panel's width just under the band, pulled flat), per size. It decides tube against cone and the fullness of the gathers; today it is assumed equal to the hip.
3. **Hip depth and length reference**: hip at exactly 20 cm on every size (§8.9, still open), and whether the length runs from the band's top or bottom edge. With the rule the hem reaches the floor at 168 cm (§9.5).
4. **Yes/no from the shop**: slit (and its length), tiers, lining. Built without all three.
5. **The wear offset** ("just below the navel" = 2 cm, ASSUMED) and the band's height: a centimetre of level is two centimetres of girth, and decides the edge cases (§9.2). Ask the shop for "from the navel to the top of the band, on a person". And what to draw when the band is loose.
6. A second garment and a second stature before "route" is claimed: another elastic-waist skirt from tape, and the same skirt on a 158 and a 178 cm body (which also tests the navel landmark, §9.2). More frames for AU 14 and AU 16.
7. Engineering: a band that is a band (its own ring of mesh at the band's length, ruched); a texture for this layout; the bake and device page for a grid with refused combinations; folds that survive the blend (or more grid bodies); finer gathers (the mesh sets the pitch); a ruched band; other statures (only 168 cm), one shape axis, a static A-pose.
8. Cloth calibration (stiffness and bending). Weight alone does not need the shop.

Sizing decisions remain with `@curtain/fit-engine`; nothing here feeds it.

### 9.11 Proposed changes to the merchant measuring list

`docs/MERCHANT-MEASUREMENTS.md` is not edited on this branch. Proposed:

- **Keep A-E** (band relaxed, band stretched, hip at 20 cm, hem, length). A and B are now used twice: the band's range at the wear level and the pull-on check.
- **E, length: say from where.** "From the top edge of the waistband" is already the text; add "and tell us how high the band is" (one number per style).
- **Add F, top edge of the skirt panel** (gathered styles only): "Just under the waistband, pull the gathers flat and measure straight across. x 2." If that is impractical: "Is the skirt gathered into the band? Roughly how much wider is the fabric than the band: a little, half as much again, double?"
- **Replace** "How hard did you pull for B?" / "how far does it go beyond B" **with**: "B should be as far as you would pull it to step in. If it goes clearly further without strain, give that number too." The pull force itself is no longer needed.
- **Drop** "Is there a drawstring?" as a standing worry for this product (answered: no); keep it as a yes/no in the once-per-garment list, with pull-on / zip.
- **Add, once per garment, yes/no**: slit (which side, how long from the hem up), tiers (distance of each seam below the band), lining.
- **Add, once per garment**: "Where is it meant to sit: at the waist, just below the navel, on the hip?" Default when unanswered: just below the navel (the founder's rule for skirts).
- **Add, once per garment**: "Weigh one size on a kitchen scale and tell us which size." Low priority (§9.7).
- **Add, once per garment, the one thing that would validate all of this**: "One real photo (not AI-generated) of the garment worn, front and side, with the size worn and the wearer's height, waist and hip; or the garment on a hanger."
- **Worked example**: the note that the drawstring and the "pull-on or zip" question are open can be closed (pull-on, no drawstring, per the founder; to confirm with the shop). The remaining questions for this skirt: C at exactly 20 cm on all sizes, AU 12 and 16, F, slit / tiers / lining, band height, a real photo.

### 9.12 Review of v2 and what was changed

An independent review reproduced every number of §9.2 and §9.5 and found no code defect that changes one. It found that several sentences claimed more than the outputs show. Each finding, and what was done (no drape of the first run was re-run; two drapes were added; all renders were re-made because their labels changed):

| # | Finding | Done |
|---|---|---|
| 1 (high) | "Came to rest" overstated: 7 of 30 free-hem drapes are not at rest, among them AU 14 on the held-out body | Answer paragraph, §9.5, §9.8 and §9.10 now say 25 of 32 (23 of the original 30) and name the seven; an "at rest" row per drape in the tables; `pom2_measure.py drapes` prints the count and the drapes still moving. Not done: more frames for AU 14 / AU 16 (listed as missing) |
| 2 (high) | The edge-case verdicts are inside the uncertainty of the assumed band level | New `wear_rule.placement_sensitivity` and `pom2_measure.py placement`: girth per cm of level, the status with the band ±1 and ±2 cm, and the shift at which each cell changes class. §9.2 has the table (7 of 30 cells change within ±2 cm) and says what the band table does and does not support. The render labels of such cells now say "NOT A VERDICT (level ASSUMED)" with the shift; "cannot be worn" on the render became "band 1.7 cm short: not draped" |
| 3 (medium) | Imposed numbers listed as simulated (hem height, folds 2 cm under the seam, 0 particles inside at the band, deeper folds on larger sizes) | `pom2_measure.py` has a third block, `followsFromImposed`; §9.5 has a separate table for it; the hem-height bullet is now "by arithmetic"; the deeper-folds sentence names the assumed top edge |
| 4 (medium) | The hull at the hip is contaminated by the pinned seam ring; visible as a ledge under the band | Measured: the seam ring's hull and the stand-off profile from the seam to 13 cm below. Tested with two new drapes (`--clearance 1.6`): the hip hull moves 30-40 % of what the seam ring moves, the knee and hem do not. §9.5 no longer reads the hip hull as a pure output. Not fixed: the ledge itself (the collision margin and the mesh-limited fold depth set it) |
| 5 (medium) | The drawn band is the panel mesh pinned smooth (17-31 % compressed), excluded from the reported strain, the same for every size | Stated in §9.3 and §9.5 and in `drape_blender.py`; `pom2_measure.py` reports the drawn rings, their rest length and compression. "Band girth 87.0 cm" now says it is the rule's girth, with the drawn 86.4-92.8. Not fixed: a real band mesh (listed under engineering); nothing simulated depends on those rings |
| 6 (medium) | The pull-on label says "FAILS" for a size on its own chart body | Labels now print both margins (hip / widest hull) and one of "as on its own chart body", "clear", "short at the shop's stretch" (by the hip margin, ±2.5 cm); no "FAILS", "passes" or "marginal". The title says the check is not calibrated. §9.2 says the hull reading is refuted by its own diagonal. Test added |
| 7 (medium) | Verdict scope wider than the evidence | §9.10 rewritten: GO for this garment on these bodies only; what the drape adds over the arithmetic; a second garment and stature listed as missing before "route" |
| 8 (low) | Navel landmark sound; "a landmark, not a proportion" untested at one stature | Caveat and the pit-against-mean figure added to §9.2 |
| 9 (low) | Gather model is real geometry; limits disclosed | No change |
| 10 (low) | No AI image used as evidence in §9; residues (render colour, unused UV layout, `products.json` `selection.why`) | No change: `products.json` is outside this branch; the colour and UVs are not evidence |
| 11 (low) | §9.6 and §9.8 tables lack INTERPOLATED / EXTRAPOLATED | Added |
| 12 (low) | "Repeatable to about 1 cm"; monotone order within noise | §9.5 and §9.10: repeats 0.5 and 1.3 cm, long run 0.8 cm; only steps over about 1.5 cm are resolved; AU 12 / 14 / 16 are not ordered by these runs |

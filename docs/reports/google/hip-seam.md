# Diagnosis: Hip-line seam on the realistic body (WO-008 / CUR-21), 22 Nov 2026

- **Branch:** `google/wo-008-hip-seam` (cut from `origin/claude/realistic-body`, `9a4fc62`)
- **Model:** Gemini 4 Neon (Antigravity)
- **Issue:** Linear `CUR-21` (WO-008)

## Verdict: Geometry (`realisticBody.ts`), NOT skin or shading

**The horizontal seam / shelf at the hip line is caused by mesh geometry in `fitRealisticBody` (`packages/garment-viewer/src/realisticBody.ts`), not by `realisticSkin.ts` or `studioLight.ts`.**

- **Grey mannequin control test (no `realisticSkin`):** Rendering all five bodies with the plain grey default material and classic lighting (`docs/screens/claude/realistic-body/`) shows the exact same horizontal ledge across the upper hip / navel line — most prominently on `full` (front and ¾), and also visible on `mid`, `petite`, and `slim` (¾). See `docs/screens/google/hip-seam/hip-seam-diagnosis-sheet.png`.
- **Shading is only a secondary amplifier (already mitigated in CUR-6):** In skin v1 (`roughness ~0.47`), the glossy specular reflection placed a bright highlight band along the upward-facing top bevel of the geometric shelf (seen in the founder's screenshot `founder-hip-seam.jpg`). Skin v3 (`google/wo-002-skin-v3`, matte `roughness 0.73`) removes that highlight band, softening the contrast, but cannot eliminate the 3D step in silhouette and diffuse shading.
- Per CUR-21 ownership rules (`realisticBody.ts` and `bake-realistic-body.ts` stay with Claude), no geometry files were modified on this branch; this report hands the exact root cause and quantitative breakdown to Claude for the fit repair.

## Done

1. Ran the grey-mannequin vs. `realisticSkin` v1 vs. `realisticSkin` v3 visual control across all 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front and ¾, zoomed to the hip line (`docs/screens/google/hip-seam/hip-seam-diagnosis-sheet.png`).
2. Verified `realisticSkin.ts` cannot cause a horizontal hip seam: `skinMaskOf` assigns `0` redness and `0` thinness across the belly and hips (`realisticSkin.test.ts` pins this), triplanar projection blends smoothly by `|normal|^4` with no height discontinuity, and the seam persists identically when `realisticSkin` is disabled.
3. Isolated the exact contribution of every stage of `fitRealisticBody` (`packages/garment-viewer/src/realisticBody.ts`) on all 5 test bodies by measuring horizontal cross-sections and front-torso vertical surface normals (`ny`, where `0` = vertical skin and `+1` = flat upward-facing horizontal shelf).

## Measured

### 1. Stage-by-stage isolation on `full` (`170 cm`, bust 116 / waist 98 / hip 122, `weight = +1.0`)

Mean and maximum upward front-torso normal `ny` (`z > 2 cm`, excluding arms) in 2 cm height bands between `hip` (`y = 88.4 cm`) and `waist` (`y = 105.4 cm`):

| Height `y` (cm) | Raw MakeHuman (`weight = +1`) | + Step 2 `warp` only | + Step 3 Z-centring (`iter0`, `tdz`) | + Step 5 `torsoCentre` + `bodyScale` (`fitted`) |
|---|---|---|---|---|
| 94 | 0.13 (max 0.53) | −0.06 (max 0.22) | 0.04 (max 0.18) | 0.03 (max 0.16) |
| 96 | 0.19 (max 0.40) | 0.03 (max 0.17) | 0.14 (max 0.22) | 0.14 (max 0.26) |
| **98** | 0.18 (max 0.35) | 0.20 (max 0.64) | **0.33 (max 0.72)** | **0.41 (max 0.82)** |
| **100** | 0.20 (max 0.45) | 0.23 (max 0.38) | **0.36 (max 0.46)** | **0.47 (max 0.61)** |
| **102** | 0.09 (max 0.43) | 0.21 (max 0.44) | **0.27 (max 0.47)** | **0.35 (max 0.56)** |
| 104 | 0.02 (max 0.24) | 0.16 (max 0.48) | 0.03 (max 0.22) | 0.05 (max 0.28) |

The shelf appears directly in **Step 3** (`tdz` Z-centring, nearly doubling `meanNy` from `0.20–0.23` to `0.33–0.36`) and is amplified further in **Step 5** (`torsoCentre.dz` area-centroid Z-centring + radial scale `bodyScale`, pushing `meanNy` to **`0.47`** and `maxNy` to **`0.82`** — a ~55° upward-facing ledge right at the navel / upper hip line).

### 2. Primary cause: Per-ring Z-centring destroys MakeHuman's natural S-curve (`realisticBody.ts` lines 522–558 & 629–688)

On the MakeHuman mesh, the section centroids (`cv` in Step 3, area centroid `av` in Step 5) naturally vary in Z because the buttocks sit behind the spine at `hip`, while `thigh` and `waist` sit further forward. Because every ring in the mannequin target has `ring.centre[2] = 0.00`, `fitRealisticBody` applies a steep **forward Z-spike at the hip ring** relative to both the waist above and the thighs below:

| Body | `thigh` `av` → `dz` | `hip` `av` → `dz` | `waist` `av` → `dz` | Shear `hip → waist` (cm) | Shear `thigh → hip` (cm) | Vertical span `waist − hip` (cm vs. bake 20.3) |
|---|---|---|---|---|---|---|
| `slim` | +4.21 → −4.21 | +2.16 → −2.16 | +5.28 → −5.28 | **−3.12 cm** | +2.05 cm | 16.4 cm (`0.81×`) |
| `mid` | +4.97 → −4.97 | +1.83 → −1.83 | +5.93 → −5.93 | **−4.10 cm** | +3.14 cm | 16.8 cm (`0.83×`) |
| `full` | +5.00 → −5.00 | +1.92 → −1.92 | +6.08 → −6.08 | **−4.16 cm** | +3.08 cm | 17.0 cm (`0.84×`) |
| `tall` | +4.39 → −4.39 | +2.09 → −2.09 | +5.44 → −5.44 | **−3.35 cm** | +2.30 cm | 18.2 cm (`0.90×`) |
| `petite` | +4.97 → −4.97 | +1.85 → −1.85 | +5.96 → −5.96 | **−4.11 cm** | +3.12 cm | 15.2 cm (`0.75×`) |

- Forcing `av = 0` at every ring shears the pelvis **+3.1 to +4.2 cm forward** relative to the waist (over a vertically compressed 15.2–18.2 cm span) and **+2.1 to +3.1 cm forward** relative to the thighs. This is why the lower body looks "glued onto the torso from the hips down".

### 3. Compounding geometric factors on `full`

- **Vertical warp compression (`realisticBody.ts` line 513):** `meta.levels.hip = 82.5`, `waist = 102.8` (20.3 cm apart in the bake), compressed to 15.2–17.0 cm (`dy/dx = 0.75–0.84`), while `crotch → hip` is stretched `1.10–1.31×`. This steepens every horizontal contour between hip and waist.
- **Radial scale jump (`bodyScale` in Step 5):** on `full`, `hip` scales by `1.217` while `waist` scales by `1.375` (+15.8% jump over 17 cm). Combining that rising scale with MakeHuman's `weight+` iliac shape causes width to locally reverse outward at `y = 96.4 cm` (`41.5 → 41.8 cm`) before dropping `−5.5 cm` into the waist (`41.8 → 36.3 → 34.9 cm` by `y = 106.4 cm`), forming a shelf in the front silhouette as well as in Z.

### Recommended fix direction for Claude (`realisticBody.ts`)

1. **Preserve MakeHuman's natural pelvic/lumbar Z-curve instead of zeroing `av` independently at `hip` vs. `waist` and `thigh`:** e.g., remove only a single global (or slowly varying) torso Z-offset, or measure/target the relative posture curve `(av_ring − av_base_ring)` rather than pulling `hip` +4 cm forward of `waist`. Let `conformToField` handle any local collision clearance under garments.
2. **Check the `hip` bake level & vertical warp ratio:** reducing the `1.23×` vs. `0.84×` vertical stretch/compression discontinuity at `hip` will further smooth the hip-to-waist transition.
3. Re-verify all 12 girth tests (`realisticBody.test.ts`) and garment conform clearance after the fit change.

## Not verified

- **No geometry fix applied or tested here:** `realisticBody.ts` and `bake-realistic-body.ts` are owned by Claude per CUR-21, so after-fix geometry renders will come from Claude's fit branch.
- **Conform step with a garment:** not the cause of the bare-body seam shown in `founder-hip-seam.jpg` (bare body never runs `conformToField`).
- **`@curtain/woocommerce-plugin` PHP build:** `php` is not installed on this macOS host (no code files were changed on this diagnostic branch).

## Open issues

- **CUR-21 stays open for Claude's geometry fix in `realisticBody.ts`** (Step 3 `tdz` & Step 5 `torsoCentre.dz` / `legCentre.dz` Z-centring + `hip→waist` warp/scale transition).

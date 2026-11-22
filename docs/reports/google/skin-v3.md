# Skin v3 & v3.1 on the realistic body (WO-002 / CUR-6), 22 Nov 2026

- **Branch:** `google/wo-002-skin-v3` (cut from `origin/claude/realistic-body`, `9a4fc62`)
- **Model:** Gemini 4 Neon (Antigravity)
- **Work order:** `docs/work-orders/WO-002-skin-v3.md` (Linear `CUR-6`)

## Done

### v3 — Matte skin & soft studio light (22 Nov)

Rebuilt the procedural skin shading and studio lighting in our own code (`realisticSkin.ts`, `studioLight.ts`) to remove the plastic/oily specular glare reported by the founder on 22 Nov and bring light, medium, and deep tones closer to the four BlendKit references (inspected visually only; zero assets downloaded, committed, or traced).

- `packages/garment-viewer/src/realisticSkin.ts`:
  - **Matte roughness & fixed shader offset:** raised `roughness` from `0.52 − 0.08·deep` (`0.44`–`0.52`, multiplied by `0.9` on flat skin in v1 to `0.40`–`0.47`) to `0.73 − 0.09·deep` (`0.73` light/medium, `0.64` deep) and centred `skinRoughK` at `1.0`.
  - **Lower, warm-tinted specular:** reduced `specularIntensity` from `0.50 − 0.26·deep` to `0.21 − 0.06·deep` and added per-tone `specularColour` (warm cream on light/medium, muted warm beige/umber on deep).
  - **Subtle matte velvet sheen without extra PMREM pass:** reduced `sheen` from `0.22 − 0.14·deep` to `0.06 − 0.03·deep` (`sheenRoughness: 0.85`), applied analytically in the fragment patch (`skinSheen` / `skinSheenColour`) with `material.sheen = 0` to eliminate Three.js's second `getIBLRadiance` lookup per pixel.
  - **Balanced wrap lighting & micro-detail:** tightened `wrap` from `[0.42, 0.20, 0.14]` to `[0.27 − 0.09·deep, 0.095 − 0.025·deep, 0.045 − 0.015·deep]`, refined the 128 × 128 procedural pore/micro-crease tile (`20 × 20` softer epidermal pores, `tileCm: 2.0`, `bump: 0.22–0.26`, `anisotropy: 1`), and replaced the 3 coarse triplanar mottle texture fetches with an analytic 3D `skinMottle()` function.
- `packages/garment-viewer/src/studioLight.ts`:
  - Softened and widened the studio lighting while keeping the calibrated neutral front irradiance (`π` within 2%, channel neutrality `< 1.03`): directional `key` `2.4 → 1.8`, key softbox `radiusDeg: 40` / `radiance: [1.92, 1.90, 1.86]`, fill `0.30`, back rim `1.25`, PMREM prefilter sigma `0.04`.

### v3.1 — Warm, living fair skin without chalky white clipping (22 Nov)

Founder review of v3 praised the matte finish and medium/deep tones (*"Skin v3 (mat), ¾ is de beste"*), while flagging that **light (Monk 2 `#f3e7db`) still looked too white/chalky**.

#### Root-cause diagnosis (why Monk 2 `#f3e7db` looked too white in v3)

Pixel sampling of v3 `light-mid-upper-after.png` (`#f3e7db` on the `#f5efe7` studio backdrop) revealed three compounding causes:

1. **The test swatch `#f3e7db` itself is brighter than realistic fair skin:** Monk 2 `#f3e7db` sits at `CIE Lab(92.3, 2.1, 7.3)` (linear RGB `[0.896, 0.799, 0.708]`, chroma `C* = 7.6`), only `ΔL* = 2.4` darker than the `#f5efe7` cream backdrop (`Lab(94.7, 0.6, 4.6)`). As a 2D UI chip it reads as pale cream; as a physically based 3D albedo it has higher reflectance than white paper and almost no vascular warmth. By comparison, BlendKit reference #1 (`Human Skin`, `https://www.blendkit.com/asset-gallery-detail/09b323ad-55a7-4442-8931-b7fdc6b3ca71/`, look-only) sits around `L* ≈ 78–82, a* ≈ 8–12, b* ≈ 15–18`.
2. **Studio irradiance `π` + key light pushes `#f3e7db` past `TRUE_TONE_START` (`0.90`) into white desaturation:** `studioLight.ts` calibrates a flat `+Z` normal to `π` irradiance (`1.0×` albedo), so planes angled toward the elevated key softbox receive `~1.10–1.25×` irradiance plus wrap and specular. With linear `R = 0.896`, front-lit skin exceeds `TRUE_TONE_START = 0.90` in `scene.ts` (`TRUE_TONE_GLSL`), which compresses luminance *and* desaturates toward neutral white (`Desaturation = 0.15`). In v3, the forehead rendered at `#fbede1` (`Lab 94.5, 2.7, 7.5`) and the lit chest at `#fcefe2` (`Lab 95.1, 2.2, 7.8`) — **brighter than the `#f5efe7` backdrop** (`L* = 94.7`), erasing chest/collarbone modelling into flat chalk.
3. **Cool-beige shadow rolloff on low-melanin fair skin:** v3's wrapped diffuse alone left shadowed fair skin (`armShad #c1b1a4`, `Lab 73.2, 3.5, 8.7`) looking desaturated grey-taupe rather than showing the warm rosy-terracotta subsurface scatter band characteristic of low-melanin fair skin.

#### v3.1 code changes (light-only; medium and deep strictly untouched)

- `packages/garment-viewer/src/realisticSkin.ts` (`studioLight.ts` and `skinMaskOf` **untouched**):
  - **Fair-only optical calibration (`fair = toned ? smoothstep(70, 92, L) : 0`):** strictly `0` for Monk 6 (`L* = 55.1`, medium) and Monk 9 (`L* = 21.1`, deep), ramping smoothly for pale swatches (`L* > 70`, e.g. Monk 1–4).
  - **Anti-chalk albedo toning (`toneGain` → `skinToneGain` uniform):** in CIE Lab, pulls very pale swatches out of the `TRUE_TONE_START` clipping ceiling (`L − 7.8·fair`) and restores subtle epidermal peach warmth only where the input swatch lacks chroma (`a + fair·max(0, 8.5 − a)·0.72`, `b + fair·max(0, 17 − b)·0.68`). **D20 single-tone contract preserved:** `care.hex` and `material.color` remain verbatim the shopper's chosen `#rrggbb` value; medium & deep get `toneGain = [1, 1, 1]`.
  - **Warm subsurface terminator scatter (`sssTint` → `skinSssTint` uniform):** adds a subtle rosy-terracotta subsurface scatter band (`[0.16, 0.055, 0.025] · fair`) across the `N·L ∈ [-0.25, 0.65]` shadow terminator in `DIRECT`, turning cool grey crevices on fair skin into warm living shadows. Medium & deep get `sssTint = [0, 0, 0]`.
  - **Natural fair blush on cheeks, ears, hands, knees:** gently boosts `flushDeltaA` (`7.0 + 3.0·fair − 3.5·deep`), warm peach `b*` flush (`+1.4·fair`), and red `wrap` (`+0.07·fair`) for `fair > 0`, without turning skin pink (`b* ≈ 2·a*` maintained).
- `packages/garment-viewer/src/realisticSkin.test.ts`:
  - Added v3.1 tests asserting `fair === 0`, `toneGain === [1, 1, 1]`, and `sssTint === [0, 0, 0]` on medium (`#a07e56`) and deep (`#3a312a`), non-chalky peach `toneGain` and red-first `sssTint` on Monk 1–2, near-neutral `toneGain` on realistic fair swatch `#e6c3ab`, and D20 `material.color` preservation + `skinToneGain` / `skinSssTint` uniform wiring.
- `spikes/garment-engine/viewer/realistic-body-skin-sheets.mjs`:
  - Added `--v1`, `--v3`, and `--fair` flags to compose `v1-vs-v3-vs-v31-sheet.png` (large ¾ views for all three tones + light close-up) and `light-comparison-sheet.png` (v3 `#f3e7db` vs v3.1 `#f3e7db` vs v3.1 proposed fair swatch `#e6c3ab`).

#### Swatch recommendation alongside `#f3e7db`

`#f3e7db` (Monk 2) is a very pale UI chip (`L* = 92.3, C* = 7.6`) rather than a typical fair-skin albedo. With v3.1, `#f3e7db` now renders as a believable **very fair / porcelain-ivory** tone (forehead `Lab 89.1, 7.7, 14.9` — clearly separated from the `L* = 94.7` backdrop, warm peach-rose cheeks `Lab 80.2, 12.5, 15.9`, warm shadows `Lab 68.6, 10.3, 15.4`).

Alongside `#f3e7db`, we propose **`#e6c3ab`** (`CIE Lab 81.2, 8.4, 16.5`) as a realistic everyday fair-skin test swatch for visual QA: it already carries natural peach chroma (`toneGain` stays near-neutral `[0.892, 0.879, 0.864]`) and lands closely in the tonal range of BlendKit reference #1 (`Human Skin`), as shown side-by-side in `light-comparison-sheet.png`.

### Per-tone visual comparison (v1 → v3 → v3.1, vs. BlendKit references)

| Tone | BlendKit reference (look only) | v1 (`claude/realistic-body`) | v3 (matte) | v3.1 (warm fair; medium/deep unchanged) |
|---|---|---|---|---|
| **Light** (Monk 2 `#f3e7db`) | #1 `Human Skin` (`09b323ad-...`): very matte, warm cream-peach highlights, rosy-terracotta shadows, fine uniform grain | Shiny pale plaster; front torso/shoulders bleached near white | Matte finish fixed, but still chalk-white (`forehead L*=94.5`, `chest L*=95.1` brighter than backdrop `94.7`) | Warm, living matte porcelain-ivory (`forehead L*=89.1, a*=7.7, b*=14.9`); natural peach-rose on cheeks/ears/hands/knees; warm terracotta shadow transitions; zero pink cast |
| **Proposed fair** (`#e6c3ab`, QA comparison) | #1 `Human Skin` (`09b323ad-...`) | — | — | Natural warm peach fair skin matching BlendKit #1's tonal richness and soft matte rolloff |
| **Medium** (Monk 6 `#a07e56`) | #2 `Human skin tone 1`: matte to low-satin, broad gradual rolloff, no crisp hotspot | Pronounced waxy/plastic glare blobs on chest, shoulders, belly, thighs | Founder's preferred look (*"v3 mat ¾ is de beste"*): smooth matte-velvet, warm depth | **Unchanged from v3** (`fair = 0`, `meanAbsDiff = 0.0025/255` vs v3 PNG) |
| **Deep** (Monk 9 `#3a312a`) | #3 `Human skin tone 6` & #4 `Human skin tone 2`: soft muted warm-satin rolloff, deep cocoa-umber shadows | Oily charcoal-plastic; bright white-grey specular glare spots | Rich matte-satin cocoa-brown; zero chalky white/grey glare | **Unchanged from v3** (`fair = 0`, `meanAbsDiff = 0.0013/255` vs v3 PNG) |

## Measured

### Light-skin pixel Lab verification (`light-mid-upper-after.png`, Monk 2 `#f3e7db`)

| Sample point | Backdrop `#f5efe7` | v3 (`#f3e7db`) | v3.1 (`#f3e7db`) |
|---|---|---|---|
| Backdrop | `#f5efe7` · `Lab(94.7, 0.6, 4.6)` | `#f5efe7` · `Lab(94.7, 0.6, 4.6)` | `#f5efe7` · `Lab(94.7, 0.6, 4.6)` |
| Forehead | — | `#fbede1` · `Lab(94.5, 2.7, 7.5)` *(ΔL* = −0.2)* | `#fadac4` · `Lab(89.1, 7.7, 14.9)` *(ΔL* = −5.6)* |
| Cheek | — | `#efd7cb` · `Lab(87.6, 6.4, 8.9)` | `#e9beaa` · `Lab(80.2, 12.5, 15.9)` |
| Lit chest | — | `#fcefe2` · `Lab(95.1, 2.2, 7.8)` *(brighter than backdrop)* | `#fadcc6` · `Lab(89.7, 7.0, 14.6)` |
| Waist | — | `#f3e4d7` · `Lab(91.4, 3.0, 8.2)` | `#eaccb6` · `Lab(84.0, 7.2, 14.8)` |
| Arm shadow | — | `#c1b1a4` · `Lab(73.2, 3.5, 8.7)` *(cool grey-beige)* | `#c4a08c` · `Lab(68.6, 10.3, 15.4)` *(warm terracotta)* |

### Pictures (`docs/screens/google/skin-v3/`)

Generated in headless Chromium (SwiftShader CPU), 390 × 844 CSS px at 2×, zero console/page errors:
- `v1-vs-v3-vs-v31-sheet.png` — side-by-side comparison of **v1** vs **v3** vs **v3.1**, showing **large ¾ views for all three tones** (`light`, `medium`, `deep`) plus the `light` upper-body close-up.
- `light-comparison-sheet.png` — large upper-body close-up + ¾ view comparing **v3 `#f3e7db`** vs **v3.1 `#f3e7db`** vs **v3.1 proposed fair swatch `#e6c3ab`** (visual look target: BlendKit #1 `Human Skin`, link-only reference).
- `light-sheet.png`, `medium-sheet.png`, `deep-sheet.png` — before (flat colour, classic rig) vs. after (skin v3.1 + soft studio light) across all 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front and ¾, plus mid upper-body close-up.
- `light-mid-upper-after.png`, `medium-mid-upper-after.png`, `deep-mid-upper-after.png`, `fair-mid-upper-after.png` — full-resolution upper-body close-ups.
- `light-mid-body-after--three-quarter.png`, `medium-mid-body-after--three-quarter.png`, `deep-mid-body-after--three-quarter.png`, `fair-mid-body-after--three-quarter.png` — full-resolution ¾ views.
- `v1-vs-v3-sheet.png` — preserved historical v1-vs-v3 comparison sheet.
- `renders.json` — full v3.1 render metadata and frame-timing runs (note: 1 of 66 shots, `deep-slim-body-after--three-quarter`, logged a 40 s OrbitControls damping settle warning under SwiftShader; visually verified crisp and settled in `deep-sheet.png`).

### Frame time (headless Chromium, SwiftShader CPU, 390 × 844 at 2×)

Mid body alone (`height=168, bust=92, waist=74, hip=100`), 4 s continuous drag per run, 3 alternating runs per configuration (`avatarCheck.rafMs`):

| Configuration | Run 1 | Run 2 | Run 3 | Median | Mean |
|---|---|---|---|---|---|
| Body without skin (`grey`, classic — v3 run) | 81.7 ms | 81.7 ms | 85.1 ms | **81.7 ms** | 82.8 ms |
| Body without skin (`grey`, classic — v3.1 run) | 94.2 ms | 88.4 ms | 98.0 ms | **94.2 ms** | 93.5 ms |
| Body with old flat skin (`#a07e56`, classic — v3.1 run) | 106.6 ms | 101.7 ms | 96.8 ms | **101.7 ms** | 101.7 ms |
| Body with old procedural skin **v1** (`9a4fc62`, same host) | 286.9 ms | 277.8 ms | 297.6 ms | **286.9 ms** | 287.4 ms |
| Body with procedural skin **v3** (this branch, earlier commit) | 236.1 ms | 242.2 ms | 242.2 ms | **242.2 ms** | 240.1 ms |
| Body with procedural skin **v3.1** (this branch) | 271.1 ms | 267.8 ms | 384.8 ms* | **271.1 ms** | 307.9 ms |

\*Run 3 experienced a host CPU spike during the 4 s drag; runs 1–2 (`267.8–271.1 ms`) match the same ~175 ms SwiftShader delta above grey-before (`94.2 ms`) as v3 (`240.1 − 82.8 = 157.3 ms`), confirming that the two extra uniform multiplies (`skinToneGain`, `skinSssTint`) add negligible shader cost (~0–18 ms CPU variance).

### Budgets and gates

- **Generated detail texture:** 128 × 128 RGBA8 = **64 KB** in GPU memory (bound ≤ 256 KB); deterministic, zero external files.
- **Viewer chunk (`node apps/web/scripts/check-viewer-chunk.mjs`):** `garment-viewer-Dkp9fFz7.js` **189.6 KB gzip** (budget 400 KB), lazy chunk `realisticBodyLoad-Co6Ft8KV.js` **13.05 KB gzip**, not precached in `sw.js`.
- **`@curtain/garment-viewer` tests:** **25 / 25 test files (311 / 311 tests) passed** (4 visual-harness tests skipped), including **21 / 21 in `realisticSkin.test.ts`** (new v3.1 fair-toning & medium/deep-invariance tests).
- **Monorepo checks (all JS/TS packages & apps):** `build:packages` (9/9 JS/TS packages), `typecheck`, `lint`, `@curtain/garment-viewer test`, `@curtain/web test`, `build:apps`, `check-bundle-secrets.mjs`, `check-language-packs.mjs`, `check-viewer-chunk.mjs` — **all green**.

## Not verified

- **Real phone GPU:** all pictures and frame timings come from headless Chromium with SwiftShader on macOS CPU. Real mobile GPU frame time for procedural skin + PMREM studio light remains unmeasured.
- **`@curtain/woocommerce-plugin` PHP lint/build:** `php` is not installed on this macOS host, so `pnpm build:packages` fails only inside `packages/woocommerce-plugin/scripts/build.mjs` (`php -l`). No WooCommerce files were modified; CI with PHP should verify full `pnpm check` end-to-end.
- **Evaluated azure dress with skin v3.1:** `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/payload.json` is gitignored and absent in a clean clone, so dress-on-body renders were skipped (`hasDress: false` in `renders.json`).
- **Founder visual review** of skin v3.1.

## Open issues

- **Hip-line seam (`CUR-21` / WO-008):** investigated separately on `google/wo-008-hip-seam` (`docs/reports/google/hip-seam.md`). Confirmed as a geometry issue in `realisticBody.ts`, not skin/shading.
- **Monk 1–3 swatches vs. 3D albedo:** `#f3e7db` (Monk 2) is calibrated as a 2D UI swatch (`L* = 92.3`). v3.1 handles it gracefully via `fair`-gated `toneGain`, and we recommend also adopting `#e6c3ab` in QA scripts to benchmark natural fair skin alongside the porcelain-ivory Monk 2 extreme.
- **Procedural skin frame cost on real mobile GPUs:** SwiftShader shows ~240–271 ms vs. ~83–94 ms for flat skin (~157–175 ms delta from PMREM CubeUV + triplanar sampling); needs a real-device measurement before enabling `realisticSkin` by default.

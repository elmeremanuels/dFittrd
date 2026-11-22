# Skin v3 on the realistic body (WO-002 / CUR-6), 22 Nov 2026

- **Branch:** `google/wo-002-skin-v3` (cut from `origin/claude/realistic-body`, `9a4fc62`)
- **Model:** Gemini 4 Neon (Antigravity)
- **Work order:** `docs/work-orders/WO-002-skin-v3.md` (Linear `CUR-6`)

## Done

Rebuilt the procedural skin shading and studio lighting in our own code (`realisticSkin.ts`, `studioLight.ts`) to remove the plastic/oily specular glare reported by the founder on 22 Nov and bring light, medium, and deep tones closer to the four BlendKit references (inspected visually only; zero assets downloaded, committed, or traced).

### Code changes (only WO-002 files touched)

- `packages/garment-viewer/src/realisticSkin.ts`:
  - **Matte roughness & fixed shader offset:** raised `roughness` from `0.52 − 0.08·deep` (`0.44`–`0.52`, which the v1 shader further multiplied by `0.9` on flat skin to an effective `0.40`–`0.47` plastic gloss) to `0.73 − 0.09·deep` (`0.73` light/medium, `0.64` deep) and centred `skinRoughK` at `1.0` so `care.roughness` is the true median surface roughness.
  - **Lower, warm-tinted specular:** reduced `specularIntensity` from `0.50 − 0.26·deep` to `0.21 − 0.06·deep` and added per-tone `specularColour` (warm cream on light/medium, muted warm beige/umber on deep) to prevent cold grey glare on dark skin.
  - **Subtle matte velvet sheen without extra PMREM pass:** reduced `sheen` from `0.22 − 0.14·deep` (`sheenRoughness: 0.5`) to `0.06 − 0.03·deep` (`sheenRoughness: 0.85`), applied analytically in the fragment patch (`skinSheen` / `skinSheenColour`) with `material.sheen = 0` so Three.js does not run a second `getIBLRadiance` CubeUV lookup per pixel.
  - **Balanced wrap lighting & micro-detail:** tightened `wrap` from `[0.42, 0.20, 0.14]` to `[0.27 − 0.09·deep, 0.095 − 0.025·deep, 0.045 − 0.015·deep]` so fair skin retains anatomical modelling with warm rosy-terracotta shadow transitions instead of bleaching flat; refined the 128 × 128 procedural pore/micro-crease tile (`20 × 20` softer epidermal pores, `tileCm: 2.0`, `bump: 0.22–0.26`, `anisotropy: 1`) and replaced the 3 coarse triplanar mottle texture fetches with an analytic 3D `skinMottle()` function.
  - **Single input preserved (D20):** every parameter is still derived solely from the one `#rrggbb` skin-tone value; zero external texture files added.
- `packages/garment-viewer/src/studioLight.ts`:
  - Softened and widened the studio lighting while keeping the calibrated neutral front irradiance (`π` within 2%, channel neutrality `< 1.03`): lowered directional `key` from `2.4` to `1.8`, widened key softbox (`radiusDeg: 40`, `radiance: [1.92, 1.90, 1.86]` vs. v1 `28°` / `3.2`), balanced fill (`0.30`) and back rim (`1.25`) for natural modelling on fair and deep skin alike, and softened PMREM prefilter sigma (`0.04` vs. `0.02`).
- `packages/garment-viewer/src/realisticSkin.test.ts`:
  - Added regression tests (which fail on v1) enforcing matte roughness (`≥ 0.62`), low specular (`≤ 0.25`), low broad sheen (`≤ 0.08`, `sheenRoughness ≥ 0.8`), skin-warmed `specularColour`, analytic mottle & `material.sheen === 0`, removal of the v1 `0.9` roughness multiplier, and softer studio key/softbox bounds.
- `spikes/garment-engine/viewer/realistic-body-skin-renders.mjs` & `realistic-body-skin-sheets.mjs`:
  - Added automatic fallback to system Chrome when Playwright's bundled Chromium is absent, suppressed harmless `/favicon.ico` 404 noise in `avatar.html`, and added `--prev <dir>` to compose a direct v1-vs-v3 comparison sheet (`v1-vs-v3-sheet.png`).

### Per-tone visual comparison (v1 → v3, vs. BlendKit references)

| Tone | BlendKit reference (look only) | Before (v1, `claude/realistic-body`) | After (v3, `google/wo-002-skin-v3`) |
|---|---|---|---|
| **Light** (Monk 2 `#f3e7db`) | #1 `Human Skin`: very matte, warm cream-peach highlights, rosy-terracotta shadows, fine uniform grain | Front torso/shoulders bleached near white; anatomical contours washed out; glossy sheen | Soft, matte warm skin; collarbones, bust, neck and face keep gentle rosy-warm modelling without clipping |
| **Medium** (Monk 6 `#a07e56`) | #2 `Human skin tone 1`: matte to low-satin, broad gradual rolloff, no crisp hotspot, fine cellular relief | Pronounced waxy/plastic glare blobs on chest, shoulders, collarbone, belly, and thighs | Smooth, natural matte-velvet finish; all plastic hotspots removed; soft warm anatomical depth |
| **Deep** (Monk 9 `#3a312a`) | #3 `Human skin tone 6` & #4 `Human skin tone 2`: soft muted warm-satin rolloff over fine skin relief, deep cocoa-umber shadows | Oily charcoal-plastic look; bright white-grey specular glare spots on forehead, chest, shoulders, and stomach; pebbled glare | Deep, rich matte-satin cocoa-brown skin; no chalky white/grey glare; collarbones and facial planes read cleanly |

## Measured

### Pictures (`docs/screens/google/skin-v3/`)

Generated in headless Chromium (SwiftShader CPU), 390 × 844 CSS px at 2×, zero console/page errors:
- `v1-vs-v3-sheet.png` — side-by-side comparison of previous procedural skin v1 (`docs/screens/claude/realistic-body-skin/`) vs. skin v3 across light, medium, and deep tones (upper-body close-up, mid body front, mid body ¾).
- `light-sheet.png`, `medium-sheet.png`, `deep-sheet.png` — before (flat colour, classic rig) vs. after (skin v3 + soft studio light) across all 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front and ¾, plus mid upper-body close-up.
- `light-mid-upper-after.png`, `medium-mid-upper-after.png`, `deep-mid-upper-after.png` — full-resolution upper-body close-ups.
- `renders.json` — full render metadata and frame-timing runs.

### Frame time (headless Chromium, SwiftShader CPU, 390 × 844 at 2×)

Mid body alone (`height=168, bust=92, waist=74, hip=100`), 4 s continuous drag per run, 3 alternating runs per configuration (`avatarCheck.rafMs`):

| Configuration | Run 1 | Run 2 | Run 3 | Mean | Best | Delta vs. grey |
|---|---|---|---|---|---|---|
| Body without skin (`grey`, classic) | 81.7 ms | 81.7 ms | 85.1 ms | **82.8 ms** | 81.7 ms | baseline |
| Body with old flat skin (`#a07e56`, classic) | 82.6 ms | 83.7 ms | 84.0 ms | **83.5 ms** | 82.6 ms | +0.7 ms |
| Body with old procedural skin **v1** (`9a4fc62`, measured before edits on same host) | 286.9 ms | 277.8 ms | 297.6 ms | **287.4 ms** | 277.8 ms | +204.6 ms |
| Body with new procedural skin **v3** (this branch) | 236.1 ms | 242.2 ms | 242.2 ms | **240.1 ms** | 236.1 ms | +157.3 ms |

- Removing `anisotropy = 4`, 3 coarse triplanar texture fetches, and Three.js's built-in Charlie `USE_SHEEN` double-PMREM pass reduced procedural skin frame time on SwiftShader by **~47 ms (~16% faster than v1)** (and ~73 ms in isolated preview runs).
- The remaining +157 ms over the flat grey body on CPU SwiftShader comes primarily from `MeshPhysicalMaterial` + PMREM CubeUV environment sampling (`studioLight.ts`) plus 3 triplanar pore fetches per pixel; on a hardware phone GPU these texture ops are orders of magnitude faster, but still unmeasured on real hardware.

### Budgets and gates

- **Generated detail texture:** 128 × 128 RGBA8 = **64 KB** in GPU memory (bound ≤ 256 KB); deterministic, zero external files.
- **Viewer chunk (`node apps/web/scripts/check-viewer-chunk.mjs`):** `garment-viewer-DPcIfrQE.js` **189.6 KB gzip** (budget 400 KB), lazy chunk `realisticBodyLoad-*.js` **12.75 KB gzip**, not precached in `sw.js`.
- **`@curtain/garment-viewer` tests (`realisticSkin.test.ts`):** **20 / 20 passed** (including new v3 matte/studio tests that fail on v1).
- **Monorepo checks (all JS/TS packages & apps):** `build:packages` (9/9 JS/TS packages), `typecheck`, `lint`, `test` (all JS/TS packages + `@curtain/garment-spike` including `bundle.test.ts` and viewer tests), `build:apps`, `check-bundle-secrets.mjs`, `check-language-packs.mjs`, `check-viewer-chunk.mjs` — **all green**.

## Not verified

- **Real phone GPU:** all pictures and frame timings come from headless Chromium with SwiftShader on macOS CPU. Real mobile GPU frame time for procedural skin + PMREM studio light remains unmeasured.
- **`@curtain/woocommerce-plugin` PHP lint/build:** `php` is not installed on this macOS host, so `pnpm build:packages` fails only inside `packages/woocommerce-plugin/scripts/build.mjs` (`php -l`). No WooCommerce files were modified; CI with PHP should verify the full `pnpm check` command end-to-end.
- **Evaluated azure dress with skin v3:** `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/payload.json` is gitignored and absent in a clean clone, so dress-on-body renders were skipped (`hasDress: false` in `renders.json`).
- **Founder visual review** of skin v3.

## Open issues

- **Hip-line seam (`CUR-21` / WO-008):** investigated separately in `docs/reports/google/hip-seam.md`. The horizontal seam on `full` is already present in the grey mannequin mesh without `realisticSkin`, so it is primarily a geometry issue in `realisticBody.ts`, though skin v3's matte finish removes the bright specular band that previously exaggerated it.
- **Procedural skin frame cost on real mobile GPUs:** SwiftShader shows 240 ms vs. 83 ms for flat skin (~157 ms delta from PMREM CubeUV + triplanar sampling); needs a real-device measurement before enabling `realisticSkin` by default.

# Shoulder and long hair frame cost (WO-003 / CUR-7), 22 Nov 2026

- **Branch:** `google/wo-003-hair-cost` (cut from `origin/claude/realistic-body`, `9a4fc62`)
- **Model:** Gemini 4 Neon (Antigravity)
- **Work order:** `docs/work-orders/WO-003-hair-cost.md` (Linear `CUR-7`)

## Verdict

- **Huge frame-time reduction on SwiftShader without losing the look of any type:** hair delta dropped by **60%–80%** across shoulder and long hair (`1 shoulder` 167.3 → 98.4 ms, `1 long` 261.4 → 111.6 ms, `3B long` 248.0 → 123.2 ms, `3C long` 206.7 → 126.6 ms, `4C long` 205.8 → 103.8 ms on this host).
- **30 / 40 combinations now fit within the body's own SwiftShader cost (27.8 ms):**
  - All 10 `short` (10/10 pass: +6.4 to +17.1 ms)
  - All 10 `chin` (10/10 pass: +12.9 to +25.1 ms)
  - **8 / 10 `shoulder` pass** (`1`, `2A`, `2B`, `2C`, `3B`, `4A`, `4B`, `4C`: +19.2 to +27.2 ms; previously 0/10 passed)
  - **2 / 10 `long` pass** (`4A`: +22.8 ms, `4B`: +23.6 ms), with `4C long` (+30.2 ms, +2.4 ms over) and `2A long` (+31.9 ms, +4.1 ms over) just over the line.
- **10 / 40 still miss the 27.8 ms SwiftShader bound** (exact misses below): `3A shoulder` (+5.6 ms over), `3C shoulder` (+7.1 ms over), `4C long` (+2.4 ms over), `1 / 2A–2C long` (+4.1 to +10.1 ms over), and `3A–3C long` (+21.8 to +25.1 ms over). Pushing those further down on CPU SwiftShader (via fewer clumps or coarser curl segments below `period / 4.0`) visibly breaks the look (polygonal triangular curls, bare scalp patches, or hollow afro undersides when disabling `DoubleSide` on shells — verified during visual trials).
- **Zero `SIMPLER` thinning on all 40 combinations** on the mid body (previously `2C long`, `3B long`, and `3C long` hit the 27,036-triangle cap and dropped clumps).

## Done

### Code changes (only WO-003 files touched; `realisticSkin.ts` and `studioLight.ts` untouched)

- `packages/garment-viewer/src/realisticHairDraw.ts`:
  - Replaced `MeshPhysicalMaterial` (GGX anisotropy BRDF + tangent orthonormalisation) with lightweight `MeshLambertMaterial` on `cap`, `strands`, and `shells` (`strandTexture`'s per-strand luminance variation and vertex AO preserve the hair's tonal depth and strand definition without faceted card specular glare).
  - Disabled `alphaToCoverage` (eliminating expensive per-sample MSAA coverage shading on every overlapping hair pixel on SwiftShader while keeping crisp `alphaTest: 0.48` edges).
  - Lowered texture filtering from `anisotropy = 4` + `LinearMipmapLinearFilter` (up to 8 taps/pixel) to `anisotropy = 1` + `LinearMipmapNearestFilter` (1 bilinear tap/pixel).
  - Stopped uploading the unused 4-float `tangent` vertex attribute on `BufferGeometry`.
- `packages/garment-viewer/src/realisticHair.ts`:
  - **Outer-to-inner depth sorting:** sorted strand guides by `layer` descending (`1.0 → 0.0`) and emitted coily shells outer-to-inner (`s = k → 1`) so visible outer geometry writes to the Z-buffer first, enabling Early-Z rejection of occluded inner layers.
  - **Balanced wider cards, cleaner segment spacing, fewer shells:**
    - Straight (`1`): `count 230 → 128`, `width 1.7 → 2.25`, `step 1.2 → 2.0 cm` (cuts `1 long` from 24.3k → 8.3k tris).
    - Waves (`2A–2C`): `count 220/210/200 → 125/122/118`, `width +0.45 cm`, `step period / 5.5` (cuts `2C long` from 26.7k `SIMPLER` → 12.6k full).
    - Curls (`3A–3C`): `count 150 → 105/102/100`, `width +0.2–0.3 cm`, `step period / (4.0 or 4.8)` (cuts `3B long` from 26.9k `SIMPLER` → 16.8k full, `3C long` from 26.9k `SIMPLER` → 22.3k full).
    - Coils (`4A–4C`): `count 230/250/270 → 145/155/165` (also reduces stray spiky outer puffs), `shells` reduced from up to 11 (`48×10`) to `4–6` (`42×9`, kept `DoubleSide` so the underside behind the ears never reads hollow), `cap` `64×14 → 40×10`.
- `packages/garment-viewer/src/realisticHair.test.ts`:
  - Added WO-003 regression test (fails on old code) asserting all 40 combinations build without `SIMPLER` thinning under 24,000 triangles on mid, and `createHair` uses `MeshLambertMaterial`, `alphaToCoverage === false`, and `anisotropy === 1`.
- `spikes/garment-engine/viewer/realistic-hair-renders.mjs` & `realistic-hair-sheets.mjs`:
  - Added `--all-frames` mode to measure all 40 combinations (not only 5 representative types), system Chrome fallback when Playwright's bundled Chromium is absent, `/favicon.ico` 204 route, and guarded `sheet-dress.png` when dress bundles are absent.

## Measured

### Before vs. after on this host (same method: headless Chromium, SwiftShader CPU, 390 × 844 at 2×, 4 s drag)

| Combination | Before (baseline `9a4fc62`) | After (`google/wo-003-hair-cost`, best of 2) | Hair delta reduction |
|---|---|---|---|
| Empty stage (`nobody=1`) | 40.2 ms | 45.8 ms | — |
| Body alone | 74.7 ms (+34.5 ms) | 73.6 ms (**+27.8 ms** body cost) | — |
| `1 shoulder` | 167.3 ms (+92.6 ms, 13.7k tri) | **98.4 ms (+24.7 ms, 4.8k tri) — PASS** | **−73%** |
| `1 long` | 261.4 ms (+186.7 ms, 24.3k tri) | **111.6 ms (+37.9 ms, 8.3k tri)** | **−80%** |
| `3B long` | 248.0 ms (+173.3 ms, 26.9k tri) | **123.2 ms (+49.6 ms, 16.8k tri)** | **−71%** |
| `3C long` | 206.7 ms (+132.0 ms, 26.9k tri) | **126.6 ms (+52.9 ms, 22.3k tri)** | **−60%** |
| `4C long` | 205.8 ms (+131.1 ms, 22.9k tri) | **103.8 ms (+30.2 ms, 9.6k tri)** | **−77%** |

### All 40 combinations measured (best of 2 alternating runs, `docs/screens/google/hair-cost/renders.json`)

Empty stage: **45.8 ms** (mean 46.5 ms) · Body alone: **73.6 ms** (mean 74.9 ms) → **Body cost bound = 27.8 ms** (mean 28.3 ms).
Format: `total ms (+delta ms vs. body, triangles)`. **Bold** = exceeds 27.8 ms SwiftShader bound.

| Type | short | chin | shoulder | long |
|---|---|---|---|---|
| **1** | 81.3 (+7.7, 1.6k) PASS | 86.5 (+12.9, 2.9k) PASS | 98.4 (+24.7, 4.8k) PASS | **111.6 (+37.9, 8.3k) +10.1 over** |
| **2A** | 82.3 (+8.7, 1.6k) PASS | 88.0 (+14.4, 3.0k) PASS | 93.4 (+19.8, 5.0k) PASS | **105.6 (+31.9, 8.4k) +4.1 over** |
| **2B** | 83.7 (+10.0, 1.8k) PASS | 88.0 (+14.4, 3.6k) PASS | 98.0 (+24.3, 6.0k) PASS | **109.9 (+36.3, 10.3k) +8.5 over** |
| **2C** | 82.7 (+9.0, 2.0k) PASS | 89.1 (+15.5, 4.3k) PASS | 95.6 (+22.0, 7.3k) PASS | **110.4 (+36.7, 12.6k) +8.9 over** |
| **3A** | 80.1 (+6.4, 1.7k) PASS | 92.0 (+18.4, 4.4k) PASS | **107.0 (+33.4, 7.4k) +5.6 over** | **125.2 (+51.6, 12.9k) +23.8 over** |
| **3B** | 83.0 (+9.4, 2.2k) PASS | 89.6 (+16.0, 5.7k) PASS | 100.8 (+27.2, 9.4k) PASS | **123.2 (+49.6, 16.8k) +21.8 over** |
| **3C** | 90.7 (+17.1, 5.7k) PASS | 98.8 (+25.1, 9.9k) PASS | **108.6 (+34.9, 14.5k) +7.1 over** | **126.6 (+52.9, 22.3k) +25.1 over** |
| **4A** | 88.8 (+15.1, 5.0k) PASS | 88.8 (+15.1, 5.3k) PASS | 93.4 (+19.8, 6.2k) PASS | 96.4 (+22.8, 7.2k) PASS |
| **4B** | 86.2 (+12.5, 5.4k) PASS | 90.0 (+16.4, 5.9k) PASS | 92.8 (+19.2, 7.0k) PASS | 97.2 (+23.6, 8.1k) PASS |
| **4C** | 86.9 (+13.2, 6.2k) PASS | 88.0 (+14.4, 7.0k) PASS | 98.8 (+25.1, 9.0k) PASS | **103.8 (+30.2, 9.6k) +2.4 over** |

**Why the remaining 10 combinations still miss on CPU SwiftShader:**
1. **`DoubleSide` + `alphaTest` overdraw on large screen area:** long hanging hair (`1`, `2A–2C`, `3A–3C`) covers a large vertical band over the shoulders, chest, and back with 4–6 overlapping double-sided cards. On SwiftShader's software rasterizer, every `alphaTest` fragment executes texture fetch + `discard` (preventing early depth-write), scaling linearly with covered pixels × overdraw.
2. **3D corkscrew self-overdraw on `3A–3C`:** spiral ringlets wrap 360° around each guide (`12.9k–22.3k` tris), multiplying per-pixel overdraw inside each curl. Lowering curl subdivision below `period / 4.0` or cutting clumps below ~100 was tested in opt2 and visibly broke the curl silhouette (triangular faceted tubes and bare forehead scalp), so it was rejected to preserve visual fidelity.
3. **`4C long` (+2.4 ms over):** keeping `DoubleSide` on the 6 shells was required so the afro's underside behind the ears does not read hollow (`FrontSide` tested +21.3 ms PASS but left visible cutouts under the ears).

### Pictures & budgets

- **Sheets (`docs/screens/google/hair-cost/`):** `sheet-types-lengths.png` (all 40 combinations, front & back ¾, zero `SIMPLER`), `sheet-colours.png` (`2B shoulder` in all 10 colours), and `renders.json` (100 renders + 84 frame timings, zero errors). Sits alongside the old sheets in `docs/screens/claude/realistic-hair/` for direct visual comparison.
- **Generated textures:** 171 KB total in GPU memory (bound ≤ 256 KB), zero external files.
- **Viewer chunk (`check-viewer-chunk.mjs`):** `garment-viewer-PNMXhi88.js` **189.7 KB gzip** (budget 400 KB); lazy chunk `realisticHairDraw-CO-qoeVp.js` **7.87 KB gzip** (not precached in `sw.js`).
- **Gates:** `typecheck` (14/14 TS/JS projects), `lint` (14/14 TS/JS projects), `@curtain/garment-viewer` tests (`realisticHair.test.ts` 21/21), `@curtain/web` tests (80/80 files), `build:apps`, `check-bundle-secrets.mjs`, `check-language-packs.mjs`, `check-viewer-chunk.mjs` — **all green**.

## Not verified

- **Real phone GPU (OI-171):** all timings come from headless Chromium with SwiftShader CPU. Because fragment shading and alpha-test overdraw are orders of magnitude faster on a hardware mobile GPU, the 10 remaining SwiftShader misses (+2.4 to +25.1 ms) must be verified on a real phone before deciding whether any further thinning or LOD is warranted.
- **`@curtain/woocommerce-plugin` PHP build & `@curtain/api` Linux shell test (`launch-review.test.ts`):** `php` is not installed on this macOS host, and `infra/scripts/write-env.sh` expects GNU/Linux shell tooling; neither WooCommerce nor API files were touched on this branch.
- **Azure dress with hair:** `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/payload.json` is gitignored and absent in a fresh clone (`hasDress: false`).

## Open issues

- **OI-171 (partially resolved):** shoulder and long hair frame-time delta on SwiftShader is reduced by **60%–80%** (30/40 combinations now pass, including 8/10 shoulder and 2/10 long), but 10/40 (`3A/3C shoulder`, `4C long`, `1/2A–2C long`, `3A–3C long`) remain +2.4 to +25.1 ms over the 27.8 ms SwiftShader body cost; needs real-phone GPU measurement to close OI-171.
- **OI-174 (resolved on mid):** all 40 combinations now build with zero `SIMPLER` thinning on the mid body.

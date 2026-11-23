# Body iteration 2: hip seam, shoulder-to-upper-arm, knees (WO-014 / CUR-27), 23 Nov 2026

- **Branch:** `google/wo-014-body-iteration-2` (cut from `origin/claude/realistic-body`, `0a631f0`, which already includes skin v3.1, hair-cost, privacy-compression, and hair-picker)
- **Model:** Gemini 4 Neon (Antigravity)
- **Work order:** Linear `CUR-27` (WO-014; replaces the fix step of `CUR-21` / WO-008)

## Done

Fixed all three founder-reported geometry issues in `packages/garment-viewer/src/realisticBody.ts` while keeping every girth test (`±0.5%`), ring-centre bound (`≤ 0.5 cm`), conformed-under-garment bound (`≤ 1%` at waist/underbust/hip, `≤ 1.5%` at chest), and CUR-5 hand-length test strictly green across all 11 test bodies (5 main + 6 extremes). No skin, hair, or base-layer files were touched.

### 1. Hip-line seam (`CUR-21` / `CUR-27 #1`)

- **Cause:** Step 3 (`tdz`) and step 5 (`czT`) sampled Z-centring only at the sparse torso rings (`hip` at ~88 cm, `waist` at ~105 cm — a 17 cm span across the upper-buttock transition). Because MakeHuman's section centroid `av(y)` jumps from `+1.9 cm` at `hip` to `+5.6 cm` already by `y = 96–98 cm` (where the buttocks end), the sparse cubic spline lagged behind and shoved `y = 96–98 cm` `+1.66 cm` too far forward, creating a `-3.0 cm` backward cliff across `y = 98–102 cm` (`meanNy = 0.460`, `max = 0.817` on `full`).
- **Fix (`packages/garment-viewer/src/realisticBody.ts`):**
  - Replaced sparse torso Z-centring in step 3 with dense sampling (`6` sub-intervals between `hip` and `waist`) that aligns intermediate slices smoothly between the front-abdomen line and section area centroid (`0.7·dzFront + 0.3·dzAv`), so the end of the buttocks on the back does not shove the lower belly forward into a horizontal shelf.
  - Applied subtle anatomical sagittal Z-targets strictly inside the `0.5 cm` ring-centre bound (`hip: -0.40 cm`, `waist: +0.40 cm`, `underbust: +0.30 cm`, `chest: +0.15 cm`), preserving natural lumbar-pelvic posture without breaking collision alignment (`conformed` hip stays within `±1%` on all tested bodies).

### 2. Extra segment between shoulder and upper arm (`CUR-27 #2`)

- **Cause:** Two compounding discontinuities between `s = 0..4 cm` (deltoid) and `s = 12.5 cm` (`upper_arm` ring):
  1. `shoulderBand` scaled arm-root `ax` (`~24 cm`) inward toward `x = 0` over a narrow `SHOULDER_BAND_CM = 11` band, crushing the deltoid outer ridge `R_up` down to `2.26–2.37 cm` at `s = 0..4 cm` while `armFix` pulled `s = 12.5 cm` back out to `R_up = 4.21 cm` (an abrupt `0.29–0.43` slope kink).
  2. MakeHuman's baked shoulder joint sits at `z = -4.20 cm`, so step 4 shifted the arm root `+4.2 cm` forward in Z while `armFix` forced `fix(0) = 0` and yanked Z back by `-3.5 cm` at `s = 12.5 cm`.
- **Fix (`packages/garment-viewer/src/realisticBody.ts`):**
  - Carried the upper-arm Z centring offset smoothly back through `s = 0` in `armFix` (`c === 2`), eliminating the forward Z jump at the arm root.
  - Widened `SHOULDER_BAND_CM` (`11 → 14 cm`) and split the arm-root band scale into a gentle centre shift (`0.50·ab`), local arm-radius scale (`0.85·ab`), and balanced torso/arm Z scale (`1.10·ab`, with `shoulderBand *= f^1.25` over `FIT_ITERATIONS = 10`), keeping natural shoulder width and chest depth while letting the deltoid flow smoothly into the upper arm.

### 3. Knees too far back / hyperextended (`CUR-27 #3`)

- **Cause:** MakeHuman's raw standing posture has a natural forward knee (`knee av = +4.6 cm`, `calf av = +1.9 cm` due to posterior calf projection). Forcing `thigh`, `knee`, `calf`, and `ankle` all to `av = 0` with sparse ring knots pulled the knee `-2.65 cm` backward relative to the calf and created a `-0.68 cm` below-knee backward dip and `+0.81 cm` mid-thigh forward bulge (local thigh-to-shin bend `-3.9°` to `-9.3°`).
- **Fix (`packages/garment-viewer/src/realisticBody.ts`):**
  - Sampled leg Z-centring densely across `ankle → calf → knee → thigh` in step 3, eliminating mid-span spline overshoots.
  - Set gentle anatomical leg Z-targets strictly within the `0.5 cm` ring-centre bound (`thigh: -0.25 cm`, `knee: +0.42 cm`, `calf: -0.35 cm`, `ankle: 0 cm`), restoring an upright, natural standing knee alignment (`+2.0°` to `+2.8°` on all five bodies).

## Measured

### Quantitative before (`0a631f0`) vs. after (`google/wo-014-body-iteration-2`)

| Body | Hip front `ny` (`hip..waist`) | Hip `ny` (`98..102`, `full`) | Arm-root max slope (`s = 0..14`) | Arm-root `R_up` jump (cm) | Knee full bend (`th-kn-an`) | Knee local bend (`mTh-bKn-ca`) |
|---|---|---|---|---|---|---|
| **slim** | `0.195 → 0.151` | — | `0.352 → 0.151` | `2.09 → 1.19` | `0.0° → +2.2°` | `−3.9° → +2.8°` |
| **mid** | `0.206 → 0.139` | — | `0.357 → 0.141` | `1.87 → 1.02` | `0.0° → +2.1°` | `−8.4° → +2.1°` |
| **full** | `0.206 → 0.131` | **`0.460 → 0.159`** | `0.425 → 0.237` | `2.62 → 1.70` | `0.0° → +2.1°` | `−9.3° → +2.0°` |
| **tall** | `0.178 → 0.135` | — | `0.402 → 0.190` | `2.18 → 1.38` | `0.0° → +2.0°` | `−4.9° → +2.5°` |
| **petite** | `0.229 → 0.157` | — | `0.290 → 0.236` | `1.61 → 0.94` | `0.0° → +2.4°` | `−8.6° → +2.4°` |

### Regression tests (`packages/garment-viewer/src/realisticBody.test.ts` & `test/realisticBodyGirth.test.ts`)

Three new tests added in `realisticBody.test.ts` under `body iteration 2 (WO-014 / CUR-27)` — every one verified to **fail on `0a631f0`** and **pass on this branch**:
1. **Hip seam:** `meanFrontNy(full, 98, 102) < 0.22` (old `0.460`, new `0.159`) and `meanFrontNy(hip, waist) < 0.17` across all 5 bodies (old `0.178–0.229`, new `0.131–0.157`).
2. **Shoulder-to-upper-arm profile:** arm-root outer-ridge max slope `< 0.26` across all 5 bodies (old `0.290–0.425`, new `0.141–0.237`).
3. **Knees:** side-view `thigh→knee→ankle` bend `> 1.2°` (old `0.0°`, new `+2.0°..+2.4°`) and local `midThigh→belowKnee→calf` bend `> 0.5°` (old `−3.9°..−9.3°`, new `+2.0°..+2.8°`) across all 5 bodies.

All existing tests remain green:
- `realisticBody.test.ts`: **24 / 24 passed** (including CUR-5 arm length on all 5 bodies and `conformToField`).
- `test/realisticBodyGirth.test.ts`: **20 / 20 passed** (all 5 main + 6 extreme bodies within `±0.5%` girth and `≤ 0.5 cm` ring centre; all 4 `conformed` under-garment bodies within `±1%` at waist/underbust/hip and `±1.5%` at chest; all 4 negative controls).

### Pictures (`docs/screens/google/body-iteration-2/`)

Rendered in headless Chromium (SwiftShader CPU), 390 × 844 CSS px at 2×, medium matte skin v3.1 (`#a07e56`, `skinlook=procedural`), zero console/page errors:
- `five-bodies-sheet.png` — Before (`0a631f0`) vs. After across all 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front, ¾, and side.
- `closeups-sheet.png` — High-resolution Before vs. After close-ups of (1) full-body hip seam (front & ¾), (2) mid & full shoulder-to-upper-arm transition (¾), and (3) mid knees (¾ & side).
- `after-mid--three-quarter.png`, `after-mid--side.png`, `after-full--front.png`, `after-full--three-quarter.png`, `after-full--side.png` — full-resolution renders.
- `renders.json` — render metadata.

### Gates & budgets

- **Viewer chunk (`node apps/web/scripts/check-viewer-chunk.mjs`):** `garment-viewer-DEC0ES3l.js` **189.7 KB gzip** of 400 KB budget, lazy chunk `realisticBodyLoad-CGnW4be2.js` **13.55 KB gzip**, not precached in `sw.js`.
- **Monorepo checks (all JS/TS packages & apps):** `build:packages` (9/9 JS/TS packages), `typecheck`, `lint`, `@curtain/garment-viewer test` (incl. `realisticBody.test.ts` 24/24 + `realisticBodyGirth.test.ts` 20/20), `build:apps`, `check-bundle-secrets.mjs`, `check-language-packs.mjs`, `check-viewer-chunk.mjs` — **all green**.

## Not verified

- **Real phone GPU / real garment drape (`azure-palm-baby-doll-dress`):** rendered on macOS SwiftShader CPU; the evaluated dress bundle is gitignored and absent in a clean clone.
- **`@curtain/woocommerce-plugin` PHP lint/build:** `php` is not installed on this macOS host (`packages/woocommerce-plugin/scripts/build.mjs` runs `php -l`); no WooCommerce files were touched.
- **Founder visual review** of body iteration 2.

## Open issues

- **True anatomical S-curve beyond `±0.5 cm` ring-centre bound:** `realisticBodyGirth.test.ts` enforces `CENTRE_CM = 0.5 cm` against the straight-axis mannequin collider (`CUR-9` will slice the collider directly from the realistic mesh, which will allow even freer sagittal posture if desired later).

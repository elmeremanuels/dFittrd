# Arms and shoulders iteration 3: anatomical profile and carrying angle (WO-019 / CUR-33), 23 Nov 2026

- **Branch:** `google/wo-019-arms-iteration-3` (cut from `origin/claude/realistic-body`, `66f1c48`)
- **Model:** Gemini 4 Neon (Antigravity)
- **Work order:** Linear `CUR-33` (`WO-019`, follow-up to `CUR-27` / `WO-014`)

## Verdict

All eight anatomical points from the founder's feedback are implemented in `packages/garment-viewer/src/realisticBody.ts` without touching any skin, hair, or base-layer files:

1. **Shoulder & deltoid cap:** replaced the flat horizontal trapezius shelf with a smooth downward trapezius slope from the neck base (`liftTrap` + `dropOuter`, strictly below the neck ring) flowing into a rounded lateral-superior deltoid cap (`wCap`) over the top third of the upper arm.
2. **Armpit & arm root:** sculpted smooth anterior pectoral and posterior latissimus axillary folds sweeping from the torso into the upper arm, with a soft axillary hollow tucked between them.
3. **Upper arm:** added posterior triceps fullness (`-Z` muscle belly + subtle posterior shift behind the humerus axis) against a leaner anterior biceps, tapering cleanly toward the elbow (`backFromAxis / frontFromAxis = 1.33–1.46×`, vs `0.90–0.96×` before).
4. **Elbow:** narrowed the elbow cross-section (`kProf`) so it is clearly narrower than both upper arm and upper forearm on all five test bodies (including `slim` and `tall`, where the old fit had `elbow > forearm`), added a subtle localized posterior bony olecranon point, and preserved hanging elbow height right at waist height (`|jY − sElbow − waistY| = 0.3–0.5 cm`).
5. **Forearm & flat slim wrist:** added upper forearm fullness right below the elbow (`f ≈ 0.625`) tapering cleanly to a slender, flat wrist (`depthZ / widthU = 1.94–1.99`, vs `1.63–1.67` before), and replaced the coarse 5-station arm spline with 9 dense stations (`ARM_STATIONS`) to eliminate the old elbow and distal-wrist Z-wiggle.
6. **Carrying angle (10°–15°):** replaced the straight-chord arm centring (`0°` carrying angle) with a straight-humerus + outward-forearm curve (`CARRY_ANGLE_RAD = 13.4°` target, using `±0.32 cm` at `upper_arm`/`wrist` strictly inside the `0.5 cm` ring-centre bound), giving **`10.6°–11.2°`** outward carrying angle across all five bodies (`−0.6°..0.0°` before) with no mid-biceps bow.
7. **Arm length:** `CUR-5` hand-length test (`0.108 × stature` past wrist, fingertips mid-thigh) remains 100% green across all five bodies.
8. **Back control:** preserved and softly refined the central spine groove and gentle shoulder-blade relief (`scapRelief = 0.9–2.0 cm`) with clear waist taper from behind.

All 51 realistic-body tests pass (`realisticBody.test.ts` 31/31 incl. 7 new CUR-33 tests + `test/realisticBodyGirth.test.ts` 20/20 across all 5 main bodies, 6 extreme bodies, drawn viewer body, 4 conformed under-garment bodies, and 4 negative controls).

## Measured

### Quantitative before (`66f1c48`) vs. after (`google/wo-019-arms-iteration-3`)

| Body | Shoulder drop `x=8→18` (cm) | Upper arm `back/front` from axis | Girth `upper → elbow → forearm → wrist` (cm) | Wrist flat ratio `width/thick` | Carrying angle (XY) | Hanging elbow vs waist (cm) | Back scapula relief (cm) |
|---|---|---|---|---|---|---|---|
| **slim** | `2.5 → 3.5` | `0.93 → 1.38` | `25.6 → 22.0 → 22.9 → 14.5` *(old elbow `24.2 > 22.8`)* | `1.67 → 1.99` | `−0.3° → +11.0°` | `+0.4` | `1.2` |
| **mid** | `2.6 → 3.5` | `0.95 → 1.45` | `28.3 → 21.7 → 24.4 → 15.5` *(old `23.7 / 24.2`)* | `1.67 → 1.95` | `−0.3° → +10.7°` | `+0.4` | `1.5` |
| **full** | `2.1 → 2.1*` | `0.94 → 1.33` | `36.5 → 26.0 → 29.4 → 17.0` *(old `28.5 / 29.2`)* | `1.63 → 1.95` | `−0.4° → +11.2°` | `+0.5` | `2.0` |
| **tall** | `2.8 → 3.9` | `0.94 → 1.46` | `28.3 → 23.5 → 24.6 → 15.5` *(old elbow `25.7 > 24.6`)* | `1.67 → 1.99` | `−0.6° → +11.0°` | `+0.5` | `1.4` |
| **petite** | `2.1 → 3.0` | `0.94 → 1.43` | `26.5 → 20.3 → 23.2 → 14.8` *(old `22.3 / 23.0`)* | `1.63 → 1.95` | `0.0° → +10.6°` | `+0.3` | `2.0` |

*(\*On `full`, the wider chest pushes the acromion past `x = 18 cm`; from `x = 8 → 22 cm` the drop is `4.0 cm`.)*

### Regression tests (`packages/garment-viewer/src/realisticBody.test.ts` & `test/realisticBodyGirth.test.ts`)

Added 7 new anatomical tests under `arms and shoulders iteration 3 (WO-019 / CUR-33: anatomical profile across all 5 bodies)`:
- `1. shoulder`: trapezius slopes smoothly downward from neck base to acromion (`drop > 2.0 cm`) alongside `CUR-27`'s outer arm-root smooth-slope check (`maxSlope = 0.16–0.24 < 0.26`).
- `2. armpit`: anterior and posterior axillary folds protrude cleanly on both sides of the arm root (`maxFront > 3.5 cm`, `minBack < −3.0 cm`, Z span `> 7.5 cm`).
- `3. upper arm`: posterior triceps fuller than anterior biceps (`backFromAxis / frontFromAxis > 1.25`, fails on `66f1c48` at `0.93–0.95`) and clear taper to elbow (`> 2.8 cm`).
- `4. elbow`: narrower than upper arm (`> 3.0 cm`) and narrower than upper forearm (`> 0.7 cm`, fails on `66f1c48` `slim`/`tall`), posterior olecranon prominence (`backR / frontR > 1.03`), and hanging height within `1.5 cm` of waist.
- `5. forearm and wrist`: fuller below elbow, tapering cleanly (`> 7.5 cm`) to a slim flat wrist (`depthZ / widthU > 1.85` at wrist, `> 1.35` distally; fails on `66f1c48` at `1.63–1.67` / `1.22`).
- `6. carrying angle`: outward forearm carrying angle in `10°–15°` across all 5 bodies (fails hard on `66f1c48` at `−0.6°..0.0°`).
- `8. back control`: soft shoulder-blade relief (`> 0.8 cm` deeper than spine groove) and clear waist taper from behind.

All existing suites remain 100% green:
- `src/realisticBody.test.ts`: **31 / 31 passed** (including `CUR-5` arm length & `CUR-27` hip/shoulder/knee tests).
- `test/realisticBodyGirth.test.ts`: **20 / 20 passed** (all 5 main + 6 extreme bodies within `±0.5%` girth and `≤ 0.5 cm` ring centre; drawn viewer body; 4 conformed under-garment bodies; 4 negative controls).

### Pictures (`docs/screens/google/arms-iteration-3/`)

Rendered in headless Chromium (Google Chrome + SwiftShader CPU), medium skin v3.1 (`#a07e56`, `skinlook=procedural`):
- `five-bodies-sheet.png` — Before (`66f1c48`) vs. After across all 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front, ¾, side, and **back**.
- `closeups-sheet.png` — High-resolution Before vs. After close-ups of (1) shoulder & deltoid (mid & full front), (2) armpit folds & back (mid ¾ & back), (3) upper arm triceps & elbow (mid side & full ¾), and (4) carrying angle, forearm belly & slim flat wrist (mid front & side).
- `after-mid--front.png`, `after-mid--back.png`, `after-mid--side.png`, `after-full--front.png`, `after-full--back.png`, `renders.json`.

### Gates & budgets

- **Viewer chunk (`check-viewer-chunk.mjs`):** `garment-viewer-DPc4Oncy.js` **189.7 KB gzip** of 400 KB budget; lazy chunk `realisticBodyLoad-BjXwQ6lz.js` **14.91 KB gzip** (not precached in `sw.js`).
- **Monorepo TS/JS checks:** `build:packages` (9/9 JS/TS), `typecheck` (14/14), `lint` (14/14 + `check-banned-models.mjs`), `@curtain/garment-viewer` tests (`realisticBody.test.ts` 31/31, `realisticBodyGirth.test.ts` 20/20, `realisticHair.test.ts` 21/21), `build:apps`, `check-bundle-secrets.mjs`, `check-language-packs.mjs`, `check-viewer-chunk.mjs` — **all green**.

## Not verified

- **`@curtain/woocommerce-plugin` PHP lint (`php -l`):** `php` is not installed on this macOS host (`pnpm check` fails only on `php -l`); no WooCommerce or PHP files were touched.
- **Real phone GPU & founder visual review:** rendered on macOS SwiftShader CPU; ready for founder review on Linear `CUR-33`.

## Open issues

- **OI-149 (resolved for arms/shoulders iter 3):** flat horizontal trapezius shelf and straight tubular arms replaced with sloping trapezius, rounded deltoid cap, axillary folds, triceps fullness, narrow bony elbow, forearm belly, flat slim wrist, and 10.6°–11.2° female carrying angle while keeping all 12 anchor rings within `±0.5%` girth and `≤ 0.5 cm` centre.

# Handoff: WO-020 iteration 1 (Google, Gemini 4 Neon), 23 Nov 2026

## 1. Where it stands

- **Branch:** `google/wo-020-face-shape`
- **Base branch & commit:** `origin/claude/realistic-body` at `66f1c48`
- **Last commit before this handoff:** `e0843bc` (`feat(garment-viewer): tighten anatomical face bounds and add 9-face synthetic sheets (WO-020 / CUR-34)`)
- **Linear issue:** `CUR-34` (WO-020 · Gezichtsvorm uit een selfie op het realistische lichaam)

### Gates run locally (real output summary)

- `pnpm --filter '!@curtain/woocommerce-plugin' --filter './packages/**' build`: **9/9 packages green** (`@curtain/schema`, `@curtain/tryon-providers`, `@curtain/anchors`, `@curtain/sdk` 8187 B gzip / 8192 B, `@curtain/taste-engine`, `@curtain/fit-engine`, `@curtain/mannequin`, `@curtain/garment-viewer`, `@curtain/demo`).
- `pnpm --filter '!@curtain/woocommerce-plugin' typecheck`: **14/14 workspace projects green**.
- `pnpm --filter '!@curtain/woocommerce-plugin' lint`: **green**.
- `pnpm --filter @curtain/garment-viewer test realisticBody faceShape`: **51/51 tests green** (`src/realisticBody.test.ts` 24/24, `test/realisticBodyGirth.test.ts` 20/20, `src/faceShape.test.ts` 7/7).
- `pnpm build:apps`: **green** (`check-viewer-chunk: garment-viewer-Cpc_Pwbz.js 193.0 KB gzip of 400 KB (+ drapeBakeRead-DvIv6L-w.js 8.3 KB, bakes only); three.js in no other chunk; not precached`; `realisticBodyLoad` 13.85 KB gzip; `female-v1.crb` 455.56 KB raw).
- `node scripts/check-bundle-secrets.mjs`: `✓ no secret-looking strings in client bundles`
- `node scripts/check-language-packs.mjs`: `language packs: en on all 5 surfaces`

## 2. What was built

- `packages/garment-viewer/scripts/bake-realistic-body.ts`: Added 28 pinned CC0 MakeHuman face target files (from `makehumancommunity/mpfb2` at commit `9de0707fdc88438d7c53a1a2ac7937d9221e2431`, all SHA-256 verified) baked into 12 signed face-shape axes (`faceWidth`, `faceHeight`, `jawWidth`, `chinWidth`, `chinHeight`, `chinProminence`, `cheekbones`, `noseLength`, `noseWidth`, `eyeSpacing`, `browHeight`, `lipWidth`) plus 26 symmetric head landmark vertex indices (`meta.faceLandmarks`). Every face target is masked strictly above the neck ring (`headWeight >= 0.05 && y > levels.neck + 1.0`, smooth fade) so no body or arm ring can change.
- `packages/garment-viewer/assets/realistic-body/female-v1.crb` & `PROVENANCE.md`: Deterministic re-bake (`sha256: 1b7520ec738c2e4ad31d3726e133d5fb4a055ca3bd7c950a05e79c44be44cf8d`, watertight, 0 boundary/non-manifold edges). Updated provenance table with every target path and SHA-256 under CC0-1.0.
- `packages/garment-viewer/src/faceShape.ts`: Pure, zero-dependency, on-device least-squares face-shape fitter (`fitFaceShape`) taking 478 MediaPipe landmarks and the realistic body asset. Handles mirrored front cameras, normalises head roll, scale and mild yaw, rejects smiles / open mouths (`reason: 'smile'`) and strongly turned/tilted heads (`turned` / `tilted`), solves a 3-step regularised Gauss-Newton fit of 19 dimensionless facial proportions onto the 12 CC0 targets, and clamps every weight to per-axis anatomical bounds (`FACE_TARGET_BOUNDS`, max `0.8`) so no face can go grotesque. Also exports `syntheticFaceLandmarks` (zero real photos, D19).
- `packages/garment-viewer/src/faceShape.test.ts`: 7 unit tests verifying asset integrity, neutral zero recovery, multi-axis round-trip recovery (`< 0.08` weight error under roll & scale), extreme weight clamping, smile/open-mouth refusal, turned/tilted/invalid landmark refusal, and full-strength body/arm/neck ring invariance (`< 0.5 %`).
- `packages/garment-viewer/src/realisticBody.ts`, `realisticBodyLoad.ts`, `mount.ts`, `index.ts`: Backwards-compatible `CRB1` encode/decode for optional `faceTargets` and `faceLandmarks`; `FitOptions.faceShape` and `MountOptions.faceShape` (stylised geometry only, no photo texture, D27; absent → head unchanged; tags `canvas.dataset.faceShape = 'custom'` when active).
- `apps/web/e2e/privacyRealisticBody.spec.ts`: Extended request-inspection assertions so no network body or URL may contain `faceShape`, `faceLandmarks`, `landmarks`, or individual face-shape weight keys (`jawWidth`, `chinProminence`, `cheekbones`, `noseLength`, `eyeSpacing`, `browHeight`, `lipWidth`).

### Design choices & rejected alternatives

- **12 signed bilateral axes (`(pos - neg)/2`) inside `female-v1.crb`** instead of 24 separate half-targets or a second `.crb` file: keeps the realistic body to a single static GET request (preserving `privacyRealisticBody.spec.ts`'s exact-1-request invariant) and halves asset growth (`+45.1 KB` gzip vs `+150 KB` budget).
- **Per-axis anatomical bounds (`FACE_TARGET_BOUNDS`)** (`faceWidth: ±0.45`, `faceHeight: [-0.40, +0.45]`, `chinHeight: [-0.45, +0.55]`, etc.) instead of a uniform `±1.0` clamp: visual inspection of an initial 9-face render caught that MakeHuman's full `head-scale-horiz`/`vert`/`chin-height` at `±0.7` created caricature pinching and forehead bulges; tightening per-axis bounds and removing an uneven crown dampener eliminated both artefacts completely.
- **`head-triangular` / `head-invertedtriangular` for `jawWidth`** instead of `chin-bones-incr/decr`: inspecting vertex deltas showed `chin-bones` shifted the jaw vertically rather than horizontally, whereas `head-triangular`/`invertedtriangular` gives a clean lateral bigonial jaw-width axis.
- **No FLAME / BFM / non-commercial models; no photo texture (D27); no real photos in the repo (D19).**

## 3. What works, as measured

- **Asset size (`female-v1.crb`):**
  - Before WO-020: `337,732 B` raw · `251,160 B` gzip · `175,655 B` brotli
  - After WO-020: `455,556 B` raw · `297,356 B` gzip · `201,139 B` brotli
  - Growth: **`+115.1 KB` raw · `+45.1 KB` gzip · `+24.9 KB` brotli** (budget: `< +150 KB` gzip)
- **On-device fit performance & accuracy (9 synthetic faces, incl. ±7° roll and scale variation):**
  - Fit time (`fitFaceShape`): **`0.6–2.1 ms`** steady-state (`5.2 ms` cold first call)
  - WebGL render frame time (headless SwiftShader CPU): **`0.4–5.1 ms`** steady-state per view
  - Feature similarity: **`100.0%`** across all 9 faces (`maxErr = 0.000–0.013` across all 12 axes)
- **Body & ring invariance:** All 20 independent slicer tests (`realisticBodyGirth.test.ts`, 11 bodies including extremes) and 24 `realisticBody.test.ts` tests (incl. CUR-5 arm length and CUR-27 checks) stay green; neck girth drift under full-strength `faceShape` is `< 0.05 cm`.
- **Visual sheets (zero real photos):**
  - `docs/screens/google/face-shape/nine-faces-sheet.png` (9 synthetic faces: 478-pt landmark diagram + front, ¾, profile + similarity & fit time)
  - `docs/screens/google/face-shape/archetypes-overview.png` (3×3 front + profile overview grid)

## 4. What does not work yet

- **Embed UI & worker wiring for live selfie → `fitFaceShape`:** `fitFaceShape` and `MountOptions.faceShape` are built, exported, tested, and privacy-guarded, but the web embed capture UI (`apps/web/src/features/capture/scan.worker.ts` + `embed/storage.ts`) is not yet wired to feed live MediaPipe 478 landmarks into `fitFaceShape` and store/delete the resulting 12 weights next to `look:<shopId>`. Left clean for Claude's review & integration pass (iteration 2) so privacy/consent copy (D19) and storage encryption are reviewed together.
- **Demo E2E (`pnpm demo:e2e`, `DEMO_SKIRT=pom pnpm demo:e2e`) and `privacyRealisticBody.spec.ts` live browser execution:** not run locally in this turn; left for Claude's iteration-2 verification alongside the embed wiring.

## 5. Not verified

- `@curtain/woocommerce-plugin` PHP lint (`php -l`) — `php` is not installed on this macOS host (no PHP files touched).
- Live MediaPipe `face_landmarker.task` WASM run on real selfie images (by design D19, no real photos are used or stored in the repo; synthetic 478-pt landmarks verified end-to-end).
- Physical phone GPU frame times (screenshots and frame times measured in headless Chromium SwiftShader software WebGL).

## 6. Advice for the next iteration (Claude)

1. Review `packages/garment-viewer/assets/realistic-body/PROVENANCE.md` and `scripts/bake-realistic-body.ts` SHA-256 / CC0 licence provenance (all 28 new target files come from the exact same pinned MPFB2 commit `9de0707fdc88438d7c53a1a2ac7937d9221e2431`).
2. Wire `scan.worker.ts` (which already produces the 478 MediaPipe landmarks in memory and disposes before 3D view) → `fitFaceShape(landmarks, asset)` → encrypted/deletable on-device `faceShape` weights in `apps/web/src/embed/storage.ts` (following `look:<shopId>` / `hair:<shopId>`, wiped on delete / `forget()` / Remember-me off) → `MountOptions.faceShape`.
3. Run `pnpm demo:e2e`, `DEMO_SKIRT=pom pnpm demo:e2e`, and `VITE_VIEWER_BODY=realistic-spike` Playwright privacy e2e (`apps/web/e2e/privacyRealisticBody.spec.ts`) before merging into `claude/realistic-body`.
4. Note: `female-v1.crb` is backwards-compatible with `CRB1`, so once merged, existing callers without `faceShape` draw the exact same head.

## 7. Open issues

- None opened; relates to D19 (on-device privacy, no photos/landmarks leaving device) and D27 (stylised 3D face without photo texture).

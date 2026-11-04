# `apps/web/src/features/capture` — on-device body & face capture

The onboarding capture step of Paskamer (handoff §2.1, DECISIONS.md D3/D5). Everything in this
directory runs in the browser; the heavy lifting runs in a Web Worker. **Raw photos and video never
leave the device** — see “Privacy guarantees” below.

## Pipeline

```
<CaptureStep/>  ──face photo──▶  scan.worker.ts ──▶ FaceLandmarker + multiclass segmenter
    │                                   │             → skin Lab samples → k-means → ITA → Monk
    │                                   │             → undertone, 12-season *estimate*, face tile
    ├──8 s video frames (ImageBitmap)──▶│ PoseLandmarker VIDEO mode, per frame:
    │                                   │   poseGate.ts    full body · visibility>0.8 · tilt<5° · A-pose · stable span
    │                                   │   classifyView   0° (front) / 90° (side) from shoulder/torso ratio + ears/nose
    │                                   │   frameRetainer  keep best±1 front/side + 2 latest, close the rest
    │   finish(height, weight, sex) ───▶│ segmenter on chosen frames (+2 neighbours, majority mask)
    │                                   │   crossSections.ts  12 levels from landmark proportions
    │                                   │   maskGeometry.ts   width (front) / depth (side) per level, clothing coverage
    │                                   │   measure.ts        scale = height / (head-top→heel px); Ramanujan ellipse girths;
    │                                   │                     mean blended with prior.ts; σ from the v1 table; quality gate
    │   ◀── landmarks, 2 masks, girths, lengths, posture, quality, ONE cream-background base frame, ONE face tile
    ├── manual measurements (+ “how did you measure”: tape 1.5 / memory 2.5 / guess 4 cm)
    └── fuse.ts  inverse-variance fusion scan ⊕ manual (⊕ prior fallback), 2σ agreement test, conflict flags,
                 confidence = clamp(0.95 − 0.26·(σ − 1.66), 0.2, 0.98)
                 → BodyProfile (schema) → storage.ts (Dexie, AES-GCM base frame) → signature.ts (FitSignature v1)
```

Modules are pure wherever possible and tested in node (`__tests__/`); only `scan.worker.ts`,
`scanSession.ts`, `platform/camera.ts`, `storage.ts` and the React components touch browser APIs.

## Public API (`import { … } from '@/features/capture'`)

- `CaptureStep` (default export) — props `{ onComplete(profile: BodyProfile, extras), onSkip(), persist?, modelBase?, initialProfile?, initialForm? }`.
  `extras = { faceTileBlob, skin: SkinEstimate | null, scan, baseFrame, silhouette, signature: BuiltSignature }`.
  Face → body → manual → fusion; works without a camera (straight to manual) and when MediaPipe fails to load.
- `fuseProfile(input) → { profile, points, conflicts }` — the fusion, reusable by the profile screen (“remeasure”).
- `buildFitSignature(profile, scan?, { sex, ageYears, prefs }) → { profile, vector[80], wire }` — the body of `PUT /v1/me/signature`.
- Storage: `saveCapture`, `loadBodyProfile`, `loadBaseFrame`, `loadFaceTile`, `loadSilhouette`, `deleteScan` (one transaction), `PaskamerDb`.
- Measurement primitives: `measureScan`, `ellipsePerimeter`, `scaleCmPerPx`, `populationPrior`, `placeLevels`, `gateFrame`, `selectFrames`.
- Colour: `estimateSkin`, `srgbToLab`, `ita`, `monkFromIta`, `undertoneFromLab`, `seasonEstimate`, `MONK_SWATCHES`.
- `ScanSession` — main-thread handle on the worker (`init`, `pushFrame`, `finish`, `analyseFace`, `onGate`, `dispose`).

Wire and body types (`BodyProfile`, `Measurement`, `UserBody`, `FitSignature*`) come only from `@paskamer/schema`.

## Privacy guarantees (AGENTS.md rule 1, D3)

- Frames are transferred into the worker as `ImageBitmap`s and closed there. The worker never posts a video frame.
  What leaves the worker: 33 landmarks per chosen frame, two category masks, per-level widths/depths, lengths,
  posture descriptors, a quality score, **one** front base frame with the background replaced by cream `#F5EFE7`
  (for render path B) and **one** 320 px face tile.
- Persistence (`storage.ts`, Dexie db `paskamer`): `bodyProfile`, `baseFrame` (AES-GCM, 256-bit **non-extractable**
  WebCrypto key held in the `keys` store), `faceTile`, `silhouette`, `keys`. `deleteScan()` clears all five stores in
  one transaction. No video frame is ever written.
- The fit signature (`signature.ts`) carries no face/skin/hair/colour value; `assertNoColourData` guards it and the
  test suite asserts it. Skin tone, undertone and season stay in the `faceTile` row on the device.
- Model files load from the same origin (`/models/…`). Onboarding makes zero third-party requests.
- The capture step does no network I/O at all. Syncing the signature is the app's job, via the privacy ledger.

## Expected accuracy (v1, analytic)

- Scan-only girths: **3–4 cm** MAE in cooperative conditions (σ table in `measure.ts`: bust/waist 3.0, hip 2.5,
  thigh 3.5, arm 2.0, wrist/ankle 1.0 cm) → ≈ 60 % confidence.
- Scan ⊕ agreeing tape measurement: **≈ 1.5–2 cm** → ≈ 95 % confidence (98 % with `tape` σ = 1.5).
- Height comes from the user (image height alone is 1–7 cm off). Clothing is the largest error source: the segmenter's
  clothes/skin ratio lowers quality and inflates σ. The σ reported for the scan is the published-style table, not the
  formal inverse-variance blend of ellipse and prior (their errors are not independent of clothing/pose error).
- Adequate for 4–6 cm size steps; every render built on it is labelled an estimate.

## Fetching the models (self-hosted)

```
node apps/web/src/features/capture/scripts/fetch-models.mjs            # → apps/web/public/models
node apps/web/src/features/capture/scripts/fetch-models.mjs --out DIR  # elsewhere, --force to re-download
```

Copies the WASM runtime from the installed `@mediapipe/tasks-vision` (version-locked to the JS bundle) and downloads
`pose_landmarker_full.task` (9.4 MB), `pose_landmarker_lite.task` (5.8 MB), `selfie_multiclass_256x256.tflite`
(16.4 MB) and `face_landmarker.task` (3.8 MB) from Google's model storage (pinned `/1/` paths), writing
`models.manifest.json` with sha256 per file. ~50 MB in total; serve `/models` with long cache headers from Caddy.
The worker picks the lite pose model on ≤ 4 cores / ≤ 4 GB devices and falls back from the GPU to the CPU delegate.

## Running

```
pnpm --filter @paskamer/web test        # vitest, node environment, __tests__/*.test.ts
pnpm --filter @paskamer/web typecheck
pnpm --filter @paskamer/web build
```

Tests cover level placement, ellipse perimeter, scale, prior, fusion (handoff targets: scan-only ≈ 60 %, scan +
tape ≈ 95 %, conflict flag + remeasure), mask geometry on a painted synthetic figure, gating/selection with synthetic
landmark arrays, Lab/ITA/Monk/season on known colours, signature encoding and AES-GCM. The worker and MediaPipe
calls cannot run in node and need a manual check in a browser with the models in place.

## Post-MVP (same `measure.ts` interface)

- **Regressor**: a BMnet-style silhouette+height+weight → girths network (ONNX Runtime Web, WebGPU/WASM) trained on
  synthetic Anny renders + consented pilot data (BodyM is CC BY-NC — evaluation only). Drops in behind `measureScan`.
- **Anny mesh**: fit Anny phenotype + local blendshapes to the fused girths/lengths by on-device least squares; export
  the 4-view silhouette atlas for render path B. Fills FitSignature slots 56–65.
- Pilot calibration of the σ table and the confidence mapping on 50–100 tape-measured volunteers; white-balance
  reference for the skin step; LiDAR/monocular depth for the side view.

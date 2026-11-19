# `apps/web/src/features/capture` — on-device body & face capture

The onboarding capture step of Curtain (handoff §2.1, DECISIONS.md D3/D5). Everything in this
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
    │                                   │   crossSections.ts  12 levels from landmark proportions; neck = narrowest run
    │                                   │                     nose→shoulders; front-view contact limits (legs split at
    │                                   │                     the midline, torso/arm levels rejected where a limb touches)
    │                                   │   maskGeometry.ts   width (front) / depth (side) per level, clothing coverage,
    │                                   │                     shoulder slope from the mask's top contour
    │                                   │   measure.ts        scale = height / (head-top→heel px), head top WITHOUT hair
    │                                   │                     (headTopWithoutHair); Ramanujan ellipse girths; mean
    │                                   │                     blended with prior.ts (SCAN_PRIOR_SIGMA_CM); σ from the v1 table
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
- Storage: `saveCapture`, `loadBodyProfile`, `loadBaseFrame`, `loadFaceTile`, `loadSilhouette`, `deleteScan` (one transaction), `CurtainDb`.
- Measurement primitives: `measureScan`, `ellipsePerimeter`, `scaleCmPerPx`, `populationPrior`, `placeLevels`, `gateFrame`, `selectFrames`.
- Colour: `estimateSkin`, `srgbToLab`, `ita`, `monkFromIta`, `undertoneFromLab`, `seasonEstimate`, `MONK_SWATCHES`.
- `ScanSession` — main-thread handle on the worker (`init`, `pushFrame`, `finish`, `analyseFace`, `onGate`, `dispose`).

Wire and body types (`BodyProfile`, `Measurement`, `UserBody`, `FitSignature*`) come only from `@curtain/schema`.

## Privacy guarantees (AGENTS.md rule 1, D3)

- Frames are transferred into the worker as `ImageBitmap`s and closed there. The worker never posts a video frame.
  What leaves the worker: 33 landmarks per chosen frame, two category masks, per-level widths/depths, lengths,
  posture descriptors, a quality score, **one** front base frame with the background replaced by cream `#F5EFE7`
  (for render path B) and **one** 320 px face tile.
- Persistence (`storage.ts`, Dexie db `curtain`): `bodyProfile`, `baseFrame` and the `faceTile` image (both AES-GCM,
  256-bit **non-extractable** WebCrypto key held in the `keys` store), `silhouette`, `keys`. `deleteScan()` clears all five stores in
  one transaction. No video frame is ever written.
- The fit signature (`signature.ts`) carries no face/skin/hair/colour value; `assertNoColourData` guards it and the
  test suite asserts it. Skin tone, undertone and season stay in the `faceTile` row on the device.
- Model files load from the same origin (`/models/…`). Onboarding makes zero third-party requests:
  `resolveModelBase` (models.ts) rejects any `modelBase` on another origin before the worker fetches anything.
- The worker is a module worker, so it loads MediaPipe's ES-module WASM loader
  (`FilesetResolver.forVisionTasks(base, VISION_WASM_ES_MODULE)`); the classic loader cannot run there.
- MediaPipe Tasks (1.2.2) has a built-in usage logger that POSTs to `odml.pa.googleapis.com`; the worker refuses
  every request off its own origin before any task exists (`sameOriginOnly.ts`), so it is never sent.
- Second wall: the app's Content-Security-Policy (`apps/web/config/csp.ts`, sent by Caddy and by the e2e preview on
  every response, worker scripts included) has `connect-src 'self' <api>`, so the browser refuses that request too.
  Third wall: `apps/web/e2e/privacyModels.spec.ts` runs the whole capture step with the real models and fails on any
  request off the app origin or any CSP violation (page or worker).
- MediaPipe clears `self.ModuleFactory` after creating each task, and a cached ES-module `import()` does not run the
  loader again, so the worker puts the factory back before each task (`moduleFactoryRearmer`, models.ts). Without it
  only the first task loaded and the production build always fell back to manual entry.
- The capture step does no network I/O at all. Syncing the signature is the app's job, via the privacy ledger.

## Expected accuracy (v1, analytic)

- Scan-only girths: **3–4 cm** MAE in cooperative conditions (σ table in `measure.ts`: bust/waist 3.0, hip 2.5,
  thigh 3.5, arm 2.0, wrist/ankle 1.0 cm) → ≈ 60 % confidence.
- Scan ⊕ agreeing tape measurement: **≈ 1.5–2 cm** → ≈ 95 % confidence (98 % with `tape` σ = 1.5).
- Upper-arm and wrist never take a side-view depth (the arm hangs over the torso there): population aspect, σ ×1.35.
  A torso level where an arm touches the body is not measured (warning) rather than measured with the arm in it.
- Height comes from the user (image height alone is 1–7 cm off). Clothing is the largest error source: the segmenter's
  clothes/skin ratio lowers quality and inflates σ. The σ reported for the scan is the published-style table, not the
  formal inverse-variance blend of ellipse and prior (their errors are not independent of clothing/pose error).
- Head top (carry-over #16): the stature ends at the skull, but the person mask includes hair. `headTopWithoutHair`
  takes the first person row only when there is no hair above the face; with hair on top it places the vertex
  `VERTEX_ABOVE_HAIRLINE_RATIO` (0.28, approximate adult proportions) of the hairline → chin distance above the
  hairline (face-skin class), clamped between the hair top and the hairline. Hair volume no longer shrinks the scale
  (6 cm of hair read girths ≈ 3.4 % low before; synthetic test `headTop.test.ts`). Without a face in the band (back
  view) it falls back to the first person row. The ratio is not measured: calibrate it with the tape-measured pilot.
- Prior weight (carry-over #17): `SCAN_PRIOR_SIGMA_CM` (4 cm) is the one knob; the prior carries 51–77 % of the
  blended girth mean depending on the level (`priorShare`). Unchanged until the tape-measured pilot data exist.
- The face step tells "models loading" (buttons disabled, waits) apart from "models failed" (not available, skip).
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
pnpm --filter @curtain/web test        # vitest, node environment, __tests__/*.test.ts
pnpm --filter @curtain/web typecheck
pnpm --filter @curtain/web build
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

## Face on the 3D head (slice 6 spike, flag `VITE_AVATAR_FACE_ON_HEAD`, off by default)

`faceOnHead.ts` → `ScanSession.bakeFaceTexture` → `scan.worker.ts` (`faceTexture` message) → `faceBake.ts`.
One picture the shopper chose (only after "Yes, use my photo") is decoded on the main thread, transferred to a worker
that loads only the Face Landmarker (no pose model, no segmenter), and baked into a 512 px RGBA texture in the head v2
face frame of `@curtain/mannequin` (`FACE_UV_FRAME`): a piecewise-affine warp over MediaPipe's canonical face mesh
(`faceMeshUv.json`, Apache-2.0, built by `scripts/build-face-mesh-uv.mjs`), a feathered edge, a crude de-light (a
quadratic light field per channel, fitted to the skin) and a match to the confirmed swatch. Out of the worker come the
texture, a few numbers (coverage, yaw, roll, median colour, gain spread, face width) and timings; the 478 landmarks
never leave it. The worker is disposed after each bake. Nothing is stored; nothing is sent (`e2e/faceOnHead.spec.ts`
traps fetch, XHR, WebSocket, sendBeacon, EventSource and RTCPeerConnection over the whole flow). The viewer lays it
over the head (`packages/garment-viewer/src/faceOverlay.ts`). Report: `docs/reports/claude/face-on-head-spike.md`.

## Skin tone from a face photo and the own face in 2D (slices 4 and 5, flag `VITE_AVATAR_FACE_PHOTO=live`, off by default)

`faceLook.ts` → `ScanSession.faceLook` → `scan.worker.ts` (`faceLook` message) → `faceTile.ts`. One picture, chosen
only after the age box and "Yes, use my photo" in the embed's avatar prompt, is decoded on the main thread and
transferred to a worker that loads only the Face Landmarker (no pose model, no segmenter). The worker makes only what
the shopper said yes to: the **face tile** (eye line levelled, the face oval scaled with one scale into the 2D head's
aspect, soft-edged, a plane of side light taken out, an edge-keeping blur, soft steps in lightness and a little local
contrast so the eyes, brows and mouth read on a 30 px head) and/or the **skin tone suggestion** (cheeks, forehead and
nose bridge → Lab → k-means → ITA → Monk class) with light notices (turned, small, bright, dark, side light, colour
cast) that warn and never block. Out come the tile's pixels and its skin colour, the suggested class and the notices;
the landmarks never leave the worker, and the worker is disposed after each photo. The suggestion only marks a swatch:
the colour changes when the shopper taps one (plan gate G4). `matchTileToSkin` recolours the tile to the drawn head
on the main thread when the swatch changes, without the photo. Nothing is sent (`e2e/facePhoto2d.spec.ts`,
`src/embed/__tests__/facePhotoFlow.test.tsx`). Report: `docs/reports/claude/face-2d-slice5.md`.

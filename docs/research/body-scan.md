# On-device body scan, measurements and skin-tone extraction

> Researched 2026-11-04 by parallel research + fact-check agents. Figures were spot-checked against primary sources; corrections from the fact-check are listed at the end and override the report body where they conflict. Not legal advice.

## Summary

Bottom line (researched 2026-11-04): a fully on-device body scan in a web app/PWA is feasible today, but NOT by fitting SMPL-X in the browser. The practical v1 is: MediaPipe Tasks Vision (@mediapipe/tasks-vision 1.2.2, Apache-2.0, published 2026-11-03) running Pose Landmarker (33 2D + metric 3D "world" landmarks, optional person mask), the multiclass selfie Image Segmenter (background/hair/body-skin/face-skin/clothes/accessories) and Face Landmarker (478 landmarks) inside a Web Worker; silhouettes + user height + weight feed a small custom circumference regressor run with onnxruntime-web 1.31.1 (WebGPU EP, WASM fallback); the result is fused with manual measurements by inverse-variance weighting and written into an Anny-based (Apache-2.0, Naver Labs 2025) parametric body mesh rendered with three.js. Raw frames never leave the GPU/worker; only landmarks, masks, measurements and the ~80-float signature are persisted (IndexedDB) and only the signature syncs.

Why not SMPL-X: the MPI SMPL/SMPL-X licence is non-commercial and forbids training networks for commercial use; commercial sub-licensing is via Meshcapade (published tiers seen at EUR 5k/25k/50k per year Micro/SME/Enterprise, Enterprise R&D EUR 124,200/yr; other sources say negotiated) and Meshcapade was acquired by Epic Games (announced 18 Feb 2026), making future licensing uncertain. Open alternatives: Meta MHR (Apache-2.0, 45 shape params) and Naver Anny (Apache-2.0, 13,380 verts, interpretable phenotype params incl. height/weight/age/gender/muscle; 2.4 mm fit error on 3DBodyTex). No published project runs an HMR/SMPL regressor in-browser via ONNX Runtime Web; the usable HMR models (SAM 3D Body -> MHR, under the separate "SAM License"; Anny-Fit) are server-class and would violate the raw-photo rule.

Accuracy you can expect: with front+side silhouettes + height + weight on real tape-measured subjects, the best published regressors reach chest 1.9 cm / waist 1.6 cm / hip 1.1 cm MAE (BMnet on BodyM, 2,505 subjects) and ~3.2–4.4 cm on the smaller BODY-rgb set; height+weight alone (no image) gives ~3–4 cm; single-image SMPL-X regression in the wild (SHAPY/HBW) gives 5.7–6.9 cm; independently validated commercial 2-photo apps (MeThreeSixty, myBVI) show waist RMSE 3.6–6.5 cm, hip 4–5.8 cm; a 360-degree video scanner (Prism) 3.4 cm waist / 1.7 cm hip MAE. Plan for sigma_scan ~2.5–3.5 cm per girth in v1, improving to ~1.5–2 cm after calibrating on your own paired data. ~1 cm needs a hardware 3D scanner.

Commercial SDKs (3DLOOK, Bodygram, Size Stream) all upload photos (or at best silhouettes) to the vendor cloud; Presize was absorbed by Meta (2022); Zalando's tool is in-house (Fision) and not licensable; MySize uses phone sensors, not the camera; Fit Analytics is a questionnaire+purchase-data recommender. None gives you a privacy-preserving on-device scan, so build.

Skin tone: Face Landmarker + face-skin segmentation -> robust CIELAB sampling -> ITA = atan2(L*-50, b*) -> Monk Skin Tone (10 classes, CC-BY 4.0) using the published ITA thresholds (89–92% accuracy on clinical photos), plus hue angle/chroma/value/contrast for a rule-based 12-season estimate that must be labelled as an estimate.

## Recommendation

RECOMMENDED V1 PIPELINE (on-device, web/PWA first, portable to Capacitor/RN)

Packages (pin these; all verified on the npm registry on 2026-11-04):
- @mediapipe/tasks-vision 1.2.2 (Apache-2.0) — PoseLandmarker (pose_landmarker_full.task, lite fallback on low-end), ImageSegmenter with selfie_multiclass_256x256.tflite, FaceLandmarker (face_landmarker.task). Self-host the WASM + .task files (do not use @latest CDN in production; the docs' snippets are unpinned).
- onnxruntime-web 1.31.1 (MIT) — 'onnxruntime-web/webgpu' with WASM fallback, for the custom measurement regressor.
- three 0.187.0 (MIT) — Anny-derived body mesh with morph targets; also renders the 2D silhouette atlas for render path B.
- Existing: react 19, vite 6, tailwind 4, motion 12. Add idb/Dexie for IndexedDB. Drop @google/genai from the client bundle (keys server-side only).
- Body model: Anny (Apache-2.0; export base mesh + the phenotype/local blendshapes you need to glTF morph targets offline in Python; ship ~2–4 MB).
- Regressor: train a BMnet-style MNASNet/MobileNet on (front silhouette, side silhouette, height, weight) -> 14 girths/lengths using Amazon's BodyM (2,505 real subjects) + synthetic Anny renders; export ONNX fp16/int8 (~5–10 MB). Until trained, ship the analytic baseline below (ellipse) blended with a height/weight/sex population prior (Bartol-style linear regression on ANSUR gives ~3–4 cm alone).

Capture protocol (section 2.1B): 8 s video, user 2–3 m away, fitted clothing, phone upright (DeviceOrientation gate), neutral A-pose. In a Web Worker with OffscreenCanvas: run PoseLandmarker VIDEO mode every frame for gating (full body visible: nose, both ankles/heels, visibility > 0.8; height-pixel span stable; tilt < 5 deg; arms away from torso by elbow–hip distance), detect the 0/90/180/270-degree frames from shoulder-width/hip-width ratio and ear/nose visibility, then run the multiclass segmenter on those 4 frames (plus 2–3 neighbours for median filtering). Scale: user height (cm) / pixel distance from head-top of the mask to heel landmarks, corrected for camera tilt. Cross-section levels: place the 12 levels (neck, shoulder, chest/bust, underbust, waist, hip, thigh, knee, calf, ankle, upper arm, wrist) from landmark proportions (e.g., chest at 37.5% and waist at 62.5% of shoulder-to-high-hip, per Zong/Scott; knee/ankle/elbow/wrist directly from landmarks), then measure mask width per level in the front frame and depth in the side frame. Initial girth = Ramanujan ellipse perimeter from (width/2, depth/2); feed the width/depth/level vector + height + weight + clothing coverage (ratio of 'clothes' to 'body-skin' pixels at that level, from the segmenter) into the ONNX regressor for the corrected girth and a per-girth sigma head. Skin shading map: sample body-skin pixels per level for the mesh tint. Persist landmarks, masks (optional), measurements, sigmas and quality features in IndexedDB; never write video frames to storage.

Face step (2.1A): FaceLandmarker + segmenter: sample skin from both malar/cheek regions, forehead and nasal bridge (exclude eyes/brows/lips/beard via landmarks and the face-skin class), convert sRGB -> linear -> XYZ(D65) -> CIELAB, k-means (k=5) on Lab and take the dominant mid-lightness cluster to reject specular highlights and shadows, median per region, then ITA = atan2(L*-50, b*)*180/pi -> Monk class via the published thresholds; undertone from hue angle atan2(b*,a*) and b*/a*; value L*, chroma C*; hair colour from the hair class; iris from the iris landmarks; contrast = L* spread. Output the 12-season estimate with the score breakdown and a 'this is an estimate' label; ask the user to confirm the Monk swatch (handles white-balance error). Identity tile: face crop with the segmenter background removed.

Manual step and fusion (2.1C): keep the existing screen (height, weight, bust, waist, hip, foot EU) but add 'how did you measure' (tape today / from memory / guess) to set sigma_manual (1.5 / 2.5 / 4 cm). Fuse per measurement with inverse-variance weighting: m = (s/sig_s^2 + u/sig_u^2 + p/sig_p^2) / (1/sig_s^2 + 1/sig_u^2 + 1/sig_p^2), sigma_fused = (sum 1/sig^2)^-1/2, where s = scan, u = user, p = population prior from height/weight/sex (sigma ~3.5 cm). Agreement test: |s - u| <= 2*sqrt(sig_s^2 + sig_u^2) -> fuse; otherwise flag a conflict: show both values, ask the user to re-measure that one item with on-screen tape instructions (ISO 8559-1 definitions: bust at bust-point level, waist midway between lowest rib and iliac crest, hip at the fullest buttocks), and if the rescan/remeasure still disagrees keep the scan with sigma inflated by the disagreement. Confidence shown to the user = clamp(0.95 - 0.26*(sigma_fused - 1.66), 0.2, 0.98), which reproduces the handoff targets exactly with sigma_scan = 3 cm and sigma_tape = 2 cm: scan-only -> 60%, scan+manual agreeing -> 95%; calibrate this mapping once you have ~50–100 consented volunteers with tape ground truth (the pilot should measure test–retest as well).

Body mesh: solve Anny phenotype + a handful of local blendshapes by on-device least squares (Gauss-Newton on the mesh's own level girths and lengths vs the fused measurements) — this 'measurement tuning' is what clad.you reports closes the gap to <1 cm against the known measurements and avoids any neural HMR. Export the 2D silhouette atlas (4 views) from this mesh for render path B.

Expected v1 accuracy: chest/waist/hip MAE 2–4 cm scan-only in cooperative conditions (literature 1.1–1.9 cm best case on BodyM with the trained regressor; 3.2–4.4 cm on BODY-rgb; commercial 2-photo apps 3.6–6.5 cm RMSE), falling to ~1.5 cm after fusion with a tape-measured manual entry. Height from the user, not from the image (image height alone is 1–7 cm off). This is good enough for size recommendation (size steps are 4–6 cm at bust/hip) but mark renders as estimates.

RN/Capacitor path: MediaPipe Tasks ships native iOS/Android SDKs that load the same .task bundles, so the pipeline ports 1:1 behind a native plugin; community RN wrappers (react-native-mediapipe 0.6.0 from 2024, react-native-mediapipe-posedetection, pose-landmarker-react-native Android-only) are immature. Capacitor can simply run the web pipeline in the WebView (WebGPU is on by default in WebKit on iOS 26; verify in WKWebView and keep the WASM path). Skip ARKit body tracking; consider ARKit LiDAR depth later via a native plugin only to improve the side-view depth.

## Integration notes

FIT SIGNATURE (~80 floats, the only body data that syncs; schema v1 proposal)
[0–11] 12 fused girths in cm at the handoff's cross-sections: neck, shoulder (around), bust/chest, underbust, waist, hip, thigh, knee, calf, ankle, upper arm, wrist.
[12–23] sigma (cm) per girth (quantised 0.25 cm) — lets a shop compute P(fit) per size, not just a point estimate.
[24–35] width/depth aspect ratio per level (dimensionless) — distinguishes flat vs round torsos with equal girth (two bodies with the same girth differ in shape; wrap/sheath patterns care).
[36–47] 12 lengths in cm: stature, inseam, shoulder-to-waist (front), back-waist length, torso length shoulder->hip, arm length, bi-acromial shoulder breadth, bust-point height, waist height, hip height, knee height, foot length (EU shoe derived).
[48–55] 8 posture/shape descriptors: shoulder slope (deg), forward-lean (deg), pelvic tilt proxy, bust-to-waist ratio, waist-to-hip ratio, shoulder-to-hip ratio, waist-height ratio, limb-to-torso ratio.
[56–65] 10 low-dimensional shape coefficients: Anny phenotype values (height, weight, age, gender-prob, muscle, proportions) + 4 PCA coefficients of the residual silhouette atlas — used for store-side kNN on 'bodies like yours bought size M' and for the renderer's warp.
[66–71] weight kg, BMI, age bucket, sizing sex (2 one-hot), body-fat proxy (from girths).
[72–77] fit preferences in [-1,1]: ease preference at bust, waist, hip; length preference; stretch tolerance; snug/loose global.
[78–79] schema version, global capture-quality score (0–1).
Notes: no face/skin/hair values in the signature (keep colour data client-only; share only a coarse 'colour season' label if a shop needs it, by separate consent). Quantise girths to 0.5 cm and lengths to 1 cm. Under GDPR this vector is still personal (pseudonymous) data — the privacy ledger must list it as such; legal review later as the handoff says.

FIT ENGINE HOOK (section 4.1): gap_at_point uses the fused mean; replace the hard thresholds with P(gap in [0, ease_target+2]) under N(mean, sigma_fused^2) so low-confidence measurements produce softer scores and a 'measure your waist to be sure' nudge.

PRIVACY/ARCHITECTURE: all model files self-hosted on the VPS behind the same origin (no third-party CDN calls at scan time); frames stay in the worker; IndexedDB stores landmarks/masks/measurements only, optionally encrypted with a WebCrypto key held in the device; the only network calls during onboarding are model downloads and the final POST of the signature. If you ever add the optional SAM-3D-Body 'hero avatar' server path, it must be explicit opt-in, ephemeral (delete on completion) and under the SAM License terms; it is not needed for v1.

CAVEATS: MediaPipe's web docs still mark the solution 'Preview'; tasks-vision 1.x dropped non-SIMD WASM builds (Safari >= 16.4 is fine); the GPU delegate is WebGL, not WebGPU; world landmarks are hip-centred and uncalibrated — never derive girths from them. Clothing is the largest error source (loose garments inflate widths); the multiclass segmenter's clothes vs body-skin ratio is your quality gate and should lower confidence. BodyM licence terms for commercial model training must be checked on the AWS Open Data registry before training.

## Candidates

### MediaPipe Tasks Vision (Pose Landmarker + Image Segmenter + Face Landmarker + Holistic)

- **vendor**: Google AI Edge
- **kind**: open-source on-device library (web/iOS/Android)
- **inputs**: HTMLVideoElement/ImageBitmap frames; runningMode IMAGE or VIDEO; options numPoses, outputSegmentationMasks, min*Confidence
- **outputs**: Pose: 33 normalized landmarks (x,y,z,visibility,presence) + worldLandmarks in metres hip-centred + optional person mask. Face: 478 landmarks, 52 blendshapes, transformation matrix. ImageSegmenter multiclass selfie model: 0 background,1 hair,2 body-skin,3 face-skin,4 clothes,5 accessories (256x256). Holistic: pose+face+hands in one task.
- **apiAvailability**: npm @mediapipe/tasks-vision 1.2.2 (published 2026-11-03); WASM via jsDelivr; native iOS/Android Tasks SDKs use the same .task bundles. Docs still label the web solution a 'Preview'. v1.2.2 removed non-SIMD WASM builds (needs WASM-SIMD browsers; Safari 16.4+).
- **pricing**: Free
- **quality**: PCK@0.2 on fitness video sets: lite 90–93.5, full 95.5–96.3, heavy 96.4–97.5 (17 COCO keypoints, single person 2–4 m). World-landmark depth is coarse and uncalibrated; use it only for pose gating, not for metric girths.
- **latency**: BlazePose GHUM model card: lite 3 MB / full 6 MB / heavy 26 MB; ~20–53 ms per frame on device; GPU delegate uses WebGL (no WebGPU backend in release notes; only a 'subgroups-f16' WebGPU cleanup in v0.10.35). Run detect() in a Web Worker per the docs.
- **license**: Apache-2.0 (package and model cards)
- **privacy**: Fully on-device (WASM/WebGL). Nothing uploaded; model files fetched from CDN or self-hosted.
- **verdict**: USE (core of v1). Pose Landmarker full (lite fallback) for pose gating/levels, multiclass segmenter for silhouette + clothing/skin masks, Face Landmarker for skin-tone sampling and the identity tile.
- **sources**: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js · https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker · https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js · https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter · https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker/web_js · https://github.com/google-ai-edge/mediapipe/releases · https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf · https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md

### TensorFlow.js pose-detection (MoveNet / BlazePose)

- **vendor**: Google (tfjs-models)
- **kind**: open-source on-device library
- **inputs**: Image/video tensors
- **outputs**: MoveNet: 17 COCO 2D keypoints; BlazePose: 33 keypoints + 3D via the legacy @mediapipe/pose dependency
- **apiAvailability**: npm @tensorflow-models/pose-detection 2.1.3 — last published 2023-10-17; @tensorflow/tfjs 4.22.0 last published 2025-01-08 (npm registry). Effectively dormant.
- **pricing**: Free
- **quality**: MoveNet gives 2D only; BlazePose in tfjs is the same model MediaPipe Tasks ships, with a stale wrapper
- **latency**: MoveNet Lightning is fast, but no segmentation mask and no 3D
- **license**: Apache-2.0
- **privacy**: On-device
- **verdict**: SKIP. No releases in 2+ years; MediaPipe Tasks supersedes it with the same models plus segmentation.
- **sources**: https://www.npmjs.com/package/@tensorflow-models/pose-detection · https://www.npmjs.com/package/@tensorflow/tfjs · https://topflightapps.com/ideas/pose-estimation/

### ONNX Runtime Web (WebGPU EP)

- **vendor**: Microsoft
- **kind**: open-source in-browser inference runtime
- **inputs**: Any ONNX model (e.g. a custom silhouette->measurements regressor, or a future lightweight HMR)
- **outputs**: Tensors
- **apiAvailability**: npm onnxruntime-web 1.31.1 (published 2026-10-26). import * as ort from 'onnxruntime-web/webgpu'. WebGL backend in maintenance; WebGL and JSEP deprecated as of 1.29; WebGPU is the recommended GPU path, WASM (SIMD, multithread) fallback.
- **pricing**: Free
- **quality**: n/a (runtime)
- **latency**: WebGPU available by default on Safari/iOS 26 (Sept 2025), Chrome Android 121+ on Qualcomm/ARM GPUs, desktop Chrome/Edge; Firefox Android still pending. Always ship the WASM fallback.
- **license**: MIT
- **privacy**: On-device
- **verdict**: USE for the custom measurement regressor (and later for any small HMR/shape network). Not needed for MediaPipe tasks themselves.
- **sources**: https://www.npmjs.com/package/onnxruntime-web · https://onnxruntime.ai/docs/get-started/with-javascript/web.html · https://appdevelopermagazine.com/webgpu-in-ios-26/ · https://developer.chrome.com/blog/new-in-webgpu-121

### Transformers.js (ViTPose keypoint detection)

- **vendor**: Hugging Face / onnx-community
- **kind**: open-source in-browser model zoo
- **inputs**: RGB crop + person box
- **outputs**: 17 COCO 2D keypoints + heatmaps
- **apiAvailability**: npm @huggingface/transformers 4.3.2 (2026-10-30); pipeline('keypoint-detection', 'onnx-community/vitpose-base-simple')
- **pricing**: Free
- **quality**: Higher 2D keypoint accuracy than BlazePose on COCO, but no 3D, no mask
- **latency**: ViT-B backbone (~90M params) — heavier than BlazePose; WebGPU needed on phones
- **license**: Apache-2.0 (library); ViTPose weights Apache-2.0
- **privacy**: On-device
- **verdict**: OPTIONAL later: a second-opinion 2D keypoint model for the still frames if BlazePose landmark jitter limits level placement. Not for v1.
- **sources**: https://huggingface.co/onnx-community/vitpose-base-simple · https://www.npmjs.com/package/@huggingface/transformers

### SMPL / SMPL-X body model

- **vendor**: Max Planck Institute (commercial via Meshcapade, now Epic Games)
- **kind**: parametric body model (non-commercial licence)
- **inputs**: beta (10–300 shape), theta pose, expression
- **outputs**: 10,475-vertex (SMPL-X) mesh
- **apiAvailability**: Python (smplx), Meshcapade API/SDK; no sanctioned browser distribution
- **pricing**: Meshcapade published tiers seen in search captures: Micro EUR 5,000/yr, SME EUR 25,000/yr, Enterprise EUR 50,000/yr (EC size definitions, re-evaluated annually; perpetual option; 30-day trial). Their Notion licensing page lists Enterprise R&D at EUR 124,200/yr and 'contact sales' for commercial. Two 2026 sources say prices are negotiated. Avatar API ~EUR 1–5 per avatar (credit-based). Epic Games announced acquisition of Meshcapade on 18 Feb 2026 (MPG press release); future licensing unclear.
- **quality**: Industry standard; most HMR research outputs SMPL params
- **latency**: n/a
- **license**: MPI SMPL/SMPL-X Model Licence: academic research, education and non-commercial artistic work only; explicitly prohibits commercial use and prohibits training neural networks for commercial use. Commercial use requires a Meshcapade sub-licence. Blender add-on note: meshes generated with a valid licence are CC-BY 4.0, but the model files themselves need the licence.
- **privacy**: n/a (model), but Meshcapade's cloud avatar API would require uploading data
- **verdict**: AVOID for the product. The licence blocks shipping the model in a commercial app and blocks training on it; the commercial path is expensive and its future owner is Epic. Use Anny/MHR instead; keep an MHR->SMPL conversion path only if a partner ever requires SMPL.
- **sources**: https://smpl-x.is.tue.mpg.de/modellicense.html · https://smpl.is.tue.mpg.de/modellicense.html · https://github.com/Meshcapade/wiki/blob/main/wiki/SMPL.md · https://github.com/Meshcapade/SMPL_blender_addon/blob/main/LICENSE.md · https://meshcapade.notion.site/The-SMPL-Model-Licenses-2144560e54388085af5eff111fcdf266 · https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tubingen · https://clad.you/blog/posts/body-pipeline/

### Anny (Naver Labs Europe) + Anny-Fit

- **vendor**: NAVER LABS Europe
- **kind**: open parametric body model (all ages) + HMR method
- **inputs**: Phenotype parameters in [0,1] (gender, age, height, weight, muscle, proportions, ...) + local blendshapes in [-1,1] + facial actions + skeleton pose
- **outputs**: 13,380-vertex quad mesh with blendshapes; differentiable; scan-free (WHO-calibrated)
- **apiAvailability**: github.com/naver/anny (PyTorch, .ply export, Gradio demo); Anny-Fit (github.com/naver/anny-fit, May 2026, CVPR 2026 Findings) is a multi-person camera-space optimisation using metric depth + segmentation + 2D keypoints + VLM age/gender — server-class.
- **pricing**: Free
- **quality**: 2.4 mm mean point-to-mesh error on 3DBodyTex adults, 2.7 mm on children; Anny->SMPL-X regression 3.2 mm; HMR results comparable to SMPL-X (EHF PA-PVE 49.7 vs 66.9)
- **latency**: Forward blendshape evaluation is trivial on-device; Anny-Fit inference is server-only
- **license**: Anny code Apache-2.0; MakeHuman-derived assets CC0 1.0; SOMA-X topology Apache-2.0. A separate noncommercial.zip holds SMPL-X-related assets (LICENSE/NOTICE inside) that are NOT needed for the core model — verify before shipping.
- **privacy**: On-device feasible: export the base mesh + blendshapes to glTF morph targets and drive them in three.js from the fused measurements
- **verdict**: USE as the personalised body mesh for v1 (replaces SMPL-X in handoff section 6). Fit its semantic parameters/blendshapes to the fused 12 girths + lengths by on-device least squares (the 'measurement tuning' approach); no neural HMR needed.
- **sources**: https://github.com/naver/anny · https://arxiv.org/html/2511.03589v1 · https://europe.naverlabs.com/blog/anny-a-free-to-use-3d-human-parametric-model-for-all-ages/ · https://arxiv.org/pdf/2605.04728 · https://github.com/naver/anny-fit

### MHR (Momentum Human Rig) + SAM 3D Body

- **vendor**: Meta
- **kind**: open parametric body model + single-image mesh recovery
- **inputs**: SAM 3D Body: one RGB image (+ optional prompts); MHR: 45 identity shape params (only ~20 drive body morphology), pose, facial blendshapes
- **outputs**: MHR mesh (18,439 verts per clad.you; 7 LOD levels)
- **apiAvailability**: github.com/facebookresearch/MHR (PyTorch, TorchScript LOD1, FBX rig, a web-viewer folder, MHR<->SMPL conversion); SAM 3D Body on Hugging Face (facebook/sam-3d-body-dinov3), released 2025-11-19
- **pricing**: Free (self-hosted GPU ~USD 0.03–0.09 per run per clad.you)
- **quality**: ~55 mm MPJPE 3DPW / ~61 mm PVE RICH; the 'Anthropometric Fidelity' critique (arXiv 2601.06035) documents regression-to-the-mean, smoothing of clothing and atypical shapes; clad.you's early BWH MAE 5–8 cm from the photo path
- **latency**: Seconds on a server GPU; Fast SAM 3D Body (2026) targets real-time on GPU
- **license**: MHR: Apache-2.0 (code; release assets ship with their own LICENSE — check). SAM 3D Body weights: 'SAM License' (commercial use allowed royalty-free with use restrictions: military/weapons/espionage bans, pass-through licence, no reverse engineering, terms modifiable by Meta). Not Apache.
- **privacy**: SAM 3D Body is a DINOv3 ViT-scale model: server-only, so using it means uploading a photo — violates the raw-photo rule unless the user explicitly opts in
- **verdict**: DEFER. Good open body model, but the photo-to-mesh step is server-side and its accuracy for girths is no better than 2D silhouette regression. Possible opt-in 'hero avatar' path later (consent + ephemeral processing on your VPS).
- **sources**: https://github.com/facebookresearch/MHR · https://ai.meta.com/blog/sam-3d/ · https://huggingface.co/facebook/sam-3d-body-dinov3 · https://arxiv.org/html/2601.06035v1 · https://roboflow.com/model-licenses/segment-anything-3 · https://arxiv.org/pdf/2603.15603

### In-browser SMPL/HMR fitting (ONNX Runtime Web / WebGPU)

- **vendor**: n/a (research)
- **kind**: feasibility assessment
- **inputs**: n/a
- **outputs**: n/a
- **apiAvailability**: No published project found that runs an HMR/SMPL regressor in the browser with onnxruntime-web or transformers.js (search 2026-11). Visionary (Dec 2025) runs the SMPL-X forward model via ONNX on WebGPU but takes parameters as input. HMR 2.0 / SAM 3D Body / Multi-HMR use ViT-H-class backbones (hundreds of MB) — not mobile-browser material.
- **pricing**: n/a
- **quality**: Even server-side single-image SMPL-X regression (SHAPY) is 5.7–6.9 cm on girths — worse than 2D silhouette regression with height+weight
- **latency**: ViT-B HMR could plausibly be exported to ONNX and run on WebGPU phones in ~0.5–2 s per frame, but nobody has benchmarked it
- **license**: Depends on body model (see SMPL vs Anny/MHR)
- **privacy**: Would be on-device if it existed
- **verdict**: NOT FOR V1. Fit a parametric mesh (Anny) to measurements instead of regressing a mesh from pixels. Revisit when a <30 MB Apache/MIT HMR checkpoint exists.
- **sources**: https://arxiv.org/html/2512.08478v1 · https://openaccess.thecvf.com/content/CVPR2022/supplemental/Choutas_Accurate_3D_Body_CVPR_2022_supplemental.pdf · https://arxiv.org/pdf/2403.01345 · https://github.com/muelea/shapy

### Apple ARKit body tracking (ARBodyAnchor)

- **vendor**: Apple
- **kind**: native iOS API
- **inputs**: Rear camera (A12+), LiDAR optional
- **outputs**: 3D skeleton joints with hip-root transform + estimatedScaleFactor
- **apiAvailability**: Native only (ARBodyTrackingConfiguration); not exposed in Safari/WebXR. No Capacitor plugin found; React Native wrappers (react-native-arkit) don't cover body anchors — a custom native module is required.
- **pricing**: Free
- **quality**: No published cm-level validation; a developer reports 1.71 m estimated for a 1.83 m person; Vicon comparisons show range-of-motion limits; regressions in iOS 18.0/18.1 and a reported iOS 26.0/26.1 bug returning no valid joint transforms on LiDAR devices. It gives joints, not surface — no girths.
- **latency**: Real-time
- **license**: Apple SDK terms
- **privacy**: On-device
- **verdict**: SKIP for v1. Later, a native plugin could use ARKit sceneDepth (LiDAR) to give true metric depth for the side view; body-tracking joints themselves add little over MediaPipe.
- **sources**: https://developer.apple.com/documentation/arkit/arbodyanchor · https://developer.apple.com/forums/thread/725730 · https://developer.apple.com/forums/thread/766086 · https://developer.apple.com/forums/thread/804899 · https://ebooks.iospress.nl/pdf/doi/10.3233/SHTI210092

### 3DLOOK (Mobile Tailor / SAIA / YourFit)

- **vendor**: 3DLOOK Inc.
- **kind**: commercial cloud body-scan API/SDK
- **inputs**: 2 photos (front, side) + height, gender, optional device IMU
- **outputs**: 70+ measurements, 3D model
- **apiAvailability**: npm @3dlook/saia-sdk 2.19.0 (2026-09); REST: create person with base64 front+side photos, gender, height -> async task queue
- **pricing**: Reported: Mobile Tailor Basic USD 499/mo (100 scans), Premium USD 999/mo, Enterprise custom; older tiers USD 99/499; ~USD 2–5 per scan quoted by a 2026 blog. No published per-scan rate.
- **quality**: Vendor claims 96–97% accuracy and 1.0–1.5 cm typical; no third-party clinical validation; an independent MeThreeSixty-vs-3DLOOK study found hip/waist differences exceeding ANSUR allowable error
- **latency**: Seconds (cloud)
- **license**: Proprietary
- **privacy**: Server-side processing (photos uploaded as base64; cloud-hosted). Not on-device.
- **verdict**: REJECT: incompatible with the never-upload rule.
- **sources**: https://npmjs.com/package/@3dlook/saia-sdk · https://3dlook.ai/ · https://3dlook.ai/content-hub/body-scanning-technology-comparison/ · https://www.aistacks.app/apps/3dlook · https://www.researchgate.net/publication/364718124_Comparison_of_3D_Body_Scanning_Mobile_Applications_A_Study_of_MeThreeSixty_and_3D_Look_Mobile_Apps_Body_Measurements

### Bodygram (Body2Fit headless/web SDK)

- **vendor**: Bodygram Inc. (Tokyo)
- **kind**: commercial cloud body-measurement SDK + size recommendation
- **inputs**: 2 photos + height/weight/age/gender (or stats only)
- **outputs**: Bust/waist/hip/inseam etc. (mm), avatar, size fit
- **apiAvailability**: JavaScript web SDK (sdk.js / Body2FitSDK); photo-based estimation takes front+side base64 images + age, gender, height, weight; stats-only fallback (no photos); returns measurements (ISO 8559 definitions), GLB avatar, size recommendation per SKU
- **pricing**: Not published; 2022 Japanese clinic press release: from JPY 500 per measurement or JPY 800 per user per month unlimited
- **quality**: Vendor: 'accurate, consistent, ISO 8559'; no independent validation found
- **latency**: Cloud, seconds
- **license**: Proprietary
- **privacy**: Photos sent as base64 to Bodygram's service; no on-device statement anywhere in docs or privacy policy
- **verdict**: REJECT for scanning (cloud). Its stats-only estimator confirms the pattern worth copying: height/weight/age/gender -> prior measurements on-device.
- **sources**: https://developers.bodygram.com/body2fit/headless-sdk/sdk-reference/ · https://docs.bodygram.com/ · https://docs.bodygram.com/platform/measurement-definitions · https://www.bodygram.com/en/press/dioclinic · https://www.bodygram.com/en/policies/bodygram-platform-privacy-policy

### Size Stream (MeThreeSixty / Formcut APIs)

- **vendor**: Size Stream LLC
- **kind**: commercial app + SDK/API (contact sales)
- **inputs**: Front + side silhouettes from phone camera + user inputs
- **outputs**: 240+ measurements, 3D avatar
- **apiAvailability**: SDKs/APIs on request; consumer app free with Premium USD 4.99/mo
- **pricing**: SDK pricing unpublished
- **quality**: Claims <3% MAE. Independent: Smith 2021 waist RMSE 3.59 cm, hip 3.97 cm; 2023 study n=115: waist MD -2.3 cm, RMSE 6.5 cm, LOA +/-11.9; hip MD +3.1 cm, RMSE 4.7 cm
- **latency**: Cloud
- **license**: Proprietary
- **privacy**: FAQ: images converted to silhouettes on-device, 'never uploaded'; silhouettes/avatars processed by Size Stream (SOC 2, GDPR). Closest to privacy-preserving among vendors but still cloud.
- **verdict**: REJECT as a dependency, but its numbers are the realistic benchmark for a 2-silhouette approach.
- **sources**: https://www.sizestream.com/faqs/ · https://pmc.ncbi.nlm.nih.gov/articles/PMC10442791/ · https://proc.3dbody.tech/abstracts/2021/2133smith.html · https://onlinelibrary.wiley.com/doi/10.1002/oby.23434

### Presize (Munich) / Zalando Body Measurement (Fision)

- **vendor**: Meta (Presize) / Zalando
- **kind**: not available
- **inputs**: 2 photos or video
- **outputs**: Measurements -> size advice, 3D fitting room
- **apiAvailability**: Presize was acquired 100% by Meta in 2022 and is no longer sold. Zalando's tool (2 photos or video, DACH launch July 2023, >1.5M users by June 2026) is built in-house on Fision (acquired 2020); a 2022 Zalando design post says the calculation runs on the device and only depersonalised data goes to the cloud, photos deleted after prediction.
- **pricing**: n/a
- **quality**: No published accuracy
- **latency**: n/a
- **license**: n/a
- **privacy**: On-device per Zalando (unverified technically)
- **verdict**: NOT LICENSABLE. Zalando is the existence proof that an on-device 2-photo pipeline at scale is viable for sizing.
- **sources**: https://www.munich-startup.de/en/news/presize-acquisition-by-facebook-now-official · https://fashionunited.uk/news/fashion/meta-acquires-presize-betting-on-virtual-sizing-technology/2022042662770 · https://corporate.zalando.com/en/technology/how-zalando-uses-technology-help-customers-find-right-size · https://medium.com/zalando-design/using-machine-learning-to-make-shopping-fashion-online-more-human-and-body-centered-e1f2c3a4ec9f · https://corporate.zalando.com/en/node/10477

### MySize (MySizeID)

- **vendor**: My Size Inc.
- **kind**: commercial size recommender (sensor-based, no camera)
- **inputs**: Phone motion sensors swept over the body, or size-chart matching
- **outputs**: Size recommendation
- **apiAvailability**: Shopify app USD 49–199/mo (free tier); SDK announced 2021
- **pricing**: USD 0–199/mo
- **quality**: No independent accuracy data
- **latency**: n/a
- **license**: Proprietary
- **privacy**: No images
- **verdict**: SKIP (not a body scan; competitor reference only).
- **sources**: https://www.nasdaq.com/press-release/mysize-launches-sdk-solution-targeting-e-commerce-market-with-fully-customizable · https://www.appstoreanalytics.io/shopify-app-store-listings/mysize

### Fit Analytics (Fit Finder)

- **vendor**: Fit Analytics Innovation GmbH (bought its IP back from Snap)
- **kind**: commercial questionnaire + purchase/return-data size recommender
- **inputs**: Shopper height/weight/age/fit preference + retailer garment data + returns
- **outputs**: Recommended size; claims +4–6% conversion, -2–4% returns
- **apiAvailability**: JS widget, quote-only pricing, 250+ partners, 49 languages
- **pricing**: Quote only
- **quality**: n/a
- **latency**: n/a
- **license**: Proprietary
- **privacy**: No images
- **verdict**: SKIP as a dependency; useful as the benchmark for your fit engine (section 4) and the merchant pricing model.
- **sources**: https://fitanalytics.com/fit-finder · https://www.yahoo.com/lifestyle/fit-analytics-reacquires-ip-snap-145138494.html · https://www.size.ly/blog/size-recommendation-apps-compared

### Skin-tone pipeline: Face Landmarker + CIELAB/ITA + Monk Skin Tone scale

- **vendor**: Google (MediaPipe, MST), Ellis Monk, published methods
- **kind**: client-side algorithm (build)
- **inputs**: One front-lit selfie
- **outputs**: Mean/median CIELAB of skin, ITA, MST class 1–10, undertone (hue angle), value (L*), chroma (C*), contrast (L* spread skin/hair/iris), hair colour, eye colour
- **apiAvailability**: All in-browser: Face Landmarker (478 pts) for region masks, multiclass selfie segmenter class 3 (face-skin) and 1 (hair), Canvas for pixels
- **pricing**: Free
- **quality**: ITA->Monk mapping with thresholds (MST1 > 81.62; 2: 75.99–81.62; 3: 68.24–75.99; 4: 57.53–68.24; 5: 30.61–57.53; 6: -4.63–30.61; 7: -37.77–-4.63; 8: -66.87–-37.77; 9: -81.33–-66.87; 10 < -81.33) reached 89–92% accuracy (10% margin) on clinical photos; Fitzpatrick mapping was unusable (0.5–20%). Lighting/white balance is the dominant error: CIELAB k-means skin clustering beats naive averaging but the light/albedo ambiguity remains.
- **latency**: <100 ms
- **license**: MediaPipe Apache-2.0; MST scale CC-BY 4.0; ITA formulas public domain
- **privacy**: On-device
- **verdict**: USE. Compute ITA with atan2 (b* can be negative), classify to Monk, and show the swatch for user confirmation (a 1-tap correction is the cheapest 'white balance').
- **sources**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12179258/ · https://en.wikipedia.org/wiki/Monk_Skin_Tone_Scale · https://research.google/blog/consensus-and-subjectivity-of-skin-tone-annotation-for-ml-fairness/ · https://arxiv.org/pdf/2604.02055 · https://skinoptics.readthedocs.io/en/latest/07_colors.html · https://arxiv.org/pdf/2604.02055

### Seasonal colour analysis (12-season) heuristics

- **vendor**: Open-source references (tkamali2020, zubair0153715) + colour-science write-ups
- **kind**: client-side rule-based algorithm (port to TS)
- **inputs**: Skin CIELAB, hair CIELAB, iris CIELAB
- **outputs**: Undertone warm/cool/neutral (hue angle h = atan2(b*,a*), b*/a* ratio, ITA), value light/deep (L*), chroma clear/soft (C* = sqrt(a*^2+b*^2)), contrast (L* spread) -> weighted score over 12 seasons
- **apiAvailability**: No JS library; port the rules
- **pricing**: Free
- **quality**: No benchmark exists; authors state scores are heuristic, not calibrated probabilities. Treat as a styling estimate and label it.
- **latency**: Negligible
- **license**: tkamali2020/Seasonal-Color-Analysis Apache-2.0; zubair0153715/seasonal-color MIT (both Python)
- **privacy**: On-device
- **verdict**: USE as a labelled estimate feeding the Style DNA / colour-matching feature; let users override.
- **sources**: https://github.com/tkamali2020/Seasonal-Color-Analysis · https://github.com/zubair0153715/seasonal-color · https://dev.to/john_rapvideo_6c6c6849058/seasonal-color-analysis-as-a-color-science-problem-undertone-value-chroma-contrast-2nlh

### Accuracy evidence: circumference from 2D silhouettes/keypoints + height (papers)

- **vendor**: Academic benchmarks
- **kind**: evidence base for expected error
- **inputs**: Front (+side) silhouette, height, weight
- **outputs**: Girths in mm
- **apiAvailability**: BodyM: 8,978 front+side silhouettes of 2,505 real subjects with height, weight and 14 tape measurements
- **pricing**: n/a
- **quality**: MAE on real tape-measured bodies: BMnet (silhouettes+height+weight, BodyM TestA): chest 18.8 mm, waist 15.8 mm, hip 11.3 mm, thigh 11.2, bicep 6.4, overall 9.2 mm; with only ~10% training data: chest 23, waist 21, hip 18 mm; single-view no height/weight: chest 34, waist 32, hip 31 mm; SMPL-based HMR baselines on the same data: SPIN chest 74/waist 77/hip 65 mm, STRAPS 82/108/64, Sengupta 53/53/47. Yan et al. BODY-rgb (194 subjects, 5-fold): chest 36/32 mm (M/F), waist 35/43, pelvis 36/36, thigh 43/44; synthetic BODY-fit chest 23/22, waist 17/17, pelvis 13/15. Height+weight-only regression (Bartol, ANSUR): chest 29, waist 38, hip 22 mm. SHAPY single RGB in the wild (HBW): chest 65, waist 69, hip 57 mm. Zong 2023 MediaPipe front+side + height pilot: girths within ~5%, widths underestimated 3–15%. Smartphone 360-degree video scan (Prism, n=44): waist MAE 3.4 cm, hip 1.7 cm. 2025 review: in-the-wild height ~6–7 cm MAE; clothing, pose and unknown camera intrinsics are the main error drivers.
- **latency**: BMnet is an MNASNet-1.0 on 640x480 silhouettes — exportable to ONNX, ~10 MB fp16, phone-class
- **license**: BodyM dataset on AWS Open Data (check its terms before commercial training); BODY-fit/BODY-rgb (Tampere) research use
- **privacy**: n/a
- **verdict**: Plan v1 sigma per girth = 3 cm (chest 3.0, waist 3.0, hip 2.5, thigh 3.5, arm 2.0, wrist/ankle 1.0, lengths 1.5–2.5 cm, height 1.0 cm if user-entered). After training the regressor on BodyM + your own paired pilot data, expect ~1.5–2.5 cm.
- **sources**: https://arxiv.org/pdf/2210.05667 · https://github.com/awslabs/open-data-registry/blob/main/datasets/bodym.yaml · https://webpages.tuni.fi/vision/public_data/publications/icpr2020_silhouette.pdf · https://pmc.ncbi.nlm.nih.gov/articles/PMC12193998/ · https://arxiv.org/pdf/2206.07036 · https://proc.3dbody.tech/papers/2023/2333zong.pdf · https://pmc.ncbi.nlm.nih.gov/articles/PMC11606355/ · https://arxiv.org/html/2608.12827v1

### Self-report bias evidence (for manual-measurement sigma)

- **vendor**: Epidemiology literature
- **kind**: evidence base
- **inputs**: n/a
- **outputs**: n/a
- **apiAvailability**: n/a
- **pricing**: n/a
- **quality**: Danish cohort n=39,514: self-reported height +1.07 cm, weight -0.32 kg, waist -0.2 cm vs measured, very high correlation; Dutch overweight employees: weight -1.4 kg, height +0.7 cm, waist +1.1 cm; meta-analysis of women: weight -0.94 kg, height +0.36 cm; bias grows with body size (EPIC-Norfolk).
- **latency**: n/a
- **license**: n/a
- **privacy**: n/a
- **verdict**: Use: sigma_manual height 1.0 cm, weight 1.0 kg, self-taped girths 2.0 cm, 'guessed' girths 4.0 cm, plus a +0.5–1.0 cm bias prior toward under-reporting waist for larger bodies.
- **sources**: https://www.medrxiv.org/content/10.1101/2022.12.20.22283553.full.pdf · https://pubmed.ncbi.nlm.nih.gov/18957077 · https://discovery.ucl.ac.uk/id/eprint/10056403/

## Open questions

- BodyM dataset (AWS Open Data) licence: does it permit training a commercial on-device regressor? If not, synthetic Anny renders + your own consented pilot data must carry the training.
- Anny repo's noncommercial.zip: confirm it only contains SMPL-X conversion assets so the shipped Anny mesh/blendshapes are purely Apache-2.0/CC0.
- Meshcapade/Epic: if any partner demands SMPL compatibility, is a post-acquisition commercial licence still obtainable and at what price? (Published tiers EUR 5k/25k/50k per year conflict with 'negotiated' reports.)
- Capacitor on iOS: confirm WebGPU and WASM-SIMD availability inside WKWebView on iOS 26 and the memory ceiling for the worker (pose full + segmenter + ORT session) on 3–4 GB phones.
- Pilot calibration: recruit 50–100 consented volunteers with tape measurements (and ideally one hardware scanner session) to fit the per-girth sigma model and the confidence mapping; measure test–retest across lighting/clothing.
- White balance for skin tone: decide between (a) user-confirmed Monk swatch, (b) a known white reference (A4 sheet, which could double as scale calibration), or (c) MediaStreamTrack white-balance constraints where supported; the Monk/ITA thresholds were validated on clinical photos, not selfies.
- Whether silhouettes (binary masks) count as 'raw photos' in the founder's privacy posture — recommendation is to keep them on-device too, which rules out any server-side refinement path.
- Depth for the side view: evaluate later whether an ARKit LiDAR (native plugin) or a monocular metric-depth model (Depth Anything v2 small, ONNX) improves hip/thigh girths enough to justify the extra 25–100 MB download.
- Fit-signature governance: who owns the schema versioning, and how are shops prevented from re-identifying users from 80 floats (rate limits, no per-user history exposure, coarse quantisation)?

## Fact-check corrections

**Overall trust:** Medium-high on architecture, medium on specific figures. The core technical and licensing claims hold: @mediapipe/tasks-vision 1.2.2 (Apache-2.0, 2026-11-03, non-SIMD WASM removed), onnxruntime-web 1.31.1 (MIT, WebGL/JSEP deprecated in 1.29), three 0.187.0, saia-sdk 2.19.0, SMPL/SMPL-X non-commercial licence incl. the 'no training for commercial use' clause, Epic-Meshcapade acquisition (18 Feb 2026), Anny code Apache-2.0 with a non-commercial smplx-topology zip, MHR Apache-2.0 with 45 identity params and 18,439 verts, SAM 3D Body under the 'SAM License' (Nov 19 2025), multiclass selfie segmenter class indices, Holistic Landmarker web, MST ITA thresholds and 89-92%/0.5-20% accuracies on clinical 3D-TBP images, BMnet numbers (18.8/15.8/11.3 mm, 9.2 mm overall, reduced-data and HMR baselines), BODY-rgb and BODY-fit numbers, SHAPY HBW 65/69/57 mm, Bartol 29/38/22 mm, PMC10442791 ME360/myBVI figures, Prism MAEs, BlazePose PCK@0.2 table, Zalando >1.5M users (~June 2026), Presize->Meta (2022), Fit Analytics buy-back, Bodygram JPY 500, MeThreeSixty $4.99/mo, Firefox Android WebGPU still pending, ARKit iOS 18/26 regressions, Danish self-report cohort. What is wrong or stale: every Anny accuracy/vertex statistic, the Bartol citation (points at ShapeBoost), the clad.you '<1 cm' claim (a goal, not a result), the Meshcapade licensing/API status (platforms shut down; MI now licenses SMPL), the unverifiable EUR 124,200 figure, three npm dates, and the BodyM licence (registry names CC BY-NC 4.0, which undermines the 'train on BodyM' plan). The Size Stream REJECT is weaker than stated because the vendor claims on-device processing. Net: the recommendation (MediaPipe + custom regressor + Anny mesh, skip SMPL-X/cloud SDKs) survives, but the training-data plan and the mesh-accuracy expectations need revision, and the SMPL fallback path must be re-routed to Max Planck Innovation.

- **Claim:** Anny: 13,380-vertex mesh; 2.4 mm mean point-to-mesh error on 3DBodyTex adults, 2.7 mm on children; Anny->SMPL-X regression 3.2 mm; HMR results 'EHF PA-PVE 49.7 vs 66.9'.
  - **Problem:** Numbers do not match the paper. Anny's default mesh has 13,718 vertices (13,710 quads). Adult 3DBodyTex error is 2.5 mm (head/hands excluded; SMPL-X with 300 components reaches 1.9 mm on the same scans). There is no 3DBodyTex child result: the 'children' figure is 2.0 mm (Anny) vs 3.2 mm (SMPL-X) on only three RenderPeople scans, which the authors say 'should not be interpreted as a comprehensive benchmark'. The 1.3 mm figure is a cyclic-consistency error of the SMPL-X<->Anny mapping, not 3.2 mm. The EHF 49.7 vs 66.9 PA-PVE is the HMR2.0 row only; with Multi-HMR it is 52.6 vs 52.9 (parity).
  - **Correction:** Use: 13,718 vertices; 2.5 mm adults (3DBodyTex, 400 scans); children 2.0 vs 3.2 mm on 3 RenderPeople scans; SMPL-X<->Anny mapping 1.3 mm cyclic error; EHF PA-PVE HMR2.0 49.7 vs 66.9, Multi-HMR 52.6 vs 52.9.
  - Source: https://arxiv.org/pdf/2511.03589 (Sec. 'Base model', Sec. 6 'Adults'/'Children', Table 1)
- **Claim:** SMPL commercial sub-licensing is via Meshcapade; Meshcapade Avatar API ~EUR 1-5 per avatar (credit-based); 'Meshcapade API/SDK' as the API availability for SMPL-X.
  - **Problem:** Stale. Meshcapade's own homepage now states 'Meshcapade is now part of Epic Games. As of April 18th, the Meshcapade online platforms have been shut down.' The Max Planck press release (18 Feb 2026) says 'MI [Max Planck Innovation] will now directly take over the licensing of the SMPL technology' and the SMPL-X licence page lists smpl@max-planck-innovation.de for commercial use.
  - **Correction:** Meshcapade's avatar API/platform is gone; commercial SMPL/SMPL-X licensing is now handled by Max Planck Innovation (smpl@max-planck-innovation.de). Any per-avatar credit pricing is obsolete. The EUR 5k/25k/50k tiers were on a Meshcapade (ganymede) page and may no longer apply; re-quote via MI.
  - Source: https://meshcapade.com/ ; https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tubingen ; https://smpl-x.is.tue.mpg.de/modellicense.html
- **Claim:** Meshcapade's Notion licensing page lists Enterprise R&D at EUR 124,200/yr.
  - **Problem:** Could not be verified: the Notion page renders no content, and no other source on the web mentions a 124,200 figure in connection with SMPL/Meshcapade.
  - **Correction:** Treat the EUR 124,200 figure as unverified; do not budget on it. Ask Max Planck Innovation for current terms.
  - Source: https://meshcapade.notion.site/The-SMPL-Model-Licenses-2144560e54388085af5eff111fcdf266 (empty render); web search for "124,200" Meshcapade returns nothing
- **Claim:** 'Measurement tuning' is what clad.you reports closes the gap to <1 cm against the known measurements.
  - **Problem:** The clad.you post states <1 cm as a goal ('the aim is to tune a body to less than 1 cm'), not a demonstrated result. The only reported accuracy is a pre-tuning BWH MAE of roughly 5-8 cm on 'a couple of real people', explicitly 'not a large dataset, not final numbers'.
  - **Correction:** Rephrase as: clad.you proposes least-squares measurement tuning and targets <1 cm; no measured result is published. Do not cite it as evidence that fitting Anny to girths yields <1 cm.
  - Source: https://clad.you/blog/posts/body-pipeline/ (published 2026-03-27, updated 2026-04-01)
- **Claim:** BodyM (AWS Open Data) - 'check its terms before commercial training'; recommendation to train the production regressor on Amazon's BodyM.
  - **Problem:** The registry YAML's License field reads 'Creative Commons Attribution-Non Commercial 4.0 International Public License' (the hyperlink points to the CC BY 4.0 legalcode, so the entry is self-contradictory). The stated licence name is NonCommercial, which would prohibit training a commercial on-device regressor on it.
  - **Correction:** Assume BodyM is CC BY-NC 4.0 unless Amazon confirms otherwise in writing; plan v1 training on synthetic Anny renders + your own consented pilot data, and use BodyM only for evaluation/research until clarified.
  - Source: https://raw.githubusercontent.com/awslabs/open-data-registry/main/datasets/bodym.yaml (line 'License: Creative Commons Attribution-Non Commercial 4.0 ...')
- **Claim:** Height+weight-only regression (Bartol, ANSUR): chest 29, waist 38, hip 22 mm — cited to https://arxiv.org/pdf/2403.01345.
  - **Problem:** Wrong citation. arXiv 2403.01345 is 'ShapeBoost' (Bian, Li, Tang, Lu), which contains no ANSUR height/weight regression. The numbers are from Bartol et al., 'Linear Regression vs. Deep Learning: A Simple Yet Effective Baseline for Human Body Measurement', Sensors 2022, 22(5):1885 (Table 6, 'Baseline (I=2)': chest 29.1, waist 37.9, hip 21.6 mm; sex-specific models with height, weight and interaction terms).
  - **Correction:** Cite Bartol et al. Sensors 2022 / PMC8914647 for the 29.1/37.9/21.6 mm figures. Note the model is sex-specific with interaction terms (female chest 34.0, waist 39.4, hip 22.3 mm). ShapeBoost is a separate single-image method (HBW test: chest 63, waist 58, hip 47 mm) that beats SHAPY and should be cited as such.
  - Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8914647/ ; https://arxiv.org/html/2403.01345 (Table 2)
- **Claim:** @tensorflow-models/pose-detection 2.1.3 last published 2023-10-17; @tensorflow/tfjs 4.22.0 last published 2025-01-08; @huggingface/transformers 4.3.2 published 2026-10-30.
  - **Problem:** npm registry 'time' data: pose-detection 2.1.3 was published 2023-08-29; tfjs 4.22.0 on 2024-10-21 (2025-01-08 is the 4.23.0-rc.0 prerelease); @huggingface/transformers 4.3.2 on 2026-10-27 (2026-10-30 is 4.4.0-next.0).
  - **Correction:** pose-detection 2.1.3: 2023-08-29; tfjs 4.22.0: 2024-10-21 (4.23.0-rc.0 2025-01-08); transformers 4.3.2: 2026-10-27. The 'dormant' conclusion still stands. (Verified as correct: tasks-vision 1.2.2 2026-11-03, onnxruntime-web 1.31.1 2026-10-26, three 0.187.0 2026-10-30, @3dlook/saia-sdk 2.19.0 2026-09-03, react-native-mediapipe 0.6.0 2024-12-12.)
  - Source: npm view <pkg> time --json against registry.npmjs.org
- **Claim:** Size Stream: 'silhouettes/avatars processed by Size Stream ... still cloud' -> REJECT as a dependency.
  - **Problem:** Not established. The sizestream.com FAQ says images are converted to a silhouette on-device and never uploaded, but does not say silhouettes are uploaded. The 'Size Stream Mobile Fit' App Store listing states 'All scans are processed directly on the user's device' and 'no photos are ever uploaded to the Cloud', with only results sent to a data portal. The API/SDK page says the API runs 'cloud or on-premise' and does not describe what the SDK uploads.
  - **Correction:** Downgrade from REJECT to 'ask the vendor': Size Stream's own materials claim full on-device scan processing in its mobile SDK; a direct technical/legal check (what leaves the device, whether on-prem API can run on the founder's VPS) is warranted before dismissing it.
  - Source: https://apps.apple.com/us/app/-/id1585425901 ; https://www.sizestream.com/faqs/ ; https://www.sizestream.com/technology/api-sdk/
- **Claim:** Independent: Smith 2021 waist RMSE 3.59 cm, hip 3.97 cm (MeThreeSixty).
  - **Problem:** The 3DBODY.TECH 2021 abstract reports n=10 subjects and only a pooled range for all circumferences (absolute error 0.79-1.96 cm, RMSE 1.32-3.97 cm); the specific waist/hip values are not in the abstract and the sample is too small to serve as a benchmark.
  - **Correction:** Cite as 'n=10, RMSE 1.3-4.0 cm across waist/hip/thigh/arm'; rely on the n=115 PMC10442791 study (waist RMSE 6.5 cm, hip 4.7 cm for ME360 on iPhone) as the benchmark.
  - Source: https://proc.3dbody.tech/abstracts/2021/2133smith.html ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10442791/
- **Claim:** A 360-degree video scanner (Prism) gives 3.4 cm waist / 1.7 cm hip MAE (n=44).
  - **Problem:** The Prism Labs app in that study captures 150 serial still images over ~10 s while the participant self-rotates (iPhone 14 Pro on a tripod at ~1.7 m) and reconstructs a 3D avatar; RMSE was 4.3-4.4 cm waist and 2.2 cm hip. MAE values are correct but the modality is mischaracterised.
  - **Correction:** Describe it as a multi-image photogrammetric 3D scan (150 frames, cloud-processed), waist MAE 3.4 cm / RMSE 4.3 cm, hip MAE 1.7 cm / RMSE 2.2 cm, n=44.
  - Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11606355/
- **Claim:** Zong 2023 MediaPipe front+side + height 'pilot': girths within ~5%, widths underestimated 3-15%.
  - **Problem:** The study has exactly two subjects (one male, one female), each scanned twice. Widths were underestimated 3-8% (male) and 5-15% (female); girths were within -4% to +5% except shoulder girth (9% female). Calling it a pilot without n=2 overstates its weight.
  - **Correction:** Cite as an n=2 feasibility demo, not evidence of accuracy.
  - Source: https://proc.3dbody.tech/papers/2023/2333zong.pdf (Sec. 3, Table 1)
- **Claim:** BlazePose GHUM: ~20-53 ms per frame on device; 'no WebGPU backend in release notes; only a subgroups-f16 WebGPU cleanup in v0.10.35'.
  - **Problem:** The model card gives Pixel 3 throughput of lite ~44 FPS CPU / 49 FPS GPU, full ~18 FPS CPU / 40 FPS GPU, heavy ~4 FPS CPU / 19 FPS GPU, i.e. heavy on CPU is ~250 ms, outside the stated range. The release notes do contain WebGPU work beyond subgroups-f16 (v0.10.32: 'ImageToTensorConverterWebGpu', 'RenderToWebGpuCanvas' fixes; v0.10.26: ShaderSourceWGSL), although the official web setup docs still only expose delegate CPU|GPU and no doc names WebGPU for vision tasks.
  - **Correction:** Latency: ~20-55 ms for lite/full (GPU) up to ~250 ms for heavy on CPU (Pixel 3 figures). State that WebGPU appears in MediaPipe web release notes but is undocumented for vision tasks; benchmark delegate GPU on target phones rather than asserting WebGL-only.
  - Source: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf ; https://github.com/google-ai-edge/mediapipe/releases ; https://developers.google.com/edge/mediapipe/solutions/setup_web
- **Claim:** 3DLOOK pricing: 'Reported: Mobile Tailor Basic USD 499/mo (100 scans), Premium USD 999/mo, Enterprise custom; older tiers USD 99/499'.
  - **Problem:** Mostly right but incomplete: the live 3dlook.ai/pricing page lists Basic $499 (100 scans) and Premium $999 (500 scans) WITHOUT API/SDK access; API and web/mobile SDK start at Enterprise (custom, 500+) or the second plan group Starter $1,000/mo (500 scans) and Pro $1,500/mo (1,000 scans). Trials are 7 days.
  - **Correction:** Note that programmatic (API/SDK) access to 3DLOOK starts at ~$1,000/month; the $499/$999 tiers are widget/portal-only. (Irrelevant to the privacy verdict, which stands.)
  - Source: https://3dlook.ai/pricing/
- **Claim:** MySize Shopify app USD 49-199/mo (free tier).
  - **Problem:** No official MySizeID Shopify App Store listing with those prices could be found; the only source is a third-party aggregator (appstoreanalytics.io). Search results surface unrelated apps (MyBranz 'shopsize') and a 3-year-old Webkul add-on at $10/mo.
  - **Correction:** Mark the $49-199 figure as unverified/aggregator-sourced; it is a competitor note only, so low impact.
  - Source: Web search for MySizeID Shopify pricing (no official listing found)

### Candidates the report missed

- LiteRT.js (@litertjs/core, Google) — official WebGPU/WASM(XNNPACK)/WebNN browser runtime for .tflite models, positioned as the TensorFlow.js successor; natural runtime if the BMnet-style regressor is trained in TF/Keras, and litert-community already publishes RTMW whole-body pose models for it. https://developers.google.com/edge/litert/web ; https://huggingface.co/litert-community/RTMW-m-WholeBody-LiteRT
- Apple Vision VNDetectHumanBodyPose3DRequest (iOS 17+) — on-device 17-joint 3D body pose on plain images/video without an ARKit session, with bodyHeight that is 'measured' when depth metadata is present (otherwise a 1.8 m reference). Sidesteps the ARKit ARBodyAnchor iOS 26 regression the report cites; relevant to the Capacitor/native side-view depth question. https://developer.apple.com/documentation/vision/vndetecthumanbodypose3drequest ; https://developer.apple.com/videos/play/wwdc2023/111241/
- Google ML Kit Pose Detection (iOS/Android, 'pose-detection' / 'pose-detection-accurate', beta) — the native BlazePose 33-landmark path for a React Native/Capacitor build, maintained by Google rather than the immature community RN wrappers. https://developers.google.com/ml-kit/vision/pose-detection
- RTMPose / RTMW / RTMO (OpenMMLab mmpose, Apache-2.0; rtmlib ONNX exports) — higher-accuracy 2D (and 133-keypoint whole-body) keypoint models runnable with onnxruntime-web; a stronger 'second opinion' than ViTPose-B for level placement, with the caveat to check training-dataset terms (COCO/AI Challenger/Cocktail14). https://github.com/Tau-J/rtmlib ; https://huggingface.co/michele-xilo/rtmpose-rs
- Size Stream 'Mobile Fit' SDK — vendor states all scan processing happens on-device with no photos uploaded (results only to a portal) and an on-premise API option; deserves a direct technical/legal inquiry rather than a blanket reject. https://apps.apple.com/us/app/-/id1585425901 ; https://www.sizestream.com/technology/api-sdk/
- Bartol et al. 2022 linear-regression baseline (Sensors 22(5):1885, CC BY, code released) — the actual source of the 29/38/22 mm height+weight prior and a drop-in population prior for the fusion step. https://pmc.ncbi.nlm.nih.gov/articles/PMC8914647/
- ShapeBoost (arXiv 2403.01345) — part-based SMPL/SMPL-X shape regressor with clothing-preserving augmentation; HBW test chest 63 / waist 58 / hip 47 mm, better than SHAPY; server-side only, but the right citation for 'best single-image girth accuracy'. https://arxiv.org/html/2403.01345
- Depth Anything V2 Small (Apache-2.0; Base/Large/Giant are CC-BY-NC-4.0) — the only commercially usable checkpoint for the report's 'monocular metric depth for the side view' open question. https://github.com/DepthAnything/Depth-Anything-V2
- Meta Sapiens (28-class body-part segmentation, 17/133/308-keypoint pose) — CC-BY-NC-4.0 weights: a licensing trap to list explicitly so nobody picks it for clothing/skin masks. https://huggingface.co/facebook/sapiens-seg-0.6b-torchscript
- Ultralytics YOLO11-pose — AGPL-3.0 or paid Enterprise licence; another trap worth naming since it is the most-Googled 'pose model'. https://github.com/ultralytics/ultralytics
- Snap Camera Kit (iOS/Android/Web SDK, body/face/hand tracking, custom licence, historically no usage fees) — on-device AR body tracking that could host the capture UX; body-mesh exposure and current pricing unconfirmed. https://developers.snap.com/ ; https://github.com/Snapchat/camera-kit-ios-sdk
- Prism Labs SDK — cloud-processed (video uploaded, SOC 2, HIPAA BAA) 3D body scan with the n=44 validation the report already cites; relevant as the accuracy/competitor benchmark even though it fails the privacy rule. https://www.prismlabs.tech/developers
- Contura (iOS) — consumer body-measurement app whose privacy policy states body data stays on device with no backend; an existence proof for the on-device posture. https://getcontura.com/privacy/
- Max Planck Innovation (smpl@max-planck-innovation.de) — now the direct SMPL/SMPL-X commercial licensor after Meshcapade's platforms shut down on 18 April 2026; the report still points to Meshcapade. https://smpl-x.is.tue.mpg.de/modellicense.html ; https://meshcapade.com/

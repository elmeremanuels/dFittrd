# Shortening the path to step 3: different input data for the Curtain garment engine

Research date: 10 Nov 2026. Sources: six web, GitHub and Hugging Face research passes, then a verification pass on four of the six routes. Repo context comes from `docs/ENGINE-HANDOFF.md`, `docs/REFINEMENT.md`, `docs/research/garment-engine.md` and `spikes/garment-engine/data/bohohippychic/phase0-written.md`. Scores are the verified (adjusted) scores where a verification ran. Routes R4 and R6 were not verified, so they keep their research scores. All time estimates are agent estimates, not measurements.

---

## 1. The answer in 5 lines

1. The biggest saving comes from moving the size-deciding drape to the server. Drape each graded size there on a few Anny bodies and bake the result into the GLB, so the phone only blends morphs (**R2**). Feed it per-size pattern geometry from the size chart (**R1**) instead of generated turntable video.
2. The input that matters most is not a better model. It is a handful of cheap measured numbers: the **relaxed and stretched girth of the waistband**, a **flat hem width**, and the tape `sampleMeasurements` the input contract already defines. Add a **real back photo** (D13). [REFINEMENT R3](#src-repo) shows the 20 cm hip spread collapses to 5.4 cm because of the cling heuristic and because "every size hangs from the same band". No solver fixes a missing band girth.
3. How much time this saves is unmeasured. Realistic estimates: a pattern spike (R1) takes 2-3 weeks and a two-category prototype 5-8 weeks, which only replaces step 2 and does not shrink it much. Step 3 via R2 takes roughly 4-6 weeks for one builder, against the planned 6-8. The bigger gain is that step 3 stops being open research risk (reliable cloth on mid-range phones) and becomes server engineering you can QA per product.
4. The fastest way to show a visible size difference is a graded ring and outline overlay plus the tight/loose heatmap that already exists (**R5**). That is a few days to 2 weeks of front-end work, if you accept outlines rather than draped cloth as the first version. The on-device Anny avatar still has to be built either way.
5. One licence blocker is new and not yet recorded: GarmentCode's simulator fork [NvidiaWarp-GarmentCode](https://raw.githubusercontent.com/maria-korosteleva/NvidiaWarp-GarmentCode/main/LICENSE.md) is research-only (NVIDIA SCL clause 3.3). Upstream Warp [removed `warp.sim`](https://github.com/NVIDIA/warp) in favour of [Newton](https://github.com/newton-physics/newton), so the Apache path is Newton, libuipc or Blender on the server.

---

## 2. Why the current route is slow

| Pain point | Cause | Source |
|---|---|---|
| Back views are invented, and a skirt back takes about 4 runs | Generative stills and video invent unseen cloth | Phase 0 notes |
| Hem flaps, cloth outside the control, print smear | Wan2.2 Fun Control video is only loosely constrained by depth | Phase 0 notes |
| Trouser crotch and legs are hard | No explicit panels; carving from video | [REFINEMENT](#src-repo) R5 |
| **The size difference is lost**: AU 8-16 has about 20 cm graded hip spread, but about 5.4 cm survives on screen | On-device PBD (2 substeps x 6 iterations) with a cling pull (`clingAccel = 90*drape^2`). Every size hangs from the same elastic band, whose relaxed girth is not measured | [REFINEMENT](#src-repo) R3, `packages/garment-viewer/src/cloth.ts` |
| Only 2 of 5 pilot products usable after about 17 runs, at $1-2 GPU per run plus review | A multi-stage generative chain with a manual QA loop | Phase 0 notes |

Two of these causes are about **input**, not models. The garment's real dimensions are not measured (band girth, hem sweep), and the back is not photographed. The third cause is **where the drape runs**: a soft, low-iteration solver on the phone.

There is also a physical limit to keep in mind. 20 cm of girth is only about 3.2 cm of radius. On a loose maxi skirt, a size difference mostly shows as fullness, fold count, hem swing and where the band sits, not as width.

---

## 3. The routes, ranked

| Rank | Route | Research score | Verified score | Answers "better input"? | Main effect |
|---|---|---|---|---|---|
| 1 | R2: server per-size drapes on an Anny grid, phone blends | 8.5 | **6.5** | Partly (needs per-size rest geometry plus band data) | De-risks step 3 |
| 2 | R1: sewing-pattern templates graded from the size chart | 8 | **6** | Yes | Replaces step 2 for skirts and trousers |
| 3 | R4: keep the pipeline, swap its weakest stages, fix `cloth.ts` | 5.5 | (not verified) | No | Cheaper, more robust step 2 |
| 4 | R5: graded ring outlines plus tight/loose heatmap | 6.5 | **5** | No (output side) | Fastest visible size difference |
| 5 | R3: flat-lay photo with a printed marker | 7 | **4.5** | Yes, but the tape version already exists | Measured truth, small time saving |
| 6 | R6: premium lanes (DXF, tech pack, CAD, dress-form scan) | 4 | (not verified) | Yes, for a minority | Exact for the few who have the data |

### R2. Server-precomputed per-size drapes on an Anny body grid, morph blending on the phone (verified 6.5)

- **Pipeline.** Per product, the server drapes each graded size on a few [Anny](https://github.com/naver/anny) bodies with an Apache-2.0 implicit solver: [Newton VBD](https://newton-physics.github.io/newton/generated/solvers/newton.solvers.VBDSolver.html), [libuipc](https://github.com/spiriMirror/libuipc) for tight garments and the trouser crotch, or [Blender cloth + MPFB2](https://github.com/makehumancommunity/mpfb2) as the cheapest prototype. It bakes a settled mesh per size plus a small linear morph or bone-offset basis over Anny phenotype into the GLB. On the phone, a local ring fit computes the shopper's Anny parameters (D3 holds), blends the baked morphs, and optionally runs a short XPBD polish with no cling. The design pattern follows [PhySkin](https://arxiv.org/abs/2603.27013) and [HyperBones](https://arxiv.org/abs/2605.20460); both are paper only, and HyperBones is CC BY-NC-ND, so we build our own simple linear version.
- **Merchant input.** Nothing new. It needs per-size rest geometry (from R1, or the current stage-4t plus grading) and fabric parameters. **It also needs the waistband's relaxed girth and stretch**, or the server drape will fold the extra ease away just as the phone does.
- **What it replaces.** Creating the drape and the size difference on the phone (`cloth.ts` PBD plus cling).
- **Size difference mechanism.** A real implicit solve with per-size rest lengths and body collision, measured per product on the server. Verification caveats: linear blending in Anny phenotype misses nonlinear contact (a tight size straining, a loose one dropping), and a polish step that keeps cling would collapse the spread again.
- **Licences.** Anny code is Apache-2.0 and its assets are CC0. Never install the `smplx` topology or the `[smpl]` extra, and pin `anny[examples]`: the [README](https://github.com/naver/anny) warns it may download non-commercial assets. Newton, libuipc and [clad-body](https://github.com/datar-psa/clad-body) are Apache-2.0. Blender and MPFB2 are GPL but stay on the server and are not distributed. [MHR](https://github.com/facebookresearch/MHR), the fallback body, has Apache-2.0 code but no stated asset licence.
- **Cost.** Unmeasured. About 15-60 implicit solves per product, likely minutes of GPU or CPU time. Bundle estimate: 8k vertices x 3 x int16 is 48 KB per morph, and 30 morphs is about 1.4 MB raw before meshopt (arithmetic checked).
- **Time to step 3.** About 4-6 weeks for one builder, per the verifier. That covers the ring-fit solver, porting clad-body to TS, the morph baker, and skirts, tops and trousers. The research's "1 week" only covers the spike.
- **Risks.**
  - 3-5 bodies per size cannot support a 6-direction linear basis. Use 1-2 shape axes, or plan for 8-12 drapes per size.
  - Newton VBD is labelled [experimental](https://isaac-sim.github.io/IsaacLab/release/3.0.0-beta2/source/overview/core-concepts/physical-backends/newton/using-vbd-solver.html).
  - Whether Anny covers AU 6-24 is unverified.
  - No commercially licensed measurements-to-body regressor exists, so we build our own.
- **First experiment (verifier-corrected, 3-5 days).** Use Blender only. Pick a garment with a non-elastic waist, or measure the band. Drape AU 8/12/16 on 1 shape axis with at least 3 samples per size, and bake the morphs. Measure the hip and hem spread that survives on a held-out shopper body that is not a grid point, with and without polish. **Go if more than about 60% of the 20 cm graded spread survives.**

### R1. Sewing-pattern template library graded from the size chart (verified 6)

- **Pipeline.**
  1. A commercial VLM API fills a per-category design schema from the shop photo and the payload (skirt: silhouette, flare, tiers, band type and width, slit, length; trousers: rise, leg shape, hem width). This is the [NGL](https://arxiv.org/abs/2602.20700) recipe, which is paper only, so we write our own.
  2. Our own deterministic parser turns the schema into a [GarmentCode](https://github.com/maria-korosteleva/GarmentCode) program (MIT) or a [FreeSewing](https://www.npmjs.com/package/@freesewing/core) design (MIT, JS; titan, charlie, penelope and sandy for trousers and skirts).
  3. Draft one pattern per size from the size-chart girths plus ease.
  4. Stitch and drape on the server with Newton, libuipc or Blender, **not** the GarmentCode Warp fork.
  5. Texture the flat panel UVs from a swatch plus motifs projected from the photo.
  6. Export per-size meshes plus the 12 rings into the existing GLB.
- **Merchant input.** Nothing new: photos, size chart, fabric composition. A back photo and a "model wears S, 176 cm" line help.
- **What it replaces.** Stages 1b-4t: FASHN/Qwen stills, the Wan2.2 turntable, segmentation, carving and the re-run loop.
- **Size difference mechanism.** Each size has its own cut, so the cloth area is real. Correction from verification: [REFINEMENT R3](#src-repo) shows the current grading *already* carries the 20 cm. The loss happens in the browser drape and the unmeasured band. R1 gives a cleaner rest geometry but does not fix the loss by itself; that needs R2 or R5 plus the band data.
- **Licences (code vs weights).**
  - Code: GarmentCode (MIT), [GarmentCodeRC](https://github.com/biansy000/GarmentCodeRC) (MIT), FreeSewing (MIT) and [Design2GarmentCode](https://github.com/Style3D/design2garmentcode-impl) (MIT) are all fine.
  - Banned: the simulator fork [NvidiaWarp-GarmentCode](https://raw.githubusercontent.com/maria-korosteleva/NvidiaWarp-GarmentCode/main/LICENSE.md), NVIDIA SCL 3.3, non-commercial. Design2GarmentCode's default sim path points to it.
  - Weights: the Design2GarmentCode LoRA is a Google Drive file with no licence, so benchmark only. Its default reasoning step calls GPT-4o (commercial API, fine). [AIpparel weights](https://huggingface.co/georgeNakayama/AIpparel) are MIT but sit on a LLaVA-1.5 / Llama 2 base, so benchmark only. [ChatGarment](https://github.com/biansy000/ChatGarment) code is Apache-2.0, but its weights are unlicensed.
  - Data: [GarmentMeasurements](https://github.com/mbotsch/GarmentMeasurements) is GPL-3.0; use its definitions or run it server-side only.
- **Cost.** One VLM call plus minutes of simulation per size. No H100 video, no multi-run loop. Engineering effort is up front, per category.
- **Time.** A 2-3 week spike and 5-8 weeks for a usable skirt plus trouser prototype (verifier). That is about the same as step 2's 6-8 weeks, so this **replaces step 2 rather than shortening step 3**.
- **Risks.**
  - Boho details (gathered tiers, ruffles, ties, smocking) and placement prints fall outside the templates.
  - Every open image-to-pattern model was trained on synthetic [GarmentCodeData](https://igl.ethz.ch/projects/GarmentCodeData/) renders, so accuracy on real shop photos is unproven.
  - Porting GarmentCode's stitching to Newton is real work: `warp.sim` was removed from upstream Warp, so pinning a recent Warp is not an option.
  - [pygarment](https://pypi.org/project/pygarment/) has had no release since 2025-04-18.
- **First experiment (narrowed).** Write the schema by hand for the bohohippychic skirt at AU 8/12/16 plus one FreeSewing trouser. Draft the per-size patterns, drape them in Blender or Newton, then load them in the viewer **with cling off** and measure the hip and hem spread. Run Design2GarmentCode and AIpparel on the 5 pilot photos as a side benchmark only.

### R4. Hybrid: keep the pipeline, swap its weakest stages, fix the drape (5.5, not verified)

- **Pipeline.**
  - Replace the Wan2.2 turntable with [MV-Adapter](https://github.com/huanngzh/MV-Adapter) (Apache-2.0 code and weights). It makes 6+ views in one pass, conditioned on *our* mannequin and proxy geometry. Or use [TRELLIS.2-4B](https://huggingface.co/microsoft/TRELLIS.2-4B) (MIT) on the dressed front still and subtract the body SDF.
  - Self-host [FASHN VTON v1.5](https://huggingface.co/fashn-ai/fashn-vton-1.5) (Apache-2.0).
  - Rewrite `cloth.ts`: XPBD with real compliance and **no cling**, per-size rest lengths, and loop constraints (loop length >= graded girth x (1 - stretch limit)). [WebCloth 2](https://github.com/ketaevweb/webcloth2) (MIT) is a reference.
- **Merchant input.** Same as today.
- **What it replaces.** The Wan video, the FASHN API, and the cling PBD.
- **Size difference mechanism.** Partial. It is still one carved shape scaled per size.
- **Licences.**
  - TRELLIS.2 bakes textures with [nvdiffrast](https://github.com/NVlabs/nvdiffrast), which is non-commercial, so that step must be replaced.
  - Avoid fashn-human-parser (NVIDIA SegFormer licence).
  - Avoid InstantMesh, because it contains Zero123++ weights, which are [CC-BY-NC](https://github.com/SUDO-AI-3D/zero123plus).
  - Avoid [Era3D](https://github.com/pengHTYX/Era3D) (AGPL).
  - Avoid Hunyuan3D: its [licence excludes the EU](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1).
  - Avoid [SF3D/SPAR3D](https://github.com/Stability-AI/stable-fast-3d): free only under USD 1M revenue.
- **Cost.** Probably below a Wan H100 run (TRELLIS.2 takes about 17 s at 1024³ on an H100). Manual review stays.
- **Time.** 1-day to 1-week tests. WebCloth 2 may save 1-2 weeks of solver work.
- **Risks.** Backs are still invented. Trousers stay hard. No browser cloth library has a benchmark on mid-range Android.
- **First experiment.** Run TRELLIS.2 on the 5 dressed stills and compare against stage 4t. Separately, turn cling off in `cloth.ts`, add the girth constraints, and measure the AU 8-16 spread again. This is the cheapest control experiment for every other route.

### R5. Size-visualisation first: graded ring outlines plus tight/loose heatmap (verified 5)

- **Pipeline.** On the avatar, draw each size's graded waist, hip and hem rings and length marks from `grading.json`, plus a ghost outline of the neighbouring size. The tight/loose heatmap is **already built** (`setHeat()` and the fit-map mode in `packages/garment-viewer/src/scene.ts`, and `fitGapsForRender` in `packages/fit-engine/src/summary.ts`).
- **Merchant input.** The size chart, which Curtain already parses.
- **What it replaces.** Nothing in the pipeline. It removes the dependence of step 3's promise on the drape keeping the spread.
- **Size difference mechanism.** Numerical and taken straight from the chart. It is not draped cloth. Rings without a garment-measured girth (elastic bands) must be hidden or marked as estimates.
- **Licences.** Our own code plus three.js (MIT). No risk.
- **Cost.** Zero per product.
- **Time.** A few days to about 2 weeks of front-end work. The **on-device Anny avatar does not exist yet**: Anny is Python, so it must be exported to a glTF with morph targets plus a ring fit. That is weeks of work, and every route shares it.
- **Market evidence.** Zalando's [2023 pilot](https://fashionunited.uk/news/fashion/zalando-pilots-virtual-fitting-room-in-25-markets/2023042469125) used a jeans heatmap. The "up to 40% fewer returns" figure is the jeans return rate in tests with selected brands, not a general result. The 2026 rollout to all customers is an [announced plan](https://corporate.zalando.com/en/node/11013). [Virtusize](https://virtusize.com/virtusize) shows a 2D measurement overlay.
- **First experiment.** A 2D mock in the existing AvatarView with AU 8/12/16 rings, shown to 5 test users.

### R3. Measured-garment input: flat-lay photo with a printed marker (verified 4.5)

- **Pipeline.** The merchant lays the garment flat next to an A4 [ArUco/ChArUco](https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html) sheet. [SAM 2](https://github.com/facebookresearch/sam2) (Apache-2.0) cuts it out, a homography gives scale, and our own rules read the points of measure (POMs).
- **Merchant input.** About 2 minutes per product and side.
- **Verification result.** The useful part already exists. [ENGINE-HANDOFF](#src-repo):80 defines `sampleMeasurements` measured with a tape, PREDICTION-ENGINE.md:64 asks for a flat hem width, and D13 requires real front and back photos.
  - A tape is about 0.5 cm accurate. Vision methods report [1.6-2.1% error](https://www.mdpi.com/2076-3417/12/10/5286), about 1.3-2 cm.
  - Smocked or gathered waists and tiers make "measured truth" ambiguous.
  - The flat-lay photo cannot serve as albedo without R1's panel parameterisation.
  - Small shops rarely hold more than one sample size.
- **Licences.** OpenCV and SAM 2 are Apache-2.0. Do not use DeepFashion2-trained weights. [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) uses the SAM License: gated, commercial use allowed with restrictions, and Meta can change it. Keep it as an optional internal reference only.
- **What to do.** Enforce the **tape version now**: waist relaxed and stretched, hip, hem sweep, length, rise and inseam for trousers, plus a real back photo. Do not count R3 as time saved toward step 3.

### R6. Premium input lanes: DXF, tech pack, CAD exports, dress-form scan (4, not verified)

- **DXF lane.** Graded DXF-AAMA files read with [ezdxf](https://github.com/mozman/ezdxf) (MIT) plus our own grade-rule reader. Seam pairing is not in the DXF.
- **Tech pack lane.** Tech packs parsed with a VLM: the POM table feeds `grading.json`, the flats show the back, the BOM feeds `material.json`.
- **CAD lane.** CLO, Browzwear or Style3D exports (GLB per size plus DXF plus a fabric preset). Accept the files; do not integrate the APIs. [CLO-SET](https://style.clo-set.com/service/pricing) Premium costs $40/user/month for 300 API calls, and full automation is Enterprise-only.
- **Scan lane.** A dress-form scan via the [KIRI Engine API](https://www.kiriengine.app/api) (about $1 per scan, 500-credit minimum) or Apple Object Capture.
- **Assessment.** Exact geometry and real backs for those products. Coverage among small boho shops is low, and there is no reliable adoption figure. Grading drops straight into R1 and R2.
- **First experiment.** Ask the pilot merchants whether a tech pack or DXF exists for any pilot product.

---

## 4. Recommended plan

**Keep:** stage-5 grading and `grading.json`, the 12-ring anchor export (D15), the GLB bundle format, the three.js viewer, the fit engine and heatmap, and Anny as the body. SAM 2 stays for segmentation.

**Drop or freeze:**
- The cling pull in `cloth.ts`.
- The idea that the phone *creates* the drape.
- The Wan2.2 turntable as the default geometry source for skirts and trousers. It can stay for marketing renders, or be replaced by MV-Adapter or TRELLIS.2 for odd garments.
- Any route through NvidiaWarp-GarmentCode, the D2GC LoRA or the ChatGarment weights in production.

**Add as input (cheap, merchant side):**
- Waistband girth relaxed and stretched.
- Flat hem width.
- Tape POMs, using the existing `sampleMeasurements` field.
- A real back photo (D13).
- The "model wears S, 176 cm" line where the product page has it.

**First 2 weeks**

| Day | Work | Go/no-go measure |
|---|---|---|
| 1-2 | **Control:** turn cling off in `cloth.ts`, add girth/ease loop constraints and per-size rest lengths, re-measure the AU 8-16 hip and hem spread on the current skirt | How many of the 20 cm survive (baseline 5.4 cm) |
| 1-2 | Tape-measure the pilot skirt band (relaxed and stretched) and hem sweep. Ask the pilot merchants for tech packs or DXF | Band data present |
| 2-5 | **R2 spike (Blender only):** drape AU 8/12/16 on 1 shape axis x 3 bodies, with the measured band. Bake morphs and blend them in the viewer on one real mid-range Android (WebGL2) | More than about 60% of the spread survives on a held-out body; fps; bundle size |
| 3-5 | **R5 mock:** AU 8/12/16 ring outlines plus neighbour ghost in AvatarView; test with 5 users | Do users pick a size and say why? |
| 6-10 | **R1 spike:** hand-written schema, GarmentCode skirt AU 8/12/16 plus FreeSewing trouser (titan or charlie), per-size patterns, Blender or Newton drape, fed into the R2 baker | Settled-mesh spread versus 20 cm; trouser crotch quality; hours per category |
| 6-10 | Side benchmark: Design2GarmentCode and AIpparel on the 5 pilot photos (benchmark only) | Parameter accuracy on real photos |
| 10 | Decision | R1 + R2 for step 3; R5 as the safety net |

Also do this week: add NvidiaWarp-GarmentCode (NVIDIA SCL 3.3) and the nvdiffrast baking step to the banned list in `docs/research/garment-engine.md`.

---

## 5. Source list

Star counts come from GitHub search on 10 Nov 2026; download counts come from the Hugging Face API.

### GitHub repos

| Repo | Role | Stars | Licence | Last update |
|---|---|---|---|---|
| [maria-korosteleva/GarmentCode](https://github.com/maria-korosteleva/GarmentCode) | Parametric patterns | 496 | MIT | push 2025-06-29; [pygarment 2.0.2](https://pypi.org/project/pygarment/) 2025-04-18 |
| [maria-korosteleva/NvidiaWarp-GarmentCode](https://github.com/maria-korosteleva/NvidiaWarp-GarmentCode) | GarmentCode simulator | n/a | **NVIDIA SCL, non-commercial** | n/a |
| [biansy000/GarmentCodeRC](https://github.com/biansy000/GarmentCodeRC) | Refined GarmentCode | 12 | MIT | 2025-04 |
| [freesewing/freesewing](https://github.com/freesewing/freesewing) ([Codeberg](https://codeberg.org/freesewing/freesewing)) | JS pattern drafting | 489 | MIT | GitHub push 2025-04-02; [@freesewing/core](https://www.npmjs.com/package/@freesewing/core) 4.10.2, 2026-09 |
| [Style3D/design2garmentcode-impl](https://github.com/Style3D/design2garmentcode-impl) | Photo to GarmentCode | 79 | MIT code; LoRA unlicensed | 2025-11-19 |
| [georgeNakayama/AIpparel-Code](https://github.com/georgeNakayama/AIpparel-Code) | Pattern VLM | 69 | MIT (LICENCE file, one read) | 2025-07 |
| [biansy000/ChatGarment](https://github.com/biansy000/ChatGarment) | Pattern VLM | 185 | Apache-2.0 code; weights unlicensed | 2025-08-07 |
| [shengqiliu1/SewingLDM](https://github.com/shengqiliu1/SewingLDM) | Pattern diffusion | n/a | Apache-2.0 | 2025-08 |
| [garment-particles/GarmentParticles](https://github.com/garment-particles/GarmentParticles) | Pattern plus geometry | n/a | MIT | 2026 |
| [Style3D/garmagenet-impl](https://github.com/Style3D/garmagenet-impl) | Pattern plus 3D | 83 | **CC BY-NC-ND** | 2026-01-16 |
| [sail-sg/sewformer](https://github.com/sail-sg/sewformer) | Photo to pattern | 222 | **None** | 2023-12 |
| [naver/anny](https://github.com/naver/anny) | Body model | 636 | Apache-2.0, CC0 assets (no smplx) | v0.6.2 2026-10-26 |
| [datar-psa/clad-body](https://github.com/datar-psa/clad-body) | ISO 8559-1 girths | 34 | Apache-2.0 | 2026-05 / 2026-11 (sources differ) |
| [facebookresearch/MHR](https://github.com/facebookresearch/MHR) | Fallback body | 902 | Apache-2.0 code; asset licence not stated | 2026-11-09 |
| [newton-physics/newton](https://github.com/newton-physics/newton) | VBD cloth solver | n/a | Apache-2.0 | active (v1.4.0) |
| [spiriMirror/libuipc](https://github.com/spiriMirror/libuipc) | IPC cloth solver | ~351 | Apache-2.0 | active; v1.0 announced |
| [st-tech/ppf-contact-solver](https://github.com/st-tech/ppf-contact-solver) | Contact solver | n/a | Apache-2.0 | n/a |
| [openxrlab/xrtailor](https://github.com/openxrlab/xrtailor) | CUDA cloth | 80 | Apache-2.0 (README; second check failed) | 2025-11-19 |
| [NVIDIA/warp](https://github.com/NVIDIA/warp) | GPU framework (no `warp.sim`) | n/a | Apache-2.0 | 1.19 |
| [Dolorousrtur/HOOD](https://github.com/Dolorousrtur/HOOD) / [ContourCraft](https://github.com/Dolorousrtur/ContourCraft) | Neural garment sim | 206 / 102 | MIT code; SMPL-bound weights | 2025-05 / 2025-08 |
| [ketaevweb/webcloth2](https://github.com/ketaevweb/webcloth2) | Browser XPBD | n/a | MIT | 2026 |
| [bandinopla/three-simplecloth](https://github.com/bandinopla/three-simplecloth) | WebGPU cloth toy | 63 | MIT | 2026-02-20 |
| [Dicklesworthstone/franken_textiles](https://github.com/Dicklesworthstone/franken_textiles) | Rust/WASM reference | 4 | MIT plus rider (check) | 2026-11-10 |
| [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Image to 3D | n/a | MIT (nvdiffrast is NC) | 2026-07 |
| [huanngzh/MV-Adapter](https://github.com/huanngzh/MV-Adapter) | Geometry-guided multiview | n/a | Apache-2.0 | 2025 |
| [fashn-AI/fashn-vton-1.5](https://github.com/fashn-AI/fashn-vton-1.5) | Self-hosted VTON | 382 | Apache-2.0 | 2026-02-01 |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | Segmentation | n/a | Apache-2.0 | Dec 2024 |
| [facebookresearch/sam-3d-body](https://github.com/facebookresearch/sam-3d-body) | Photo-model body | 3.7k | SAM License (gated) | 2026-02 |
| [mbotsch/GarmentMeasurements](https://github.com/mbotsch/GarmentMeasurements) | Body measurements | n/a | GPL-3.0 | n/a |
| [mozman/ezdxf](https://github.com/mozman/ezdxf) | DXF reader | n/a | MIT (not opened) | n/a |
| [HarryWang355/FIT-VTO](https://github.com/HarryWang355/FIT-VTO) | Size-aware VTON | n/a | **No licence** | 2026 |
| [nsarafianos/Garment3DGen](https://github.com/nsarafianos/Garment3DGen) | Template deformation | n/a | **CC BY-NC** | n/a |

### Hugging Face models, datasets and spaces

| Item | Downloads | Licence | Last update |
|---|---|---|---|
| [microsoft/TRELLIS.2-4B](https://huggingface.co/microsoft/TRELLIS.2-4B) | ~2.69M | MIT | 2025-12 |
| [georgeNakayama/AIpparel](https://huggingface.co/georgeNakayama/AIpparel) | low | MIT (LLaVA-1.5 base) | 2025-09 |
| [Qwen/Qwen2-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct) | high | Apache-2.0 | n/a |
| [liusq/sewingldm](https://huggingface.co/liusq/sewingldm) | n/a | Apache-2.0 | 2025-08 |
| [georgeNakayama/GarmentParticles](https://huggingface.co/datasets/georgeNakayama/GarmentParticles) | n/a | MIT | 2026 |
| [chibifire/datasource-garmentcodedata-v2-parquet](https://huggingface.co/datasets/chibifire/datasource-garmentcodedata-v2-parquet) | ~5.5k | CC BY 4.0 (tag) | 2026-11-10 |
| [Pekcfe/GarmentCodeData](https://huggingface.co/datasets/Pekcfe/GarmentCodeData) | n/a | No tag | n/a |
| [sy000/chatgarment_extrafiles](https://huggingface.co/sy000/chatgarment_extrafiles) | n/a | **None** | 2025-04 |
| [fashn-ai/fashn-vton-1.5](https://huggingface.co/fashn-ai/fashn-vton-1.5) | n/a | Apache-2.0 | 2026-02 |
| [facebook/sam-3d-body-dinov3](https://huggingface.co/facebook/sam-3d-body-dinov3) | ~13k | SAM License, gated | 2025-11 |
| [huanngzh/mv-adapter](https://huggingface.co/huanngzh/mv-adapter) | n/a | Apache-2.0 | 2025 |
| [YuCrazing/ClothTransformer-checkpoint](https://huggingface.co/YuCrazing/ClothTransformer-checkpoint) | n/a | MIT (data CC BY 4.0) | 2026 |
| [fal/virtual-tryoff-lora](https://huggingface.co/fal/virtual-tryoff-lora) | ~3.4k | **FLUX.2-klein-9B base, NC** | 2026 |
| [Yuanhao-Harry-Wang/fitvto-100k](https://huggingface.co/datasets/Yuanhao-Harry-Wang/fitvto-100k) | n/a | **CC BY-NC-ND** | 2026 |
| [tencent/Hunyuan3D-2.1](https://huggingface.co/tencent/Hunyuan3D-2.1) | n/a | **Excludes EU** | n/a |
| [Intelligent-Systems/BEDLAM2](https://huggingface.co/datasets/Intelligent-Systems/BEDLAM2) | n/a | **Non-commercial** | n/a |

### Papers and market

- Pattern methods without code: [NGL](https://arxiv.org/abs/2602.20700), [Image2Garment](https://arxiv.org/abs/2601.09658), [Dress-1-to-3](https://arxiv.org/abs/2502.03449), [DressWild](https://arxiv.org/abs/2602.16502).
- [FIT](https://arxiv.org/abs/2604.08526): size-aware try-on built on GarmentCode simulation.
- Vendors: [CLO-SET pricing](https://style.clo-set.com/service/pricing), [Browzwear API](https://browzwear.com/api), [Style3D AI Garment](https://www.style3d.com/blog/?p=11744), [PICTOFiT](https://www.reactivereality.com/pictofit).
- [WebGPU on mobile (nakjun benchmark)](https://arxiv.org/abs/2507.11794).

### Repo sources {#src-repo}

`/home/user/dfittrd/docs/ENGINE-HANDOFF.md` (input contract, `sampleMeasurements`, D3, D13, D15), `/home/user/dfittrd/docs/REFINEMENT.md` (R3: 20 cm becomes 5.4 cm, same band; R5: trousers), `/home/user/dfittrd/docs/research/garment-engine.md` (Anny chosen; NvidiaWarp-GarmentCode ban missing), `/home/user/dfittrd/spikes/garment-engine/data/bohohippychic/phase0-written.md` (smocked or drawstring waistband).

---

## 6. What could not be verified

**Time and cost (nothing measured):**
- All time estimates (spikes, prototypes, weeks per category) are agent estimates.
- Newton VBD, libuipc and Blender drape time per garment per size on Anny.
- Morph bundle size (1.4 MB is arithmetic only).
- Any browser cloth library (WebCloth 2 etc.) on a real mid-range Android.

**Quality:**
- Accuracy of open image-to-pattern models on real shop photos.
- Whether Anny's shape space covers AU 6-24 (hip about 85-135+ cm).

**Licences:**
- GarmentCodeData: CC BY 4.0 was read on the ETH record by one agent; others got HTTP 500, and an aggregator says CC BY-SA.
- Terms for the CAESAR-derived bodies.
- The Design2GarmentCode LoRA.
- MHR assets.
- XRTailor (repo path not found in the second check).
- The AIpparel code LICENCE (read once).
- The full text of the FrankenTextiles rider.
- PhySkin.

**Market:**
- PICTOFiT pricing and SDK (docs domain blocked).
- Style3D API terms and price.
- Whether the Meshcapade API was shut down after the Epic acquisition.
- Bods' current status.
- Google's official try-on price.

**Other:**
- Whether FreeSewing development moved to Codeberg (likely; GitHub's last push is 2025-04).
- Whether the "six independent research angles" agree independently: they come from one orchestration, so their agreement is not independent evidence.

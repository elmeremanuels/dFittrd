# Realistic body spike, female family (21 Nov 2026)

Branch `claude/realistic-body` (from `claude/garment-engine`), not pushed. The one-week spike of route B in
`docs/research/realistic-avatar-route.md` §7: the MakeHuman CC0 base mesh, baked by our own script, fitted on the device
to the ring table, drawn in the garment viewer behind an opt-in body shape that is off by default. Numbers are in
`docs/reports/claude/realistic-body-spike.json` (`packages/garment-viewer/scripts/realistic-body-report.ts`); pictures
in `docs/screens/claude/realistic-body/` (`spikes/garment-engine/viewer/realistic-body-renders.mjs`, sheets by
`realistic-body-sheets.mjs`). All work by an AI agent; the licence reading is not a lawyer's.

## Verdict

Route B is **not killed, and not passed**: "continue with named fixes".

- The girth part works far better than the bound: all 12 rings on all seven bodies (the five test bodies and the two
  corners of the input box) are within 0.02 % of the ring table (bound 0.5 %), loop girth.
- The asset is small (338 KB, bound 1.5 MB) and the viewer chunk is 188.0 KB gzip, 1.0 KB more than before (bound 400 KB).
- The body alone is a clear step away from the "grey doll": real anatomy at every size (pictures below). The face is
  MakeHuman's own, untouched (D27), with grey eye spheres; no skin texture was added (none cleared for this spike).
- What fails is the outline: the realistic section is up to 2.3 to 4.9 cm outside the ring table's ellipse on the
  torso of the five bodies (and 4.4 to 5.0 cm on the forearm), because a real section with the same girth as an
  ellipse cannot lie on it. With cloth that still collides with the ring table (the rule of this spike), the skin shows
  through the garment there. A display step (`conformToField`) pulls the skin inside the field where a garment covers
  it; then the dress pictures are clean (0.13 to 0.22 cm outside on the torso, 0.33 to 0.36 cm on the arm), but under
  the garment the drawn body is no longer the realistic one. The real fix is a collider made from the realistic mesh,
  which means rebuilding and re-gating every bundle (OI-143, a founder decision).
- Tape versus loop: at the hip the tape (convex hull) reads 1.7 to 2.8 cm under the loop on every test body, at the
  chest 0.7 to 1.65 cm. Over the 1.0 cm bound without a rule; a founder decision (OI-141).
- Not measured: anything on a phone. There is no phone here; frame times are headless Chromium with SwiftShader.

## Pass and fail (the numbers of the route doc §7)

| Check | Pass bound | Measured | Verdict |
|---|---|---|---|
| Loop girth, all 12 rings, S / M / XXL (slim, mid, full) | within 0.5 % | largest error 0.0001 % (full, neck and shoulder); every other ring under 0.0001 % | **pass** |
| Loop girth, all 12 rings, tall and petite | within 0.5 % | under 0.0001 % | **pass** |
| Loop girth at the two corner bodies (60/45/65 at 130 cm; 160/150/170 at 220 cm, drawn at waist 147 by `BODY_INPUT_LIMITS`) | within 0.5 %, closed, no self-crossing | 0.019 % (small corner, thigh), 0.0075 % (large corner, shoulder); closed (watertight, no boundary edge) at all seven bodies; **crosses itself**: 14 triangle pairs at the toes on every body (in MakeHuman's own base mesh), plus 78 at the inner thighs of the small corner and 20 where the hands meet the hips of the large corner | **fail as written**; causes named (OI-147) |
| Tape girth at bust, waist, hip | difference from loop under 1.0 cm, or a written rule | waist 0.04 to 0.17 cm; chest 0.69 to 1.65 cm (over 1.0 cm on full and petite); hip 1.74 to 2.82 cm (over on all five); corners up to 4.0 cm | **fail until a rule is agreed** (OI-141) |
| Outline against drawn mesh, torso from the seat up and arms | at most 0.5 cm | against the collision outline the cloth meets (the ring table's ellipses): torso 2.26 to 4.85 cm outside and 4.38 to 6.13 cm inside; arm (upper-arm ring to 3 cm short of the wrist ring) 4.37 to 5.03 cm outside. Conformed under a garment: torso 0.14 to 0.18 cm outside, arm 0.32 to 0.36 cm outside (inside unchanged) | **fail** for the fitted skin; the conformed display mesh is within 0.5 cm outside but not inside |
| Viewer chunk | under 400 KB gzip | 188.0 KB gzip (`check-viewer-chunk.mjs`, final `pnpm check`); before the spike 187.0 KB (the same build at the branch point 71adc06). The loader is its own lazy chunk, 4.2 KB gzip | **pass** |
| Body asset, transferred | at most 1.5 MB for mesh and one 2K skin | 337,732 bytes (251 KB gzipped by Node at level 6; 234 KB as Vite emitted it gzipped). No skin texture (not taken, see licences) | **pass for the mesh**; the skin part is not measured |
| Frame time on a real phone, body with one garment, turning | at most 33 ms, at most 1.25 × today's body | **not measured** (no phone). Headless Chromium, SwiftShader on the CPU, 390 × 844 at 2×, mid body with the dress, turning: 73.2 ms per frame after against 79.1 ms before (median of three runs; 0.93 times today's body). Body alone, synchronous render: 96.0 against 110.8 ms (mid), 100.5 against 114.5 ms (full). Not phone numbers | **not verified** |
| Pictures | founder says the spike body is clearly closer to the references | sheets per body in `docs/screens/claude/realistic-body/`; the founder has not seen them | **open** (OI-142) |

## Loop or tape: what the fit measures, and why (founder decision, OI-141)

The fit measures the **loop**: the length of the closed horizontal (or, on the arm, perpendicular) section of the mesh
round the ring centre, the same measure as `meshRingCircumference` and every ring test of the mannequin, and the one
the cloth's grading and the procedural body use today. On the procedural body loop and tape are the same (every
section is an ellipse, convex). On the realistic body they are not: the loop follows the skin into the cleavage, the
buttock cleft and the small of the back, a tape bridges them. A shopper's tape reads the hull. If the typed girth is
the tape, the fitted body is too large by the difference at that ring (hip 1.7 to 2.8 cm, chest 0.7 to 1.65 cm on the
five bodies). The fit can target either (the hull girth is computed next to the loop in `ringReport`); which one the
typed number means is the founder's call. Proposal: tape at chest and hip (that is how people measure), loop
elsewhere, and the procedural body unchanged.

## What was built

| Part | Where |
|---|---|
| Offline bake (our own TypeScript; no MakeHuman or MPFB code) | `packages/garment-viewer/scripts/bake-realistic-body.ts`: base mesh `body` group and the two eye helpers; the default MakeHuman female (three ethnic female-young targets at 1/3 each); dm to cm; arms turned to the mannequin's A-pose (32°) with MakeHuman's own arm skin weights; the arm's centre line from its sections; the anatomical levels of the 12 rings found on the mesh; four sparse shape targets (weight ±, cup ±); int16 quantisation. Deterministic; every source checked by sha256 |
| Asset | `packages/garment-viewer/assets/realistic-body/female-v1.crb`, 337,732 bytes, 13,524 vertices, 27,036 triangles (body 13,380 vertices, two eyes 72 each); `PROVENANCE.md` next to it |
| Fit | `packages/garment-viewer/src/realisticBody.ts` `fitRealisticBody`: shape sliders from seat over stature and chest over underbust; a C1 vertical warp onto the ring heights; section centres onto the table's centre lines; each arm moved rigidly onto the table's arm frame and stretched to the wrist ring; a radial scale per ring height (and per distance along the arm, and a band round the shoulder ring), corrected 6 times to target / measured. The head takes a fifth of the neck's scale. 100 to 250 ms per body in Node |
| Display step under a garment | `conformToField` and `coverZone` in the same file |
| Loader and drawing | `realisticBodyLoad.ts` (lazy chunk, one GET); `MountOptions.bodyShape: 'realistic-spike'` in `mount.ts` (female only; default `procedural`); `canvas.dataset.body`; `realisticBodyConform: false` for comparison pictures. Web build flag `VITE_VIEWER_BODY=realistic-spike` (`apps/web/src/embed/look.ts`, `Garment3D.tsx`) |
| Tests (ordinary suite) | `packages/garment-viewer/src/realisticBody.test.ts`: 12 rings within 0.5 % on the five bodies; negative control (no correction, and a table 2 % off at the waist) that makes the same check fail; closed mesh; encoder round trip; the conform step; the option off by default. `apps/web/src/embed/__tests__/garment3d.test.tsx`: the flag is sent only when set, never for a men's body |
| Measurements and pictures | `scripts/realistic-body-report.ts`; `spikes/garment-engine/viewer/realistic-body-renders.mjs`, `realistic-body-sheets.mjs`; `body=realistic` (and `conform=0`) on `avatar.html` |

Unchanged: the ring table, the collision field (`bodyField`), the fit engine, every bundle, the procedural meshes and
their goldens, every default. The cloth collides with exactly the field it collided with before, with the option on or
off.

## Ring errors (loop), cm and %

Target girth / (loop − target) / target. Female, typed height and girths: slim 164 cm 80/62/88, mid 168 cm 92/74/100,
full 170 cm 116/98/122, tall 182 cm 92/74/100, petite 152 cm 84/66/92; corners 130 cm 60/45/65 and 220 cm
160/150/170 (drawn waist 147).

| Ring | slim | mid | full | tall | petite | corner small | corner large |
|---|---|---|---|---|---|---|---|
| neck | 32.0 / 0.0000 % | 35.0 / 0.0000 % | 40.0 / −0.0001 % | 35.0 / 0.0000 % | 33.0 / 0.0000 % | 27.0 / 0.0004 % | 49.2 / 0.0000 % |
| shoulder | 94.0 / 0.0000 % | 102.0 / 0.0000 % | 120.0 / 0.0001 % | 102.0 / 0.0000 % | 96.7 / 0.0000 % | 80.7 / 0.0000 % | 158.4 / 0.0075 % |
| chest | 80.0 / 0.0000 % | 92.0 / 0.0000 % | 116.0 / 0.0000 % | 92.0 / 0.0000 % | 84.0 / 0.0000 % | 60.0 / 0.0000 % | 160.0 / 0.0000 % |
| underbust | 68.0 / 0.0000 % | 78.0 / 0.0000 % | 100.0 / 0.0000 % | 78.0 / 0.0000 % | 71.3 / 0.0000 % | 52.8 / 0.0000 % | 145.8 / 0.0000 % |
| waist | 62.0 / 0.0000 % | 74.0 / 0.0000 % | 98.0 / 0.0000 % | 74.0 / 0.0000 % | 66.0 / 0.0000 % | 45.0 / 0.0000 % | 147.0 / 0.0000 % |
| hip | 88.0 / 0.0000 % | 100.0 / 0.0000 % | 122.0 / 0.0000 % | 100.0 / 0.0000 % | 92.0 / 0.0000 % | 65.0 / −0.0005 % | 170.0 / 0.0000 % |
| thigh | 50.0 / 0.0000 % | 57.0 / 0.0000 % | 70.0 / 0.0000 % | 57.0 / 0.0000 % | 52.3 / 0.0000 % | 36.6 / 0.0192 % | 98.4 / 0.0000 % |
| knee | 33.0 / 0.0000 % | 36.0 / 0.0000 % | 41.0 / 0.0000 % | 36.0 / 0.0000 % | 34.0 / 0.0000 % | 27.3 / −0.0001 % | 51.9 / 0.0000 % |
| calf | 32.0 / 0.0000 % | 35.0 / 0.0000 % | 40.0 / 0.0000 % | 35.0 / 0.0000 % | 33.0 / 0.0000 % | 26.3 / 0.0000 % | 50.9 / 0.0000 % |
| ankle | 20.5 / 0.0000 % | 22.0 / 0.0000 % | 24.5 / 0.0000 % | 22.0 / 0.0000 % | 21.0 / 0.0000 % | 17.6 / 0.0000 % | 30.0 / 0.0000 % |
| upper arm | 25.0 / 0.0000 % | 28.0 / 0.0000 % | 36.0 / 0.0000 % | 28.0 / 0.0000 % | 26.0 / 0.0000 % | 20.0 / 0.0000 % | 50.7 / 0.0000 % |
| wrist | 14.5 / 0.0000 % | 15.5 / 0.0000 % | 17.0 / 0.0000 % | 15.5 / 0.0000 % | 14.8 / 0.0000 % | 12.8 / 0.0000 % | 19.8 / 0.0000 % |

Tape (convex hull) girth and tape − loop, cm:

| Ring | slim | mid | full | tall | petite | corner small | corner large |
|---|---|---|---|---|---|---|---|
| chest | 79.31 / −0.69 | 91.13 / −0.87 | 114.95 / −1.05 | 91.26 / −0.74 | 82.35 / −1.65 | 58.90 / −1.10 | 155.98 / −4.02 |
| waist | 61.94 / −0.06 | 73.87 / −0.13 | 97.83 / −0.17 | 73.96 / −0.04 | 65.88 / −0.12 | 44.95 / −0.05 | 146.75 / −0.25 |
| hip | 86.26 / −1.74 | 97.18 / −2.82 | 119.51 / −2.49 | 97.79 / −2.21 | 89.64 / −2.36 | 63.71 / −1.29 | 166.53 / −3.47 |

The negative control: the same check with the correction switched off (`iterations: 0`) fails on every body, and a
fit to a table 2 % off at the waist, checked against the true table, fails at the waist only (in the test).

## Drawn mesh against the collision outline

Per station every 0.5 cm, 96 directions, the drawn section's radius minus the ellipse's (the field the cloth meets),
cm. Torso: from the hip ring to 2 cm over the chest ring (under the armpit). Arm: from the upper-arm ring to 3 cm short of
the wrist ring (to the wrist ring itself, the thumb's root adds about 1.3 cm). Leg: ankle to thigh ring.

| Body | torso out / in | arm out / in | leg out / in | conformed: torso out, arm out |
|---|---|---|---|---|
| slim | 3.03 / 4.38 | 4.49 / 3.05 | 2.49 / 2.02 | 0.18, 0.32 |
| mid | 3.51 / 4.85 | 4.62 / 3.12 | 2.77 / 1.93 | 0.14, 0.34 |
| full | 4.85 / 6.13 | 5.03 / 3.52 | 3.23 / 2.33 | 0.16, 0.36 |
| tall | 3.57 / 4.94 | 4.82 / 3.23 | 2.68 / 2.01 | 0.18, 0.33 |
| petite | 2.26 / 4.73 | 4.37 / 2.94 | 2.67 / 1.84 | 0.17, 0.35 |
| corner small | 1.53 / 3.67 | 3.65 / 2.56 | 2.11 / 1.60 | 0.13, 0.17 |
| corner large | 5.06 / 8.32 | 6.17 / 4.30 | 4.01 / 2.96 | 0.22, 0.51 |

Where: torso outside at the back just under the armpit (the shoulder blades and lats, 300 to 330°) and the bust apex;
inside at the front centre between the breasts (90°). Arm outside at the front of the forearm near the wrist. The
conformed mesh is a display mesh: where it was pulled, its girths are under the table's (chest 4 to 8.5 % under, hip
up to 2.3 %), and the pull adds 8 to 52 crossing triangle pairs on the five bodies (folds where the skin was pressed
onto the ellipse; hidden under the garment in the pictures, not checked from every angle).

## Bytes, chunk and time

| What | Measured |
|---|---|
| Asset | 337,732 bytes; 251,229 gzipped by Node (level 6); 233,831 as emitted by the web build. Not served compressed by anything today |
| Viewer chunk (`garment-viewer-*.js`, gzip) | 188.0 KB after (the final `pnpm check`; 187.7 KB before the conform step was added); 187.0 KB before (the same build at the branch point 71adc06) |
| Loader chunk (`realisticBodyLoad-*.js`, gzip) | 4.2 KB, lazy, only with the option |
| Precache | the asset and the loader are not precached (`sw.js` names neither) |
| Fit time | 100 to 250 ms per body in Node on the build container (`fitMs` in the JSON); in a browser not measured separately |

Headless Chromium 390 × 844 at 2×, SwiftShader (the CPU draws), 4 s of continuous dragging per run, three runs,
alternating before and after; "frame" = mean interval between animation frames (median of the three runs; the single
runs in `docs/screens/claude/realistic-body/renders.json`); "sync" = 60 renders in a row with a one-pixel read-back
each, body alone. Before: procedural body with head v3 (38,784 triangles on the female M); after: 27,036 triangles.

| Body | body alone, frame | body alone, sync | with the dress, frame |
|---|---|---|---|
| mid, before | 77.0 ms | 110.8 ms | 79.1 ms |
| mid, after | 63.1 ms | 96.0 ms | 73.2 ms |
| full, before | 79.1 ms | 114.5 ms | 51.9 ms (dress not drawn) |
| full, after | 48.4 ms | 100.5 ms | 46.3 ms (dress not drawn) |

The runs scatter by up to 25 ms (mid before: 55, 77, 83 ms). The after body is not slower than today's on this
renderer; what that means on a phone GPU is not known (OI-144).

## Pictures (390 × 844 CSS px at 2×, headless Chromium, SwiftShader)

Before: the procedural body with head `neutral-v3` (the embed's default head, D22). After: `body=realistic`. Same
camera, same light (`classic`), grey. "dress": the evaluated azure dress (`out/eval/azure-palm-baby-doll-dress`, the
bundle unchanged), draped on the device on the ring table; after, the skin conformed under it; `after-raw`, not
conformed. On the full body (116/98/122) the fit engine's advice blocks every drawn size of this dress, so it is not drawn
there, before or after (the viewer's own rule, `notDrawn.ts`).

Files in `docs/screens/claude/realistic-body/`: per body (`slim`, `mid`, `full`, `tall`, `petite`)
`<body>-body-before--front.png`, `<body>-body-after--front.png`, `<body>-body-before--three-quarter.png`,
`<body>-body-after--three-quarter.png`, `<body>-dress-before--front.png`, `<body>-dress-after--front.png`,
`<body>-dress-after-raw--front.png`, and the side-by-side `<body>-sheet.png`. `renders.json` holds the tags, states and
frame timings.

What I see (not the founder's judgement): the after body reads as a person-shaped body at every size (bust, waist,
seat, knees, hands, feet), where before is a lofted dummy with a seam at the hip; the shoulders are wide (they follow
the procedural body's shoulder ring and arm joints, which its README says are about 6 cm too wide); MakeHuman's nipples
and navel show on the grey body; the face is MakeHuman's, smooth, with grey eye spheres; the hands are relaxed and
open. Under the dress the conformed body is clean; the raw one shows skin through the cloth at the bust, hips and shoulder
caps.

## Measured versus assumed

Measured here: every number in the tables above; the chunk sizes (web build); the asset bytes; the pictures; the frame
intervals in headless Chromium; the tests.

Assumed or not measured:
- Phone frame time, phone fit time, phone memory: not measured. SwiftShader is a CPU renderer; its numbers say nothing
  about a phone GPU.
- That MakeHuman's default female is a fair base for every body: the shape sliders are two, solved from two ratios;
  slim and corner bodies sit at the slider's end (weight −1 or +1).
- The anatomical levels the bake picks for each ring (seat at the most backward point, neck 3 cm under the chin,
  underbust at the mannequin's share of the way from waist to chest) are our choice, not measured anthropometry.
- The arm placement follows the procedural body's arm frame (so sleeves meet the drawn arm); that frame is wider than
  a measured woman's.
- Licence: CC0 as stated in the files; not a lawyer's reading.

## What is left

- A collider from the realistic mesh (polar outlines sliced from it, as the male shape v2 has), so the cloth meets the
  drawn body and the conform step goes; that rebuilds and re-gates every women's bundle (OI-143).
- The loop or tape rule (OI-141), then possibly a fit to the tape at chest and hip.
- The founder's look review of the sheets (OI-142), including whether MakeHuman's nipples and navel stay.
- A skin: none was taken (no CC-BY or community skins in this spike); UVs exist in base.obj but are not baked (OI-146).
- Phone measurements (OI-144); self-crossing fixes (OI-147); the D3 wording and the privacy e2e for the asset's GET
  before the option is ever on (OI-145).
- The second family (male), the head and face, hair, the AI layer: out of the spike.

## Licence provenance

Every asset taken, with its source URL, commit, sha256 and the licence quoted from its own file:
`packages/garment-viewer/assets/realistic-body/PROVENANCE.md`; a row in `docs/LICENSES.md`.

- Source: https://github.com/makehumancommunity/mpfb2 at commit `9de0707fdc88438d7c53a1a2ac7937d9221e2431`.
- Taken: `src/mpfb/data/3dobjs/base.obj` (header: "This asset was explicitly released as CC0 in september 2020"),
  seven `.target.gz` files (macrodetails and breast), `rigs/standard/rig.default.json` and `weights.default.json`
  (`"license": "CC0"`). `LICENSE.md` section C: "These assets have been released under CC0 1.0 Universal", covering
  "The base mesh and proxies", "Targets and modifiers", "Rigs, poses and expressions". `LICENSE.ASSETS.md` is the CC0 1.0
  legal code.
- Not taken: any MakeHuman or MPFB code (AGPL / GPLv3), skins, hair, eyebrows, lashes, proxies, clothes; no SMPL,
  SMPL-X, FLAME, STAR, Anny (and so no `[smpl]` extra), no CC BY-NC, no CC-BY hair or skins, no NVIDIA SCL material;
  nothing from Renderpeople, TurboSquid, Free3D, CGTrader, Reallusion, Daz, Meshy or Hyper3D. No paid API, no GPU.
- The network: raw.githubusercontent.com and github.com answered; nothing was refused.

## Checks run

`pnpm check` once, at the end, on this branch: exit 0 (build of every package, typecheck, lint, every test suite, the app builds, `check-viewer-chunk`, `check-bundle-secrets`, `check-language-packs`). Before it, the touched packages alone: `@curtain/garment-viewer` test (245 passed, 4 skipped in the check), typecheck, lint; `@curtain/web` test (698 passed), typecheck, lint; `@curtain/garment-spike` typecheck and lint.

## Not verified

- Phone frame time and fit time (no phone).
- Whether the result reaches the three references (the founder has to look; two of the three reference pages could
  not be opened by the route doc either).
- The conformed mesh from every angle (front pictures only with the garment).
- The male family; the drape-bake path with the option (drawn unconformed there; not rendered).

# Realistic body spike, female family (21 Nov 2026)

Branch `claude/realistic-body` (from `claude/garment-engine`). Updated the same day after an independent review (the
"Review findings" table below); every number in this report is from after those fixes unless it says "before". The one-week spike of route B in
`docs/research/realistic-avatar-route.md` §7: the MakeHuman CC0 base mesh, baked by our own script, fitted on the device
to the ring table, drawn in the garment viewer behind an opt-in body shape that is off by default. Numbers are in
`docs/reports/claude/realistic-body-spike.json` (`packages/garment-viewer/scripts/realistic-body-report.ts`); pictures
in `docs/screens/claude/realistic-body/` (`spikes/garment-engine/viewer/realistic-body-renders.mjs`, sheets by
`realistic-body-sheets.mjs`). All work by an AI agent; the licence reading is not a lawyer's.

## Verdict

Route B is **not killed, and not passed**: "continue with named fixes".

- The girth part works far better than the bound: all 12 rings, both sides, on eleven bodies (the five test bodies,
  the two corners of the input box and four extremes) are within 0.02 % of the ring table, and of the typed bust,
  waist and hip, loop girth, measured by an independent slicer (bound 0.5 %); the small corner's thigh 0.42 %. Every
  ring centre lies inside its drawn section and the section's area centre is within 0.04 cm of it.
- The asset is small (338 KB, bound 1.5 MB) and the viewer chunk is 188.3 KB gzip, 1.3 KB more than before (bound 400 KB).
- The body alone is a clear step away from the "grey doll": real anatomy at every size (pictures below). The face is
  MakeHuman's own, untouched (D27), with grey eye spheres; no skin texture was added (none cleared for this spike).
- What fails is the outline: the realistic section is up to 1.5 to 2.4 cm outside the ring table's ellipse on the
  torso of the five bodies and 1.3 to 1.8 cm on the arm (before the review fixes 2.3 to 4.9 and 4.4 to 5.0 cm; the
  sections were off their ring centres), because a real section with the same girth as an ellipse cannot lie on it.
  With cloth that still collides with the ring table (the rule of this spike), the skin shows through the garment
  there. A display step (`conformToField`) pulls the skin inside the field where a garment covers it and then scales
  the covered skin that is inside back out until each girth is the fitted one again: the dress pictures are clean
  (0.18 to 0.25 cm outside on the torso, 0.16 cm on the arm) and the conformed chest is within 1.2 %, underbust,
  waist and hip within 0.7 % of the table (the pull alone: 1 to 3 % under), but under the garment the drawn body is
  no longer exactly the realistic one. The real fix is a collider made from the realistic mesh, which means
  rebuilding and re-gating every bundle (OI-143, a founder decision).
- Tape versus loop: at the hip the tape (convex hull) reads 1.7 to 2.8 cm under the loop on every test body, at the
  chest 0.6 to 1.8 cm; on the extremes up to 3.5 cm (hip) and 2.3 cm (chest). Over the 1.0 cm bound without a rule; a
  founder decision (OI-141).
- Not measured: anything on a phone. There is no phone here; frame times are headless Chromium with SwiftShader.

## Review findings (independent review, 21 Nov 2026)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | The girth tests measured with the fit's own slicer (`sectionAt`/`sectionOf`) against the fit's own target (`fitTargetOf`): a hip target × 1.05 or a loop length × 1.02 left 245 of 245 green | high | **fixed.** `test/realisticBodyGirth.test.ts` measures every one of the 12 rings of `buildBody` (both sides of the limbs) and the typed bust, waist and hip with an independent slicer (`test/independentSlice.ts`, the reviewer's own chaining and gift-wrap hull, no code shared with the fit) and, as a second opinion, the mannequin's `meshRingCircumference`, on eleven bodies; no nearest-loop fallback. Permanent negative controls: a hip target 5 % high fails at the hip only; a fit 2 % short everywhere (what a measure 2 % long does) fails at every ring; arms not centred fail at the wrist; no correction fails on every body. The two breaks themselves, put into the code: 18 tests fail with either (below) |
| 2 | The drawn arm was misplaced: the wrist section's centre 5 to 7 cm in front of the ring table's wrist centre (outside the wrist), upper arm 1.6 to 3.4 cm, shoulder 2.1 to 2.9 cm; the wrist passed only through `sectionAt`'s nearest-loop fallback | medium | **fixed.** The fit moves five stations of each arm (upper-arm ring to wrist ring) and every torso and leg ring's section so the centre of its area lies on the table's arm axis or centre line, in the same loop as the girth correction. Area-centre offset now 0.00 to 0.04 cm at every ring of all eleven bodies (the reviewer's measure, the mean of the loop's points: wrist 0.11 to 0.15 cm, upper arm 0.74 to 1.03 cm, shoulder 1.07 to 1.47 cm on the five bodies; that mean is pulled towards where the mesh is dense). The tests need the ring centre inside its section; `sectionAt` has a strict mode, used by `ringReport` |
| 3 | Under a garment the conform step took 2 to 5 % off the chest, 3 to 4 % off the waist, up to 2.3 % off the hip | medium | **reduced.** After the pull, the covered skin inside the field is scaled out about the section centre (never past the field) per height until each loop is the fitted mesh's again. Chest −1.2 to +0.8 %, underbust, waist and hip within 0.7 % of the table on eleven bodies (the pull alone, same zone: −1.4 to −3.1 %, −0.9 to −2.1 %, −1.2 to −2.4 %, −0.4 to −2.2 %). The arms are pulled only (upper arm up to 3.4 % under). The drawn girths, conformed when the garment is drawn, are on every picture's tag. The conformed mesh is measured by nothing but that tag (`drawnGirthsTag`, spike diagnostics); the fit, the sizes and `ringReport` use the fitted mesh |
| 4 | Look: a seam across the upper chest and a notch at the shoulder (shoulder band), the 116 cm bust drawn nearly flat (cup −0.85) with the volume in the back and shoulders, square wide shoulders; the full sheet's dress columns tagged with a dress that is not drawn | medium | **partly fixed.** The shoulder band is wider (11 cm), C2, fades out along the arm to halfway to the wrist, and the body's own scale under it is between the chest's and the neck's: the seam and the notch are gone in the new pictures. The cup is solved from chest minus underbust in cm at the solved weight (the full body: cup −0.3, the bust kept). The shoulders stay wide and square: they sit on the procedural body's arm frame (OI-149; changing it changes the collider, not allowed here). The tag and the sheet now say "NOT DRAWN: the fit engine blocks size …". Three-quarter and back pictures with the dress added |
| 5 | The loader chunk `realisticBodyLoad-*.js` was precached by the service worker; the report said it was not | low | **fixed.** `**/realisticBodyLoad-*.js` in `globIgnores` (`apps/web/vite.config.ts`); `check-viewer-chunk.mjs` fails if `sw.js` names the loader or a `.crb`. Checked on the built `dist/sw.js`. The earlier report sentence was wrong |
| 6 | Tape against loop is larger on the extremes than on the five bodies | low | **open, OI-141** (updated with the extremes; the new numbers are in the tape table below) |
| 7 | The `.crb` goes out as `application/octet-stream`, which Caddy's `encode` does not compress: 337,732 bytes on the wire | low | **open, OI-150.** Precompressed copies and `file_server { precompressed }` would do it, but the Caddyfile change could not be validated in this container (no Caddy, no Docker), so it is not made |
| 8 | The privacy e2e does not run the flag-on path; no D3 conflict found by reading | low | **open, OI-145** (updated: a flag-on e2e that asserts the one GET) |

The two breaks, put into the code and the whole `@curtain/garment-viewer` suite run (then reverted):

- `fitTargetOf` with the hip × 1.05 (`realisticBody.ts`, the `girthCm:` line): **18 failed**, 247 passed. Every
  body: `expected [ 'hip: 5.00 %' ] to deeply equal []`; the hip control: `expected [ 'hip: 10.25 %' ]`; the
  conformed hip over 1 % (1.4 to 2.1 %).
- `sectionOf` with the loop × 1.02: **18 failed**, 247 passed (`Tests 18 failed | 247 passed | 4 skipped (269)`).
  Every body: `expected [ 'neck: -1.96 %', …(17) ] to deeply equal []`; the conformed chest 1.9 to 2.6 % under.

Before the fixes, the same two breaks left the suite green (the review).

## Pass and fail (the numbers of the route doc §7)

Final, after the review fixes. Girths by the independent slicer of the tests against `buildBody`'s ring table and
the typed girths; the JSON is `docs/reports/claude/realistic-body-spike.json`.

| Check | Pass bound | Measured | Verdict |
|---|---|---|---|
| Loop girth, all 12 rings (both sides), S / M / XXL (slim, mid, full), and the typed bust, waist, hip | within 0.5 % | largest error 0.0017 % (petite neck); typed bust, waist and hip exact to 0.0001 % | **pass** |
| Loop girth, all 12 rings, tall and petite, and four extremes (165 cm 145/135/155, 166 cm 118/72/86, 162 cm 82/68/124, 160 cm 104/108/100) | within 0.5 % | at most 0.015 % | **pass** |
| Ring centre inside its drawn section, section centred on it | inside, no fallback | inside at every ring of all eleven bodies; area centre 0.00 to 0.04 cm from the ring centre | **pass** |
| Loop girth at the two corner bodies (60/45/65 at 130 cm; 160/150/170 at 220 cm, drawn at waist 147 by `BODY_INPUT_LIMITS`) | within 0.5 %, closed, no self-crossing | 0.42 % (small corner, thigh: the thighs touch, the correction converges slowly), 0.013 % (large corner, shoulder); closed (watertight, no boundary edge) at all eleven bodies; **crosses itself**: 14 triangle pairs at the toes on every body (in MakeHuman's own base mesh), 92 in all at the small corner (inner thighs), 34 at the large corner (hands at the hips), 30 at the 145/135/155 body | **fail as written**; causes named (OI-147) |
| Tape girth at bust, waist, hip | difference from loop under 1.0 cm, or a written rule | waist 0.04 to 0.17 cm; chest 0.61 to 1.82 cm (over 1.0 cm on full and tall); hip 1.73 to 2.82 cm (over on all five); extremes up to 3.47 cm (hip) and 2.27 cm (chest) | **fail until a rule is agreed** (OI-141) |
| Outline against drawn mesh, torso from the seat up and arms | at most 0.5 cm | against the collision outline the cloth meets (the ring table's ellipses): torso 1.54 to 2.35 cm outside and 2.87 to 5.04 cm inside; arm (upper-arm ring to 3 cm short of the wrist ring) 1.28 to 1.77 cm outside. Conformed under a garment: torso 0.17 to 0.25 cm outside, arm 0.16 cm (inside unchanged); 0.64 cm at the bust of the 118/72/86 body | **fail** for the fitted skin; the conformed display mesh within 0.5 cm outside on the five bodies, not inside |
| Conformed girths under a garment (review finding 3; no route-doc bound) | none set; asked: as small as possible | chest −1.21 to +0.78 %, underbust, waist and hip within 0.69 % (the pull alone: up to 3.1 % under); upper arm, pulled only, up to 3.4 % under | **reduced** |
| Viewer chunk | under 400 KB gzip | 188.3 KB gzip (`check-viewer-chunk.mjs`, final `pnpm check`); before the spike 187.0 KB (the same build at the branch point 71adc06). The loader is its own lazy chunk, 6.1 KB gzip, not precached | **pass** |
| Body asset, transferred | at most 1.5 MB for mesh and one 2K skin | 337,732 bytes, sent uncompressed today (251 KB gzipped by Node at level 6; OI-150). No skin texture (not taken, see licences) | **pass for the mesh**; the skin part is not measured |
| Frame time on a real phone, body with one garment, turning | at most 33 ms, at most 1.25 × today's body | **not measured** (no phone). Headless Chromium, SwiftShader on the CPU, 390 × 844 at 2×, mid body with the dress, turning: 106.6 ms per frame after against 77.6 ms before (median of three; 1.37 times today's; a second set: 124.7 against 75.8 ms); unconformed 72.0 against 77.2 ms. Body alone 46.1 against 78.5 ms. Not phone numbers | **not verified**; on this renderer over 1.25 × with the conformed body |
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
| Fit | `packages/garment-viewer/src/realisticBody.ts` `fitRealisticBody`: shape sliders from seat over stature (weight) and chest minus underbust in cm (cup, in [-1, 0]; OI-151); a C1 vertical warp onto the ring heights; section centres onto the table's centre lines; each arm moved rigidly onto the table's arm frame and stretched to the wrist ring; a radial scale per ring height (and per distance along the arm, and an 11 cm C2 band round the shoulder ring that fades out along the arm), corrected 8 times to target / measured, and in the same loop every torso and leg ring's section and five stations of each arm moved so their area centre is on the table's centre line or arm axis. The head takes a fifth of the neck's scale. 235 to 514 ms per body in Node (100 to 250 ms before the review fixes) |
| Display step under a garment | `conformToField` (pull inside the field, then the girth given back per height) and `coverZone` in the same file |
| Loader and drawing | `realisticBodyLoad.ts` (lazy chunk, one GET); `MountOptions.bodyShape: 'realistic-spike'` in `mount.ts` (female only; default `procedural`); `canvas.dataset.body`; `realisticBodyConform: false` for comparison pictures. Web build flag `VITE_VIEWER_BODY=realistic-spike` (`apps/web/src/embed/look.ts`, `Garment3D.tsx`) |
| Tests (ordinary suite) | `packages/garment-viewer/test/realisticBodyGirth.test.ts` (with `test/independentSlice.ts`): the typed bust, waist, hip and all 12 rings of `buildBody`, both sides, within 0.5 % on eleven bodies by an independent slicer, ring centre inside its section, section centre within 0.5 cm; the viewer's morphed body against the avatar's girths; negative controls (hip target × 1.05, a fit 2 % short, arms not centred, no correction); conformed girths. `src/realisticBody.test.ts`: the fit's own (strict) ring report, closed mesh, encoder round trip, the cup solve, the conform step, the option off by default. `apps/web/src/embed/__tests__/garment3d.test.tsx`: the flag is sent only when set, never for a men's body |
| Measurements and pictures | `scripts/realistic-body-report.ts` (girths by the tests' independent slicer); `spikes/garment-engine/viewer/realistic-body-renders.mjs`, `realistic-body-sheets.mjs`; `body=realistic` (and `conform=0`) on `avatar.html`, whose tag shows the typed and the drawn girths |

Unchanged: the ring table, the collision field (`bodyField`), the fit engine, every bundle, the procedural meshes and
their goldens, every default. The cloth collides with exactly the field it collided with before, with the option on or
off.

## Ring errors (loop), cm and %

Target girth / (loop − target) / target, measured by the independent slicer of the tests (`test/independentSlice.ts`)
against `buildBody`'s ring table, the worse side for the limbs. Female, typed height and girths: slim 164 cm
80/62/88, mid 168 cm 92/74/100, full 170 cm 116/98/122, tall 182 cm 92/74/100, petite 152 cm 84/66/92; corners 130 cm
60/45/65 and 220 cm 160/150/170 (drawn waist 147); the review's extremes very full 165 cm 145/135/155, big bust small
hip 166 cm 118/72/86, pear 162 cm 82/68/124, apple 160 cm 104/108/100.

| Ring | slim | mid | full | tall | petite | corner small | corner large | very full | big bust small hip | pear | apple |
|---|---|---|---|---|---|---|---|---|---|---|---|
| neck | 32.0 / -0.0014 % | 35.0 / -0.0007 % | 40.0 / -0.0007 % | 35.0 / -0.0003 % | 33.0 / -0.0017 % | 27.0 / -0.0091 % | 49.2 / -0.0016 % | 46.0 / -0.0061 % | 40.4 / -0.0021 % | 32.5 / -0.0003 % | 37.5 / -0.0015 % |
| shoulder | 94.0 / 0.0010 % | 102.0 / 0.0005 % | 120.0 / 0.0004 % | 102.0 / 0.0003 % | 96.7 / 0.0012 % | 80.7 / 0.0100 % | 158.4 / -0.0126 % | 151.9 / 0.0025 % | 121.5 / 0.0055 % | 95.3 / 0.0004 % | 111.0 / 0.0009 % |
| chest | 80.0 / 0.0000 % | 92.0 / 0.0000 % | 116.0 / 0.0000 % | 92.0 / 0.0000 % | 84.0 / 0.0000 % | 60.0 / 0.0000 % | 160.0 / -0.0046 % | 145.0 / -0.0011 % | 118.0 / -0.0003 % | 82.0 / 0.0000 % | 104.0 / 0.0000 % |
| underbust | 68.0 / 0.0000 % | 78.0 / 0.0000 % | 100.0 / 0.0000 % | 78.0 / 0.0000 % | 71.3 / 0.0000 % | 52.8 / 0.0000 % | 145.8 / -0.0001 % | 134.8 / -0.0001 % | 76.7 / 0.0000 % | 72.4 / 0.0000 % | 107.3 / 0.0000 % |
| waist | 62.0 / 0.0000 % | 74.0 / 0.0000 % | 98.0 / 0.0000 % | 74.0 / 0.0000 % | 66.0 / 0.0000 % | 45.0 / 0.0000 % | 147.0 / 0.0000 % | 135.0 / 0.0000 % | 72.0 / 0.0000 % | 68.0 / 0.0000 % | 108.0 / 0.0000 % |
| hip | 88.0 / 0.0000 % | 100.0 / 0.0000 % | 122.0 / 0.0000 % | 100.0 / 0.0000 % | 92.0 / 0.0000 % | 65.0 / -0.0021 % | 170.0 / 0.0000 % | 155.0 / 0.0000 % | 86.0 / 0.0000 % | 124.0 / 0.0000 % | 100.0 / 0.0000 % |
| thigh | 50.0 / -0.0002 % | 57.0 / -0.0001 % | 70.0 / -0.0002 % | 57.0 / 0.0000 % | 52.3 / -0.0001 % | 36.6 / 0.4153 % | 98.4 / 0.0000 % | 89.5 / 0.0000 % | 48.8 / -0.0002 % | 71.2 / -0.0002 % | 57.0 / -0.0001 % |
| knee | 33.0 / 0.0000 % | 36.0 / 0.0000 % | 41.0 / 0.0000 % | 36.0 / 0.0000 % | 34.0 / 0.0000 % | 27.2 / -0.0002 % | 51.9 / 0.0000 % | 48.5 / 0.0000 % | 32.5 / 0.0000 % | 41.5 / 0.0000 % | 36.0 / 0.0000 % |
| calf | 32.0 / 0.0000 % | 35.0 / 0.0000 % | 40.0 / 0.0000 % | 35.0 / 0.0000 % | 33.0 / 0.0000 % | 26.2 / -0.0001 % | 50.9 / 0.0000 % | 47.5 / 0.0000 % | 31.5 / 0.0000 % | 40.5 / 0.0000 % | 35.0 / 0.0000 % |
| ankle | 20.5 / 0.0000 % | 22.0 / 0.0000 % | 24.5 / 0.0000 % | 22.0 / 0.0000 % | 21.0 / 0.0000 % | 17.6 / 0.0000 % | 29.9 / 0.0000 % | 28.2 / 0.0000 % | 20.2 / 0.0000 % | 24.7 / 0.0000 % | 22.0 / 0.0000 % |
| upper arm | 25.0 / -0.0002 % | 28.0 / -0.0002 % | 36.0 / -0.0001 % | 28.0 / -0.0001 % | 26.0 / -0.0005 % | 20.0 / -0.0035 % | 50.7 / 0.0088 % | 45.7 / 0.0076 % | 36.7 / 0.0145 % | 25.5 / -0.0001 % | 32.0 / -0.0003 % |
| wrist | 14.5 / 0.0000 % | 15.5 / 0.0000 % | 17.0 / 0.0000 % | 15.5 / 0.0000 % | 14.8 / 0.0000 % | 12.8 / 0.0000 % | 19.8 / 0.0000 % | 18.8 / 0.0000 % | 17.1 / 0.0000 % | 14.7 / 0.0000 % | 16.2 / 0.0000 % |

Tape (convex hull, gift wrap) girth and tape − loop, cm:

| Ring | slim | mid | full | tall | petite | corner small | corner large | very full | big bust small hip | pear | apple |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chest | 79.39 / −0.61 | 91.08 / −0.92 | 114.18 / −1.82 | 90.95 / −1.05 | 83.39 / −0.61 | 59.50 / −0.50 | 158.24 / −1.75 | 143.91 / −1.09 | 115.73 / −2.27 | 81.39 / −0.61 | 103.40 / −0.60 |
| underbust | 67.88 / −0.12 | 77.71 / −0.29 | 99.65 / −0.35 | 77.92 / −0.08 | 71.07 / −0.26 | 52.69 / −0.09 | 145.28 / −0.51 | 134.23 / −0.54 | 76.49 / −0.19 | 72.12 / −0.29 | 106.86 / −0.48 |
| waist | 61.94 / −0.06 | 73.86 / −0.14 | 97.83 / −0.17 | 73.96 / −0.04 | 65.88 / −0.12 | 44.95 / −0.05 | 146.74 / −0.26 | 134.76 / −0.24 | 71.93 / −0.07 | 67.88 / −0.12 | 107.81 / −0.19 |
| hip | 86.27 / −1.73 | 97.18 / −2.82 | 119.50 / −2.50 | 97.80 / −2.20 | 89.64 / −2.36 | 63.72 / −1.28 | 166.53 / −3.47 | 151.83 / −3.17 | 84.31 / −1.69 | 121.45 / −2.55 | 97.49 / −2.51 |

Shape sliders solved (weight, cup): slim −1, −0.45; mid 0.2, −0.4; full 1, −0.3 (before the fix −0.85); tall
−0.75, −0.2; petite 0.4, −0.6; corners −1, −1 and 1, −0.55; very full 1, −1; big bust small hip −1, 0; pear 1, −1;
apple 0.45, −1. The fit's own report (`ringReport`, strict) agrees with these to 0.001 %, but it is not the check.

## Drawn mesh against the collision outline

Per station every 0.5 cm, 96 directions, the drawn section's radius minus the ellipse's (the field the cloth meets),
cm. Torso: from the hip ring to 2 cm over the chest ring (under the armpit). Arm: from the upper-arm ring to 3 cm short of
the wrist ring. Leg: ankle to thigh ring. Conformed: the whole torso (crotch to shoulder) and both arms covered.
Conformed girths: the same covered zone, error against the table, %. Review zone: 15 cm under the hip ring to 2 cm
over the chest ring, arms bare (the reviewer's `conform.mts`), the pull alone and then with the girth given back.

| Body | torso out / in | arm out / in | leg out / in | conformed: torso out, arm out | conformed girths (chest, underbust, waist, hip, upper arm), % | review zone: pull only → girth back (chest, underbust, waist, hip), % |
|---|---|---|---|---|---|---|
| slim | 1.60 / 2.87 | 1.77 / 1.09 | 1.87 / 1.47 | 0.17, 0.16 | +0.00, +0.22, +0.11, +0.13, −0.80 | −2.32, −1.53, −1.37, −2.21 → +0.43, +0.19, +0.11, +0.15 |
| mid | 1.89 / 4.17 | 1.43 / 1.46 | 2.14 / 1.22 | 0.20, 0.16 | −0.46, +0.01, +0.27, +0.26, −2.89 | −2.41, −1.17, −1.30, −0.38 → −0.50, +0.07, +0.41, +0.53 |
| full | 2.35 / 5.04 | 1.28 / 1.95 | 2.45 / 1.49 | 0.25, 0.16 | −0.06, +0.25, +0.06, +0.35, −2.28 | −2.87, −1.81, −2.33, −0.40 → −1.21, +0.30, +0.18, +0.31 |
| tall | 2.02 / 3.48 | 1.73 / 1.15 | 2.03 / 1.37 | 0.21, 0.16 | +0.54, +0.14, +0.06, +0.42, −1.25 | −2.64, −1.36, −1.41, −1.63 → +0.78, +0.14, +0.04, +0.20 |
| petite | 1.54 / 3.82 | 1.31 / 1.36 | 2.06 / 1.15 | 0.18, 0.16 | −0.21, +0.34, +0.20, +0.69, −2.96 | −2.35, −1.36, −1.43, −0.38 → −0.40, +0.10, +0.27, +0.40 |
| corner small | 0.92 / 2.12 | 1.57 / 0.92 | 1.59 / 1.82 | 0.13, 0.10 | +0.19, +0.24, +0.27, +0.54, −1.31 | −1.35, −1.70, −1.21, −2.12 → +0.58, +0.32, +0.32, +0.23 |
| corner large | 3.34 / 7.03 | 1.50 / 2.80 | 3.01 / 2.41 | 0.27, 0.15 | −0.29, +0.31, +0.10, +0.31, +0.77 | −2.89, −1.96, −2.44, −0.38 → −0.56, +0.29, +0.07, +0.54 |
| very full | 3.04 / 6.41 | 1.53 / 2.46 | 2.85 / 1.90 | 0.21, 0.20 | +0.03, +0.27, +0.17, +0.29, −0.85 | −2.70, −2.07, −2.42, −0.39 → −0.81, +0.28, +0.12, +0.33 |
| big bust small hip | 2.51 / 4.44 | 2.37 / 1.35 | 1.84 / 1.41 | 0.64, 0.17 | −0.34, +0.08, −0.04, +0.19, −1.07 | −3.07, −0.92, −1.48, −2.15 → −0.26, +0.02, +0.01, +0.23 |
| pear | 1.43 / 5.12 | 1.05 / 1.38 | 2.47 / 1.51 | 0.22, 0.16 | −0.09, +0.47, +0.17, +0.20, −2.22 | −2.44, −1.90, −2.15, −0.50 → −0.44, +0.47, +0.17, +0.20 |
| apple | 1.97 / 4.16 | 1.46 / 1.68 | 2.17 / 1.23 | 0.14, 0.17 | +0.37, +0.41, +0.33, +0.60, −3.35 | −2.12, −1.74, −1.67, −0.37 → −0.22, +0.41, +0.29, +0.46 |

Before the review fixes the torso was 2.26 to 4.85 cm and the arm 4.37 to 5.03 cm outside on the five bodies: the
sections were off their ring centres (the wrist 5 to 7 cm). Where it is now: torso outside at the bust apex and
under the armpit, inside at the front centre between the breasts and in the small of the back; arm outside at the
back of the upper arm. The conformed mesh is a display mesh; it adds 0 to 72 crossing triangle pairs (folds where the
skin was pressed onto the ellipse or scaled back out; hidden under the garment in the pictures).

## Bytes, chunk and time

| What | Measured |
|---|---|
| Asset | 337,732 bytes; 251,229 gzipped by Node (level 6). Sent uncompressed today: Caddy's `encode` does not compress `application/octet-stream` (OI-150) |
| Viewer chunk (`garment-viewer-*.js`, gzip) | 188.3 KB after the review fixes (web build and the final `pnpm check`; 188.0 KB in the first round); 187.0 KB before (the same build at the branch point 71adc06) |
| Loader chunk (`realisticBodyLoad-*.js`, gzip) | 6.1 KB (Node, level 6), lazy, only with the option (the first round said 4.2 KB; the conform's girth step and the tag's girths were added) |
| Precache | neither the asset nor the loader is precached: `**/realisticBodyLoad-*.js` is in `globIgnores` and `check-viewer-chunk.mjs` fails if `sw.js` names the loader or a `.crb`. **Correction:** the first round said "`sw.js` names neither"; it named the loader (the review found it) |
| Fit time | 235 to 514 ms per body in Node on the build container (`fitMs` in the JSON; 100 to 250 ms before the review fixes: the centring adds ten arm slices and two iterations); in a browser not measured separately |

Headless Chromium 390 × 844 at 2×, SwiftShader (the CPU draws), 4 s of continuous dragging per run, three runs,
alternating before and after; "frame" = mean interval between animation frames (median of the three runs; the single
runs in `docs/screens/claude/realistic-body/renders.json`); "sync" = 60 renders in a row with a one-pixel read-back
each, body alone. Before: procedural body with head v3 (38,784 triangles on the female M); after: 27,036 triangles.

| Body | body alone, frame | body alone, sync | with the dress, frame |
|---|---|---|---|
| mid, before | 78.5 ms | 101.3 ms | 77.6 ms |
| mid, after | 46.1 ms | 87.6 ms | **106.6 ms** (conformed) |
| full, before | 81.7 ms | 103.5 ms | 51.7 ms (dress not drawn) |
| full, after | 46.2 ms | 92.3 ms | 44.7 ms (dress not drawn) |

After the review fixes the mid body **with the dress** is slower than today's on this renderer: 97.6, 106.6 and
130.6 ms against 76.1 to 77.7 ms (1.37 times), and again in a second set of three (100.0, 124.7, 131.2 against 71.6
to 76.8 ms). The same body drawn unconformed under the dress (`conform=0`): 70.1 to 72.5 ms against 76.9 to 79.2 ms.
So it is the conformed mesh, drawn, that costs (in the first round, with the pull only, it was 73.2 against 79.1
ms); the cause is not established (a guess: after the girth is given back much more skin lies 0.25 cm under the
cloth, and SwiftShader shades and depth-tests both on the CPU). Body alone the after body is faster. The runs scatter
by up to 33 ms. What any of this means on a phone GPU is not known (OI-144).

## Pictures (390 × 844 CSS px at 2×, headless Chromium, SwiftShader)

Before: the procedural body with head `neutral-v3` (the embed's default head, D22). After: `body=realistic`. Same
camera, same light (`classic`), grey. "dress": the evaluated azure dress (`out/eval/azure-palm-baby-doll-dress`, the
bundle unchanged), draped on the device on the ring table; after, the skin conformed under it; `after-raw`, not
conformed. Front, three-quarter (the controls turned 45°) and back (180°). On the full body (116/98/122) the fit
engine's advice blocks every drawn size of this dress, so it is not drawn there, before or after (the viewer's own
rule, `notDrawn.ts`); the tag and the sheet caption say so ("NOT DRAWN: the fit engine blocks size …"). Every tag
with the realistic body carries the typed girths and the drawn ones (chest, underbust, waist, hip), conformed when the
dress is drawn.

Files in `docs/screens/claude/realistic-body/`: per body (`slim`, `mid`, `full`, `tall`, `petite`)
`<body>-body-before--front.png`, `<body>-body-after--front.png`, `<body>-body-before--three-quarter.png`,
`<body>-body-after--three-quarter.png`, `<body>-dress-before--front.png`, `<body>-dress-after--front.png`,
`<body>-dress-before--three-quarter.png`, `<body>-dress-after--three-quarter.png`, `<body>-dress-before--back.png`,
`<body>-dress-after--back.png` (the last four new in the review round), `<body>-dress-after-raw--front.png`, and the
side-by-side `<body>-sheet.png` (two rows: body; dress). The before body-alone pictures are unchanged from the first
round (the procedural body did not change); every other picture and the sheets are new.

Drawn girths on the dress pictures' tags (the mount's real cover zone of the dress, conformed), chest · underbust ·
waist · hip, typed in brackets: slim 80.2 · 68.1 · 62.1 · 88.3 (80 · 68 · 62 · 88); mid 92.2 · 78.1 · 74.3 · 100.7
(92 · 78 · 74 · 100); tall 92.0 · 78.1 · 74.0 · 100.3; petite 84.3 · 71.4 · 66.2 · 92.5 (84 · 71.3 · 66 · 92); that is
0.0 to +0.7 %. Full: the dress is not drawn, so the fitted body is (116.0 · 100.0 · 98.0 · 122.0); its conformed mesh,
not shown, would be 115.7 · 100.3 · 98.1 · 122.6. Unconformed (`-raw`): the table's girths to 0.1 cm. `renders.json` holds the tags, states and
frame timings.

What I see (not the founder's judgement): the after body reads as a person-shaped body at every size (bust, waist,
seat, knees, hands, feet), where before is a lofted dummy with a seam at the hip. Since the review fixes: no seam
across the upper chest and no notch at the arm root on the full body's three-quarter view; the full body's bust has
volume (cup −0.3, before −0.85); the arms are straight along the table's arm line (the forearm no longer bends
forward). Still: the shoulders are wide and square (they follow the procedural body's shoulder ring and arm joints,
which its README says are about 6 cm too wide; OI-149); MakeHuman's nipples and navel show on the grey body; the face
is MakeHuman's, smooth, with grey eye spheres (D27); the hands are relaxed and open. Under the dress the conformed body
is clean from the front and three-quarter, except one or two small grey patches of skin through the skirt at the
front of the upper thigh of the slim body (there in the first round too) and two to four just under the seat in every back view (keeping the given-back skin 0.2 cm inside the field did not change them, so it is not the girth step; cause not found, OI-143); the raw
one shows skin through the cloth at the bust, hips and shoulder caps.

## Measured versus assumed

Measured here: every number in the tables above; the chunk sizes (web build); the asset bytes; the pictures; the frame
intervals in headless Chromium; the tests.

Assumed or not measured:
- Phone frame time, phone fit time, phone memory: not measured. SwiftShader is a CPU renderer; its numbers say nothing
  about a phone GPU.
- That MakeHuman's default female is a fair base for every body: the shape sliders are two (weight from seat over
  stature, cup from chest minus underbust in cm, cup only in [-1, 0], OI-151); slim, full and corner bodies sit at a
  slider's end.
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
- Phone measurements (OI-144); self-crossing fixes (OI-147); the D3 wording and a flag-on privacy e2e for the asset's
  GET before the option is ever on (OI-145); serving the asset compressed (OI-150); a bust measure the cup solve can
  use (OI-151); the wide square shoulders of the procedural arm frame (OI-149).
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

Review round: `pnpm check` once, at the end, on this branch: **exit 0** (build of every package, typecheck, lint,
every test suite, the app builds, `check-viewer-chunk` 188.3 KB gzip and not precached, `check-bundle-secrets`,
`check-language-packs`); `@curtain/garment-viewer` 265 passed, 4 skipped; `@curtain/web` 698 passed. Before it: the
whole garment-viewer suite with each of the review's two breaks put into the code (18 failed each, above); the web
build with `dist/sw.js` checked for the loader; typecheck and lint of the touched packages. First round: `pnpm check`
exit 0 as well (245 garment-viewer tests).

## Not verified

- Phone frame time and fit time (no phone).
- Whether the result reaches the three references (the founder has to look; two of the three reference pages could
  not be opened by the route doc either).
- The conformed mesh from every angle: front, three-quarter and back now, not the sides, top or underneath.
- Why the conformed body with the dress draws slower on SwiftShader (above).
- The Caddyfile change for compression (OI-150): not made, could not be validated here.
- Visual checks of the extreme bodies (measured only; no pictures of them).
- The male family; the drape-bake path with the option (drawn unconformed there; not rendered).

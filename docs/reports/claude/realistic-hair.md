# Realistic hair on the realistic body spike (D28), 21 Nov 2026

Branch `claude/realistic-hair` (from `claude/realistic-body`). D28 asks for our own procedural hair, ten hair types in
four lengths, colour chosen by the shopper, stylised to match the stylised face (D27), no third-party hair asset and no
use of the founder's reference photos. This report says what was built, what it costs against the body itself, which
combinations are drawn simpler, and what was not verified. D28's text is on `claude/garment-engine` (`b172f5a`); this
branch was cut from `claude/realistic-body`, which does not have it yet, so DECISIONS.md is not changed here.

## Verdict

- **Built:** all 40 combinations (1, 2A–2C, 3A–3C, 4A–4C × short, chin, shoulder, long) in any colour, generated on
  the device from the fitted realistic body's own head, behind `MountOptions.hair` with `bodyShape: 'realistic-spike'`
  only. Off or absent: bald, as before; nothing else changes.
- **Reads as each type** at the sheet's scale (`sheet-types-lengths.png`): straight cards (1), S-waves growing from 2A
  to 2C, ringlets from loose loops (3A) to tight corkscrews with volume (3C), and coily volume with a coil texture and
  puffs for 4A–4C, where a long 4C is an afro. Up close the cards and ringlets read as ribbons (stylised, OI-172).
- **Within the bounds** of D28 on size: no asset (the hair is a 7.9 KB gzip lazy chunk, never precached), textures
  171 KB generated on the device, viewer chunk 189.1 KB gzip, triangles at most the body's own, no request.
- **Frame time: short and chin hair stay within the body's own cost; shoulder and long hair do not** on headless
  Chromium with SwiftShader (body 33 ms; shoulder +38 to +51 ms, long +51 to +63 ms). Fewer clumps did not help on
  this renderer, so nothing was thinned for it; **no real phone** was used (OI-171).
- **Drawn simpler** (fewer clumps to stay within the triangle budget): 2C long, 3A long (full body only), 3B long, 3C long (OI-174).
- **Not built:** a picker and a stored choice in the embed (OI-170). The prop goes through `Garment3D` already.

## What was built

| Part | Where | What |
|---|---|---|
| Choice | `packages/garment-viewer/src/hairOptions.ts` | `HAIR_TYPES`, `HAIR_LENGTHS`, the palette (`HAIR_COLOURS`: black, dark-brown, brown, light-brown, auburn, copper, dark-blonde, blonde, platinum, grey) and `hairOf` (a full valid choice or null). Small; the mount imports only this |
| Geometry and textures | `src/realisticHair.ts` (pure, no WebGL) | Head model from the fitted mesh (centre and a dilated radial hull from MakeHuman's head weights, so the hair follows the head's size); a polar table of the drawn body below the head (arms left out); a face box. A cap on the scalp with a ragged soft hairline. Guides grown from Fibonacci roots on the scalp, combed from a centre parting, under gravity, pushed out of the head hull and out of the body along the surface normal every step (on top of a shoulder mostly up and a little to the front or back), smoothed, cut at the length's height (chin, shoulder ring, between chest and underbust); curly hair shrinks (ends higher) and stands off (layers). Cards: straight; an S-wave in the hair's own plane (2A–2C); a card wound round the guide like a ringlet (3A–3C); coils and zig-zag coils (4A–4C) as short puffs on the outside of the volume. Shells for 3C–4C, outer ones sparser (soft edge), reaching below the hairline at the sides and back as they grow. Seeded: the same choice on the same body gives the same hair |
| Generated textures | same file, `strandTexture`, `coilTexture` | Strand card 64 × 256 (about 70 strands with their own brightness, sway, ends spread over the last fifth); coil pattern 128 × 128 tileable per type (soft base plus rings: round for 3C and 4A, kinked for 4B, tight and jagged for 4C, each ring weighted so a shell's density picks which show). RGBA8 with own mip levels whose alpha keeps level 0's coverage. Computed at run time: no file is shipped, the generator is the code |
| Drawing | `src/realisticHairDraw.ts` (three.js, the lazy chunk) | `createHair`: one group `curtain-hair`, three meshes (cap, strands, shells), `MeshPhysicalMaterial` with an anisotropic highlight along the fibre (the strand direction is the `tangent` attribute), alpha test with alpha-to-coverage, occlusion in the vertex colours (roots and inner layers darker); roughness, highlight stretch and strength per type (straight shiny, coily matte) |
| Mount | `src/mount.ts` | `MountOptions.hair`; `realisticHairOf` (only with the realistic body; female only, as the body). Started from `show()` once the realistic body is drawn, on the plain fitted mesh (the conformed one has the same head), with the asset's weights from the loader's cache (no second GET). `canvas.dataset.hair`: `loading`, the choice (` (simpler)` appended when thinned), `failed`. `exportPasses` hides the group: the AI-layer passes never carry the hair (D28: never sent) |
| Web | `apps/web/src/embed/Garment3D.tsx`, `vite.config.ts`, `scripts/check-viewer-chunk.mjs` | `hair` prop, passed only with the realistic body; `realisticHairDraw-*.js` in `globIgnores`, and the chunk check fails if `sw.js` names it |
| Pictures | `spikes/garment-engine/viewer/realistic-hair-renders.mjs`, `realistic-hair-sheets.mjs`, `avatar.html` (`hair`, `hairLength`, `hairColour`, `frame=upper`, `nobody=1`, `render=demand`) | |
| Numbers | `packages/garment-viewer/scripts/realistic-hair-report.ts` | triangles, clumps, simpler, build time per combination on the five test bodies |

## Bounds (D28)

| Bound | Measured | Pass |
|---|---|---|
| Asset size: no more than the body (337,732 B) | No asset at all: the hair is code. Its lazy chunk `realisticHairDraw-*.js` is 17,894 B (7.9 KB gzip, web build); the three source files are 60 KB together | **pass** |
| Generated textures ≤ 256 KB | 87,388 B strand card + 87,380 B coil pattern (3C–4C only) = 174,768 B (171 KB), RGBA8 with mips, in GPU memory; nothing on the wire | **pass** |
| Viewer chunk < 400 KB gzip | 189.1 KB gzip (`check-viewer-chunk.mjs`; 188.3 KB on `claude/realistic-body`: +0.8 KB for `hairOptions` and the mount hook) | **pass** |
| Lazy, not precached | `realisticHairDraw` is its own chunk, loaded by `import()` only with a valid choice on the realistic body; in `globIgnores`, and `check-viewer-chunk.mjs` fails if `sw.js` names it; not in the built `sw.js` | **pass** |
| Triangles (proxy for the body's own cost) | at most 27,036 per combination by construction; 4 combinations thinned to fit (below) | **pass** (by thinning) |
| Build time on the device | 13 to 242 ms in Node on the build container over all 200 builds (40 combinations × 5 bodies); after the body's fit, not on the first frame | not a phone number |
| Frame time: hair adds no more than the body | see the next table: chin and short do; **shoulder and long do not on this renderer** | **fail on SwiftShader**, phone not measured |

Frame time, headless Chromium with SwiftShader (CPU), 390 × 844 at 2×, full-body view, mid body, 4 s of continuous
dragging per run, two runs each, the lower of the two (the machine was shared with another agent's render jobs the
whole time; the higher runs scatter up to 520 ms and are in `docs/screens/claude/realistic-hair/renders.json`).
The body's own cost is the body alone minus the empty stage (`nobody=1`): 64.0 − 31.1 = **33 ms**. The bound is hair
≤ 33 ms on top of the body.

| Group (type measured) | short | chin | shoulder | long |
|---|---|---|---|---|
| 1 (1) | 77.4 ms, +13 | 89.0 ms, +25 | 109.9 ms, **+46** | 124.8 ms, **+61** |
| 2A–2C (2B) | 71.1 ms, +7 | 89.1 ms, +25 | 101.7 ms, **+38** | 114.9 ms, **+51** |
| 3A–3B (3B) | 75.0 ms, +11 | 95.4 ms, +31 | 107.3 ms, **+43** | 126.7 ms, **+63** |
| 3C (3C) | 84.4 ms, +20 | 96.2 ms, +32 | 115.4 ms, **+51** | 117.6 ms, **+54** |
| 4A–4C (4C) | 84.4 ms, +20 | 93.6 ms, +30 | 103.8 ms, **+40** | 117.9 ms, **+54** |

Body alone 64.0 ms, empty stage 31.1 ms. With the azure dress: 104.2 ms without hair, 132.3 ms with 1 long (+28 ms),
144.1 ms with 4C long (+40 ms).

What this says and does not say: on a CPU renderer every pixel of hair costs (alpha-to-coverage, double-sided
cards, the physical material with anisotropy, several layers), and shoulder and long hair cover far more pixels than
the head. Drawing them "simpler" by fewer clumps does not fix it here: with the triangle budget halved to 12,000,
1 long measured 113 ms and 3C long 99.6 ms against 124.8 and 117.6 ms (single best runs on the noisy machine), so
the thinning was not kept. What would cut this cost is a cheaper shader (no anisotropy, no alpha-to-coverage) or
fewer layers, at the price of the sheen and soft edges D28 asks for; whether that is needed at all can only be told
on a phone GPU, where triangle and fragment costs are of another order (OI-171). So: **shoulder and long hair do not
meet the frame-time bound on this renderer, and nothing was drawn simpler for it**; that is named here rather than
hidden.

## Drawn simpler

The triangle budget per combination is the body's own triangle count (27,036, `HAIR_TRIANGLE_BUDGET`). Over it the
build thins the clumps (shells and cap stay) until it fits and says so (`canvas.dataset.hair` ends in ` (simpler)`,
and the tile's tag shows it). Clumps per body (`realistic-hair.json`):

| Combination | mid | slim | full | tall | petite |
|---|---|---|---|---|---|
| 2C long | 197 clumps (of 201) | 201 clumps (as designed) | 173 clumps (of 201) | 181 clumps (of 201) | 201 clumps (as designed) |
| 3A long | 154 clumps (as designed) | 154 clumps (as designed) | 144 clumps (of 154) | 154 clumps (as designed) | 154 clumps (as designed) |
| 3B long | 128 clumps (of 148) | 134 clumps (of 148) | 115 clumps (of 148) | 125 clumps (of 148) | 138 clumps (of 148) |
| 3C long | 94 clumps (of 150) | 87 clumps (of 150) | 86 clumps (of 150) | 86 clumps (of 150) | 102 clumps (of 150) |

All other 36 combinations are drawn as designed on all five test bodies. 3C long is the sparsest (86 to 102 of 150
clumps; the shells keep it from looking bald). Triangles and build time of every combination
on the mid body:

| Type | short | chin | shoulder | long |
|---|---|---|---|---|
| 1 | 4,072 tri, 198 clumps, 21 ms | 8,008 tri, 229 clumps, 28 ms | 13,718 tri, 232 clumps, 69 ms | 24,316 tri, 233 clumps, 166 ms |
| 2A | 3,534 tri, 186 clumps, 22 ms | 6,614 tri, 217 clumps, 40 ms | 11,022 tri, 220 clumps, 77 ms | 19,034 tri, 220 clumps, 139 ms |
| 2B | 4,080 tri, 178 clumps, 19 ms | 7,804 tri, 210 clumps, 27 ms | 12,888 tri, 209 clumps, 60 ms | 22,678 tri, 211 clumps, 123 ms |
| 2C | 4,534 tri, 171 clumps, 15 ms | 9,328 tri, 199 clumps, 27 ms | 15,672 tri, 203 clumps, 59 ms | 26,694 tri, 197 clumps, 220 ms (simpler) |
| 3A | 3,666 tri, 129 clumps, 26 ms | 8,262 tri, 153 clumps, 33 ms | 13,454 tri, 150 clumps, 56 ms | 24,022 tri, 154 clumps, 94 ms |
| 3B | 4,508 tri, 130 clumps, 13 ms | 10,702 tri, 147 clumps, 26 ms | 17,414 tri, 149 clumps, 45 ms | 26,914 tri, 128 clumps, 162 ms (simpler) |
| 3C | 9,016 tri, 128 clumps, 39 ms | 17,100 tri, 149 clumps, 43 ms | 25,636 tri, 148 clumps, 47 ms | 26,910 tri, 94 clumps, 144 ms (simpler) |
| 4A | 8,916 tri, 196 clumps, 22 ms | 11,646 tri, 228 clumps, 22 ms | 14,004 tri, 230 clumps, 23 ms | 16,476 tri, 230 clumps, 26 ms |
| 4B | 10,276 tri, 214 clumps, 24 ms | 13,386 tri, 251 clumps, 28 ms | 17,036 tri, 250 clumps, 26 ms | 18,894 tri, 250 clumps, 29 ms |
| 4C | 12,030 tri, 227 clumps, 20 ms | 16,264 tri, 270 clumps, 25 ms | 20,370 tri, 265 clumps, 30 ms | 22,892 tri, 266 clumps, 35 ms |

## Pictures

All in `docs/screens/claude/realistic-hair/`, headless Chromium with SwiftShader, 390 × 844 CSS px at 2× per tile, mid
body (168 cm, 92 / 74 / 100), default grey skin, `classic` lighting (the skin work changes the body's material and
light on its own branch; nothing here touches them). Every tile carries the page's ESTIMATE tag with the choice.

- `sheet-types-lengths.png`: the 40 combinations, a row per type, front and back three-quarter per length, head to
  waist, one colour per type (1 dark brown, 2A blonde, 2B auburn, 2C light brown, 3A dark blonde, 3B copper, 3C brown,
  4A grey, 4B platinum, 4C black), tiles shown at half size.
- `sheet-colours.png`: 2B at shoulder length in the ten colours, front and back three-quarter.
- `sheet-dress.png` and `dress-<type>-<length>--front|three-quarter|back.png`: 4C long, 3A shoulder and 1 long in the
  evaluated azure dress (draped on the device; the bundle is the generated one of the realistic body report, copied
  into this worktree's gitignored `out/`), full body.
- The 80 tiles of the first two sheets are not committed one by one (about 30 MB); `realistic-hair-renders.mjs`
  makes them again. `renders.json` lists every picture with its tag, triangles and texture bytes.

What the pictures show (looked at, not measured): all ten types read as their type at sheet scale: 1 straight and glossy, 2A–2C S-waves getting deeper and tighter,
3A loose ringlets, 3B springy ringlets, 3C tight corkscrews with volume, 4A–4C rounded volume with coils, the long ones
an afro (4C the fullest and darkest-matte). Length reads as length for 1–3B and as volume for 3C–4C. The ten colours
are distinct (`sheet-colours.png`); black keeps a visible sheen; platinum and grey do not blow out under the
classic light. Faults seen: long straight and wavy hair slides sideways off the top of the shoulders towards the arm
and still shows a bend at the upper back from behind; long 3B and 3C fan out at the shoulders like a tent; the front
hairline is the cap's hard edge (no fringe); the ringlets and cards read as ribbons up close; 4A, 4B and 4C differ
more in volume than in pattern at this scale (OI-172). With the dress the hair lies over the dress at the back and
in front of the shoulders; no hair through the face or the body was seen.

## Tests

`packages/garment-viewer/src/realisticHair.test.ts` (20 tests): every type × length builds within the triangle budget,
finite, with at most 1 % of vertices behind the drawn body's surface by more than 3 mm (an independent check against
the mesh's own vertex normals, not the hair's hull) and none over the face; lengths order and curly shrinkage; 4C
volume grows with length and stays above the shoulders; on the petite, tall and full bodies the hair sits on that
body's head; seeded; textures ≤ 256 KB; hair code smaller than the body asset; `hairOf` and `realisticHairOf` (with the
procedural body the option changes nothing); the mount loads the hair only by `import()` and hides it in the passes;
building the hair (geometry, textures, three.js meshes) calls no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon`, and the hair modules hold no request, storage or message API. `apps/web` `garment3d.test.tsx`: the hair
prop reaches the viewer only with the realistic body.

## Measured versus assumed

Measured here: the triangles, clumps, build times (Node), texture bytes, chunk sizes (web build), the frame intervals
in headless Chromium, the pictures, the tests.

Not verified:
- Anything on a phone: frame time, build time, memory, and whether alpha-to-coverage gives soft edges there (OI-171).
  SwiftShader is a CPU renderer and the machine was shared with another agent's renders during these runs.
- That each type reads as that type to someone who has it: only looked at by me against the typing scale's wording.
- Hair under or over other garments than the azure dress, with collars or high necks (OI-173).
- The picker and storage (not built, OI-170); the flag-on privacy e2e (OI-176).

## Open issues

OI-170 (no picker or stored choice), OI-171 (no phone numbers), OI-172 (look: shoulder slide, upper-back bend, flat
cards, hard front hairline, one parting), OI-173 (hair collides with the body, not the cloth), OI-174 (four
combinations drawn simpler), OI-175 (founder: may the hair choice go with the hero render), OI-176 (flag-on privacy e2e).

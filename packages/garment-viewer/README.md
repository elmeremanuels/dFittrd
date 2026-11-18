# @curtain/garment-viewer

The overlay's optional **3D estimate** (docs/ENGINE-HANDOFF.md §On-device fitting, D16): an approved
garment bundle draped on a model built from the shopper's own girths, rendered with three.js, all
on the device.

```ts
const { mountGarmentView } = await import('@curtain/garment-viewer'); // only after the shopper's click
const view = await mountGarmentView(canvas, { baseUrl: asset.baseUrl, garment, fit, size, body: { bust, waist, hip } }); // more options: "Avatar look and body" below
view.setSize('L');
view.dispose();
```

- **Rule 4 / D15:** it takes the embed's own `FitResult` (`anchorGaps(fit, size)`) and never computes a fit.
- **D3:** the only network traffic is GETs of the five bundle files under `baseUrl`; measurements stay in memory.
- **Rule 3:** the host labels the view an estimate (`apps/web/src/embed/Garment3D.tsx`).
- WebGL2 only (`GarmentViewError('unsupported')`), drapes in module workers (`drape.worker.ts`), main
  thread fallback. Before it drapes, `checkBundle` repeats the api's check (format, QA, every size
  of the live chart graded); a failure is `GarmentViewError('incompatible')`, and the overlay keeps
  the 2D figure.

Consumed as TypeScript source (`exports: "./src/index.ts"`) so the host's Vite emits the worker
correctly. apps/web puts it in the lazy `garment-viewer` chunk (three + this package, about 150 KB
gzip; budget 400 KB, `apps/web/scripts/check-viewer-chunk.mjs`), outside the Workbox precache.

## Avatar look and body (plan slices 1 and 2, the 3D half)

```ts
const view = await mountGarmentView(canvas, {
  baseUrl, garment, fit, size,
  body: { bust, waist, hip, family: 'female', heightCm: 172, shoulderCm: 37 },
  look: { skinHex: '#a07e56' },      // default: the mid-grey mannequin
  lighting: 'neutral',                // default: 'classic', the look as before
});
view.setLook({ skinHex: '#3a312a' }); // no remount, no new drape
view.setLook(null);                   // back to grey
view.toScreen('head');                // CSS px of the face on the canvas: where the host puts its own labelled button
```

Nothing here takes, fetches, stores or sends a photo. A look is a colour value in memory; it is not part of the fit, the bundle check or any request (the only traffic stays the GETs of the bundle files). The host keeps labelling the view an estimate (rule 3).

| Option | Absent | What it does |
| --- | --- | --- |
| `look.skinHex` | grey `#8C8C8C`, the shared material of before | `#rrggbb` only (`parseSkinHex`; anything else is grey). The figure gets a material of its own (`Figure.setSkin`), so no other figure changes. A skin colour has 0.3 of the grey mannequin's white reflection (`SKIN_SPECULAR`): with the full reflection a deep tone came out 4 to 9 L* too light. The colour is not written to the DOM. |
| `look.head` | `'neutral'` | The neutral standard face of `@curtain/mannequin` (D19). `'egg'` gives the v0 head. Fixed at mount. **This is the one default that changed, for every host, without a host change** (`apps/web` `Garment3D.tsx` passes girths only and now gets the face): D19 asks for a face on every mannequin. Cost, measured: the body mesh goes from 14,880 to 30,016 triangles. Not measured: frame rate on a phone. The neck is narrowed to sit under the head where it would be wider (`fitNeckToHead`, below), and the collision field's neck with it; with the `'egg'` head the body and the field are exactly those of before (`look.test.ts`). The founder should see the head pictures before this ships: close up the face is mildly uncanny (soft features, a nose shadow that can read as a moustache from the front, a visible line where head meets neck, male and female nearly alike). |
| `body.family` | `female` | A family other than the one the bundle was draped on throws `GarmentViewError('incompatible')` (the host keeps the 2D figure). A bundle records no family yet, and a missing one is `female` (`bundleFamilyOf`), so today a `male` body never mounts. The check reads the bundle, so it runs after the bundle's files have been fetched: the host must not mount for a men's product at all (D20 point 3: men's products show "coming soon"). |
| `body.heightCm`, `body.shoulderCm` | the base body's | Either one switches the avatar from the morphed base mesh to `buildBody` (`buildTypedAvatar`), the only path that honours them. Without them the body is the morphed base mesh of before. Held silently between 130 and 220 cm (`BODY_INPUT_LIMITS` of `@curtain/mannequin`): 120 draws a 130 cm body, 260 a 220 cm one; zero, negative or non-numeric values count as not given. The girths are held to bust 60 to 160, waist 45 to 150, hip 65 to 170 cm (`MEASUREMENT_LIMITS`). No error is raised, so the host validates what the shopper types. |
| `body.chest` | | The same measurement as `bust`; wins when both are given. |
| `lighting` | `'classic'` | `'neutral'`: white lights, a grey ground bounce and a tone curve that leaves colours alone below the highlights. `'neutral-v2'`: the same lights, plus a thin outline where bare skin meets the backdrop or the floor and a soft contact shadow under the feet (below, "Lighting neutral-v2"). Anything else is `classic` (`lightingOf`). Both change how every garment looks: **not switched on anywhere until the founder approves them from the pictures.** |
| `look.head: 'neutral-v2'` | | Head v2 of `@curtain/mannequin` (open eyes, brows, ears, a jaw and brow per family, no neck seam; its README). Opt-in for the look review; the default head is still `'neutral'`. The mesh carries a shade per vertex (brows, lash line, iris), drawn as a vertex colour that multiplies the skin colour. Its tube on the neck follows the neck's girth scale and the neck fit (`tubeWeight` in `body.ts`). |

**The neck under the neutral head.** The head takes a fifth of the neck's girth scale (`HEAD_SCALE_SHARE`; a head does not grow with the bust) and scales with a typed height, while the neck ring follows the bust. On large or short bodies the neck column was therefore wider than the head and the chin sat in a collar (measured at the jaw, half-widths: bust/waist/hip 150/140/160 neck 9.6 cm against head 7.55; the same girths at 150 cm 8.0 against 6.0; the 130 cm body 5.8 against 5.2). `fitNeckToHead` now narrows the torso's sections above the shoulder ring so that the neck at the jaw is at most 0.9 of the head's half-width there (`NECK_TO_HEAD`; the base body has 0.88 and is not touched): after it, 6.8 against 7.55, 5.4 against 6.0 and 4.7 against 5.2. The collision field and `rings.neck` follow the drawn neck. `look.test.ts` checks it over the girth limits, heights from 130 to 220 cm and both families. What it does not do: make the head bigger. On the largest bodies the head is small for the body; that is the mannequin's proportion rule, not a measurement of anyone.

**The tap target on the head (accessibility).** `toScreen('head')` returns a point and nothing else: the package draws no control and the canvas has no accessible name of its own. D19 puts the avatar prompt behind a tap on the avatar, so the host renders a real `<button>` with a visible or `aria-label` name at that point, at least 44 × 44 CSS px (the head itself is about 60 px high on a 390 × 760 canvas), keyboard reachable, and repositions it when the view turns or zooms. Not built here.

**A typed height.** The garment keeps its own lengths and hangs from the shoulder ring (the waist ring for a bottom). The drape runs against the drawn body moved down by the difference of that level (`liftField`), and the garment is drawn that much higher, so on a taller body the hem ends higher on the leg and the cloth collides with the body it is drawn on (`look.test.ts` drapes the synthetic dress on a 182 cm and a 156 cm body and checks it; drawn at the lift but draped on the bundle body, the cloth was inside the body in many places). Limits: the grading and the pins are still placed on the bundle's body; the drape's floor stays where that body stood, so a hem that reaches the floor on a shorter body passes through it and is hidden by the floor; a typed shoulder width moves the arms, but a sleeve is still graded about the bundle body's arm axis. An estimate, like the rest.

**Neutral lighting, measured.** `classic` is ACES tone mapping with a warm ground bounce. `neutral` (`LIGHTING_RIGS`, `TRUE_TONE_GLSL`) is set so that a matt surface facing the camera gets irradiance π, which three.js renders as the surface's own colour (`frontIrradiance`, unit-tested), and its tone curve is the highlight roll-off of the Khronos PBR Neutral curve without that curve's offset in the darks (with the offset, three's `NeutralToneMapping`, the deep tone came out darker and yellower: Δb* +2.4 to +4.4). `spikes/garment-engine/viewer/avatar-renders.mjs` renders the pilot skirt and the azure dress through this package at Monk 2, 6 and 9 in both lightings and compares the median colour of 7 × 7 px patches at **four chosen points** of bare skin (forehead, neck, forearm, shin) with the requested colour. This is a best case, not an average over the visible skin: two of the points face the camera, and the sides of the limbs and everything turned away from the light are darker and are in no row of the table. Run of 14 Nov 2026, headless Chromium with SwiftShader (a software renderer, 390 × 760 CSS px at 2×; not a phone, not a calibrated display):

ΔE2000 per patch, with (ΔL*, Δa*, Δb*), rendered minus requested, on the azure dress (the skirt gives the same forehead, neck and forearm values; it covers the shin):

| Tone | Lighting | Forehead | Neck | Forearm | Shin | Mean of the four points, ΔE2000 | Mean of the four, ΔE76 | Max of the four, ΔE2000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| light #f3e7db | classic | 5 (-4.7, -1.6, -4.4) | 5.5 (-6.1, -1.6, -4.3) | 6.8 (-9.2, -0.9, -4.1) | 6.6 (-8.8, -0.9, -4.1) | 6.0 | 8.5 | 6.8 |
| light #f3e7db | neutral | 1.7 (+2.8, +0, +0) | 1.5 (+2.4, -0.2, +0.4) | 1.1 (-1.8, +0, +0) | 0.6 (-1.1, +0, +0) | 1.2 | 2.0 | 1.7 |
| medium #a07e56 | classic | 5.1 (+5.4, -0.6, +2.8) | 3 (+2.7, -0.4, +3.1) | 2.7 (-2.6, +0.7, +2.7) | 2.2 (-1.8, +0.5, +3.2) | 3.2 | 4.4 | 5.1 |
| medium #a07e56 | neutral | 5.1 (+5.6, +0.7, +1) | 3.3 (+3.5, +0.1, +0.3) | 1 (-0.8, -0.2, -1.2) | 0.6 (-0.5, -0.3, -0.7) | 2.5 | 2.9 | 5.1 |
| deep #3a312a | classic | 3.8 (-5.6, +0.2, +0.3) | 4.8 (-7, +0.4, -0.3) | 6.8 (-10.2, -0.5, -0.5) | 6.7 (-10.1, +0, -0.3) | 5.5 | 8.2 | 6.8 |
| deep #3a312a | neutral | 3.6 (+5, -0.1, -0.2) | 2.6 (+3.6, -0.1, -0.2) | 0.9 (+0.9, +0.2, -0.7) | 0.9 (+0.9, +0.2, -0.7) | 2.0 | 2.8 | 3.6 |
| grey #8c8c8c | classic | 5.7 (+6.6, +0.4, +0.1) | 3.4 (+3.8, +0, +0) | 1.5 (-1.5, +0.2, +0.7) | 1.2 (-1.1, +0.2, +0.7) | 3.0 | 3.3 | 5.7 |
| grey #8c8c8c | neutral | 5.6 (+6.5, +0, +0) | 3.7 (+4.2, +0, +0) | 0.3 (-0.4, +0, +0) | 0 (+0, +0, +0) | 2.4 | 2.8 | 5.6 |

What the numbers say. In `classic` a light skin is rendered 5 to 9 L* darker and greyer (Δb* about −4) and a deep skin 6 to 10 L* darker; the hue of the medium tone moves about 3 b*. In `neutral` the hue and chroma stay within about 1 a*, b* of the request in every patch, and the patches that face the camera (forearm, shin) are within ΔE2000 1.1. The forehead and the neck are 2.4 to 5.6 L* lighter than asked in `neutral`: they tilt up towards the key light. That is shading, it is the same in `classic`, and it is why the mean is not zero. **Open before `neutral` is switched on: light skin against the background.** In `neutral` a light skin is rendered in its own colour, and that colour is almost the page's: `#f3e7db` on the background `#F5EFE7` is a contrast ratio of about 1.06:1 (deep `#3a312a`: about 11:1; medium `#a07e56`: about 3.3:1). In the pictures the bare arms, legs and head of the light tone barely separate from the page. `classic` hides this only by greying the skin. Nothing here fixes it; it needs a design decision (a darker backdrop for the neutral rig, a ground shadow or an edge line) and a new set of pictures.

**The tone curve is installed globally.** `installTrueTone` writes the curve into three.js's one custom tone-mapping slot (`THREE.ShaderChunk`), so another three.js renderer on the same page that uses `CustomToneMapping` would get it too; renderers with any other tone mapping are not affected. If the slot is missing (a three.js upgrade that renames it) the stage falls back to three's `NeutralToneMapping` instead of rendering without a roll-off; `look.test.ts` guards the slot for the pinned version (r186).

Not measured: garment colours against the shop photos (the bundle textures are baked from photos lit by the shop), any real phone, any display profile.

## Lighting neutral-v2 and head v2 (the look review of 18 Nov 2026)

**Why.** Under `neutral` a light skin is drawn in its own colour, which is almost the cream backdrop's: the figure's arms, legs and head barely separate from the page. Measured along the silhouette (below), Monk 1 to 3 have 1.4 to 1.5:1 at the median, Monk 5 2.1:1, and 94 to 96 % of the edge of Monk 1 to 3 is under 3:1.

**What it is.** `neutral-v2` keeps `neutral`'s lights and tone curve, so skin and garment pixels are the `neutral` ones, and adds two things (`LOOK_EXTRAS`):
- an **outline** 1.25 CSS px wide where bare skin meets the backdrop or the floor, never where it meets the garment. A second render writes a mask (skin / garment / backdrop) and a screen pass draws the line on backdrop pixels next to skin, anti-aliased; both only cover the skin's box on screen, and the line is left out while the shopper drags (below, frame cost). Its colour is the skin colour darkened, same hue, until it stands out 4.5:1 from the cream and from the floor as it comes out on screen (`outlineColour`, `FLOOR_SEEN_HEX`): a grey-brown on Monk 1 to 6 and on the default grey, a darker brown on Monk 7, no line at all on Monk 8 to 10, which stand out by themselves. This is the rule of the 2D figure's `figureOutline`, with a higher target: a line chosen for 3.2:1 left 28 to 36 % of the edge under 3:1, because the line is anti-aliased and the skin at the silhouette is shaded darker than its swatch.
- a **contact shadow**: a soft dark spot (32 %) on the floor under the feet.

**Options tried and dropped** (all on `neutral`, same measurement): a backdrop panel behind the figure darkened until it stands out 3.2:1 from the skin swatch (`backdrop: 'adaptive'`): Monk 1 needs a mid grey (`#7f7b77`-ish) behind it, which turns the whole view grey, and the silhouette still measured only 1.8:1 at the median because the shaded edge of the skin is darker than the swatch; a rim light from behind each side (`rim: 1.2`): it brightens the edges of a light skin towards the cream and makes it worse (Monk 1: 1.1:1); the contact shadow alone: grounds the feet, does nothing for the arms and head. They stay in the code (`LookExtras`) for that comparison only; hosts cannot reach them except through `MountOptions.lookExtras`, which is documented as not for hosts.

**Head v2** (`look.head: 'neutral-v2'`, `@curtain/mannequin` `headV2.ts`): see that package's README for the geometry. In the viewer the head part takes the calm head scale as before, while the tube it has on the neck follows the neck's girth scale and the neck fit, blended over the lowest fifth of the head (`tubeWeight`); `fitNeckToHead` measures the jaw only above the tube. `look.test.ts` checks that the tube stays 0 to 6 mm outside the neck between the neck ring and the chin on bodies from 60/45/65 to 150/140/160 cm girths and that the mesh stays closed at 130 to 220 cm.

**Measured** (18 Nov 2026, `spikes/garment-engine/viewer/look-v2-renders.mjs`, headless Chromium on SwiftShader, a software renderer: not a phone, not a calibrated display). *Silhouette contrast*: the body alone at phone size (390 × 760 CSS px at 2×), a skin mask from a second render, and at every edge pixel of the skin the stronger of two WCAG contrasts: the skin just inside against what is just outside (the line, where there is one), and that against the backdrop 6 to 9 CSS px further out. Median, 10th percentile, and the share of edge pixels under 3:1. *Skin ΔE*: CIEDE2000 of four front-facing patches (forehead, neck, forearm, shin) against the swatch, mean (max). Female body, today's head; the male body gave the same numbers within 0.2.

| Monk | classic: median / p10 / under 3:1 | neutral | **neutral-v2** | neutral-v2 line | skin ΔE classic | neutral and neutral-v2 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 `#f6ede4` | 1.49 / 1.16 / 94 % | 1.42 / 1.02 / 96 % | **4.91 / 3.86 / 5.5 %** | `#605c59` | 6.1 (7.0) | 0.9 (1.2) |
| 2 `#f3e7db` | 1.54 / 1.18 / 93 % | 1.48 / 1.02 / 94 % | **4.89 / 3.76 / 5.6 %** | `#615c58` | 6.0 (6.8) | 1.2 (1.7) |
| 3 `#f7ead0` | 1.52 / 1.17 / 93 % | 1.45 / 1.02 / 95 % | **5.00 / 3.90 / 5.3 %** | `#605b51` | 7.5 (7.9) | 0.9 (1.1) |
| 4 `#eadaba` | 1.67 / 1.25 / 89 % | 1.65 / 1.08 / 92 % | **4.91 / 3.62 / 5.6 %** | `#625c4e` | 6.5 (6.6) | 2.0 (3.4) |
| 5 `#d7bd96` | 2.05 / 1.45 / 82 % | 2.08 / 1.36 / 78 % | **4.89 / 3.56 / 6.6 %** | `#675b48` | 4.6 (5.5) | 2.4 (5.0) |
| 6 `#a07e56` | 4.18 / 2.60 / 22 % | 3.76 / 2.55 / 28 % | **4.82 / 3.52 / 7.0 %** | `#72593d` | 3.3 (5.1) | 2.5 (5.1) |
| 7 `#825c43` | 6.62 / 4.27 / 0 % | 5.28 / 3.76 / 0 % | **4.80 / 3.50 / 7.1 %** | `#7a563f` | 4.2 (5.5) | 2.3 (4.9) |
| 8 `#604134` | 9.36 / 7.06 / 0 % | 7.05 / 5.45 / 0 % | **6.96 / 5.33 / 0 %** | none | 5.2 (6.7) | 2.0 (3.8) |
| 9 `#3a312a` | 11.6 / 9.42 / 0 % | 8.80 / 7.09 / 0 % | **8.72 / 6.91 / 0 %** | none | 5.5 (6.8) | 2.0 (3.6) |
| 10 `#292420` | 12.9 / 10.4 / 0 % | 10.0 / 8.23 / 0 % | **9.97 / 7.95 / 0 %** | none | 5.3 (6.3) | 2.4 (3.6) |
| grey `#8c8c8c` | 3.69 / 2.32 / 37 % | 3.41 / 2.31 / 40 % | **4.92 / 3.58 / 6.5 %** | `#5c5c5c` | 2.9 (5.7) | 2.4 (5.6) |

What it says: with `neutral-v2` every tone's silhouette has a median of 4.8:1 or more and its 10th percentile at 3.5:1 or more; 5 to 7 % of the edge pixels of Monk 1 to 7 are still under 3:1 (where they are was not looked into: assumed the anti-aliased ends of the line at the fingertips, the feet and where the line meets the floor's horizon). The other options, same table: outline chosen for 3.2:1 median 3.5, under 3:1 28 to 36 %; contact shadow alone as `neutral`; adaptive backdrop Monk 1 to 5 1.8 to 2.0 median, 85 to 92 % under 3:1, grey 2.25; rim lights worse than `neutral` (Monk 1 1.10, 99 % under 3:1). Skin ΔE is the same in `neutral` and `neutral-v2` (the lights are the same); in `neutral` it is about 1 on Monk 1 to 3 and 2 to 2.5 on the others (the forehead and neck tilt up to the key light; the forearm and shin are within 1.1).

*Garment colours* (median of 9 × 9 px patches on the garment: hip, thigh, and on the dress bust and waist; ΔE2000 against `neutral` at the same patch): `neutral-v2` against `neutral` **0.0 at every patch** of the azure dress, the crimson POM skirt (a drape bake) and the photo skirt, for all five tones (the pixels are identical: the outline is never drawn over the garment). `classic` against `neutral`, mean / max over the patches per tone: azure dress 2.4 to 3.7 / 4.0 to 5.8, POM skirt 4.2 / 4.7, photo skirt 3.5 to 4.3 / 5.1 to 6.2: `classic` is darker. (The dress's knee patch is below the hem, on the skin, and is left out. The dress's numbers vary by tone because each lighting is its own mount and drape, so the cloth is not in exactly the same place; the bake skirt's do not.) What the eye does with a darker line next to a light garment is not measured.

*Frame cost* in the throttled phone page (412 × 915 CSS px at 2×, DevTools CPU throttle 4×; SwiftShader renders on the CPU, so a fragment-heavy pass costs far more here than on a phone GPU; a phone was not measured). Body alone, ms per frame (each frame read back), turning as a drag does:

| head | classic | neutral | neutral-v2 while dragging | neutral-v2 still frame (with the line) |
| --- | --- | --- | --- | --- |
| v1 (`neutral`, 30,016 triangles) | 100 | 95 | 106 | 370 to 460 |
| v2 (`neutral-v2`, 60,672 triangles) | 129 | 131 | 142 to 158 | 390 to 500 |

In the mount with the azure dress, dragging for 6 s: 8.3 frames per second (classic, head v1), 7.4 (neutral-v2, head v1), 7.9 (classic, head v2), 7.3 (neutral-v2, head v2). The line's two passes (a mask render and a screen pass, both limited to the skin's screen box) make a still frame four to five times as slow on SwiftShader; that is why the line is left out while the finger is on the view and drawn again from the moment it lifts (`Stage.render`, controls `start`/`end`) and on the frame the view stops on. Head v2 costs about 30 % more per frame on the body alone and about 5 % in the mount, where the garment dominates.


## A drape bake (server drapes, blended on the device)

A bundle whose anchors.json says `"drapeBake": "base.glb"` is not draped on the device
(docs/research/step3-serverdrape-spike.md §10). Its base.glb holds, per size, the garment draped on the server on a
few chart bodies of one size-chart axis (the hip line), as int16 morph targets (KHR_mesh_quantization,
EXT_meshopt_compression; `drapeBakeRead.ts` reads it, loaded by `import()` only for a bake; `drapeBakeWrite.ts` writes
it and is never imported by the embed; `drapeBake.ts` holds the format and the pure blend). On mount the view blends every size to the shopper's hip (`bakeWeights`: piecewise linear between the two
nearest bodies, held at the outermost one beyond them, no extrapolation), lays the particles the blend leaves inside
the drawn avatar back out of it and the hem on the floor (`settleOnBody`, the drape's collider), and is `settled` at
once; a size switch is a buffer copy. The five bundle files and the gate are unchanged.

- The bake must be draped on the body the device draws: the POM bake is draped on `buildAvatar` of each chart body
  (`spikes/garment-engine/viewer/scripts/serverdrape/avatar-bodies.ts`), not on the Anny bodies of §9 (§10 says why).
- There is no texture: the garment is drawn in the bake's `plainColourHex`. `GarmentView.source` says so
  (`{ kind: 'bake', plainColour: true, sizes }`, per size `provenance` measured / interpolated / extrapolated and
  `place` (`bakePlace`): `within` the draped bodies, `held` on the nearest one, `between` the last draped body and one
  the simulation could not dress in that size, or `refused` at or past such a body (`notDraped`): the size is then
  not drawn on the shopper, and `refusedHipCm` names that body's hip). The host prints it under the estimate label
  (`apps/web` `Garment3D.tsx`). An on-device view says `{ kind: 'device' }`.
- A bake is draped on the girth avatar: with a typed body (height, shoulders) it is `GarmentViewError('incompatible')`.
- The import gate admits a bake only flagged `tape_built_no_chart_check` (`qa.json` `chartAgreement.kind: 'tape-built'`):
  its QA pass is not a measured chart agreement.
- The reader and its meshopt decoder are a separate lazy chunk (`drapeBakeRead`, 8.3 KB gzip), not in the viewer chunk
  (159.6 KB gzip of the 400 KB budget) and not precached.

## Fork of the spike

`src/core/*` (`garment`, `grading`, `waistband`, `tape`, `weld`, `types`) and the device modules
in `src/` (`bundle`, `body`, `fitting`, `engine`, `cloth`, `collide`, `drapeJob`, `drapePool`,
`drape.worker`, `scene` without Line2/outlines) are copied from `spikes/garment-engine`, which is
left untouched. `test/parity.test.ts` checks the fork against the spike (chains, grading of every
size, top edge, weld) on the synthetic `aalter-studio-2` bundle, and `src/look.test.ts` does the same for the lighting rigs, the skin
material, the typed body and the neck fit (`scene.ts` and `body.ts` carry the same changes in both places); the tests copied from the spike
(`cloth`, `engine`, `fitting`) still pass. Deduplicate when the spike is promoted.

## What is tested where

`look.test.ts` covers what `mountGarmentView` decides before any WebGL through `planAvatar` (the
family guard, the head default, the garment lift, the head point, out-of-range input), the camera
frame for tall bodies (`cameraFrame`) and the projection behind `toScreen` (`projectToCanvas`).
The mount itself needs WebGL2 and is not run by `pnpm check`: `setLook` on a live view, the state
attributes and the real canvas are exercised only by `spikes/garment-engine/viewer/avatar-renders.mjs`
(headless Chromium), by `apps/web/e2e/avatar3d.spec.ts` (the embed's production build with the
pilot skirt, where that bundle is present; not part of `pnpm check` either) and by hand.

**A lost WebGL context.** A settled view stops drawing. When the browser takes the WebGL context
away and gives it back (a tab put to sleep on a phone, a GPU reset), three.js rebuilds its state
but nothing drew again, so the canvas stayed blank under its estimate label. The mount now listens
for `webglcontextrestored` (`contextRestore.ts`) and draws the current size again. In `pnpm check`:
`contextRestore.test.ts` tests that listener (it draws on every restore and stops on dispose) and
reads `mount.ts` to see that the mount still uses it; that is a guard against the wiring being
dropped, not a test of the picture. The picture is tested only by `avatar3d.spec.ts`, which is
skipped where the bundle is absent (CI included): it loses and restores the context of the mounted
view three times (with a picked skin colour, in the standard colour, after a switch to another
size) and compares each picture with the one before (it was blank before this change: 197,882 of
488,032 pixels differed, as reported by the first run and not repeated since; now none beyond the
tolerance). Not handled: a
context that is never restored; the canvas then stays blank and the state stays `settled`.

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
| `body.family` | `female` | A family other than the one the bundle was draped on throws `GarmentViewError('incompatible')` (the host keeps the 2D figure, or for a `required` men's view shows coming soon). Since slice M1 a bundle built on the male mannequin says so in anchors.json and qa.json (`mannequin.family: 'male'`); a missing family is `female` (`bundleFamilyOf`). The device check (`checkBundle` → `garmentBundleFor`) also refuses a bundle whose family is not the garment's (`audience: 'men'` → male, else female), so a men's garment mounts only as `family: 'male'` on a male-built bundle, and nothing mounts across families. The check reads the bundle, so it runs after the bundle's files have been fetched. The male body as drawn today is the lofted v0 family (`@curtain/mannequin`): see the M1 pictures in `docs/research/men-3d-plan.md` for how it looks. |
| `body.heightCm`, `body.shoulderCm` | the base body's | Either one switches the avatar from the morphed base mesh to `buildBody` (`buildTypedAvatar`), the only path that honours them. Without them the body is the morphed base mesh of before. Held silently between 130 and 220 cm (`BODY_INPUT_LIMITS` of `@curtain/mannequin`): 120 draws a 130 cm body, 260 a 220 cm one; zero, negative or non-numeric values count as not given. The girths are held to bust 60 to 160, waist 45 to 150, hip 65 to 170 cm (`MEASUREMENT_LIMITS`). No error is raised, so the host validates what the shopper types. |
| `body.chest` | | The same measurement as `bust`; wins when both are given. |
| `lighting` | `'classic'` | `'neutral'`: white lights, a grey ground bounce and a tone curve that leaves colours alone below the highlights. Changes how every garment looks: **not switched on anywhere until the founder approves it from the pictures.** |

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

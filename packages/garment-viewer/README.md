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
view.toScreen('head');                // CSS px of the face on the canvas (tap target, chip)
```

Nothing here takes, fetches, stores or sends a photo. A look is a colour value in memory; it is not part of the fit, the bundle check or any request (the only traffic stays the GETs of the bundle files). The host keeps labelling the view an estimate (rule 3).

| Option | Absent | What it does |
| --- | --- | --- |
| `look.skinHex` | grey `#8C8C8C`, the shared material of before | `#rrggbb` only (`parseSkinHex`; anything else is grey). The figure gets a material of its own (`Figure.setSkin`), so no other figure changes. A skin colour has 0.3 of the grey mannequin's white reflection (`SKIN_SPECULAR`): with the full reflection a deep tone came out 4 to 9 L* too light. The colour is not written to the DOM. |
| `look.head` | `'neutral'` | The neutral standard face of `@curtain/mannequin` (D19). `'egg'` gives the v0 head. Fixed at mount. **This is the one default that changed**: every 3D view now has a face. The drape does not: the head is not in the collision field. |
| `body.family` | `female` | A family other than the one the bundle was draped on throws `GarmentViewError('incompatible')` (the host keeps the 2D figure). A bundle records no family yet, and a missing one is `female` (`bundleFamilyOf`), so today a `male` body never mounts. D20 point 3 stands above this: men's products show "coming soon". |
| `body.heightCm`, `body.shoulderCm` | the base body's | Either one switches the avatar from the morphed base mesh to `buildBody` (`buildTypedAvatar`), the only path that honours them. Without them the avatar is built exactly as before. |
| `body.chest` | | The same measurement as `bust`; wins when both are given. |
| `lighting` | `'classic'` | `'neutral'`: white lights, a grey ground bounce and a tone curve that leaves colours alone below the highlights. Changes how every garment looks: **not switched on anywhere until the founder approves it from the pictures.** |

**A typed height.** The garment keeps its own lengths and hangs from the shoulder ring (the waist ring for a bottom). The drape runs against the drawn body moved down by the difference of that level (`liftField`), and the garment is drawn that much higher, so on a taller body the hem ends higher on the leg and the cloth collides with the body it is drawn on (`look.test.ts` drapes the synthetic dress on a 182 cm and a 156 cm body and checks it; drawn at the lift but draped on the bundle body, the cloth was inside the body in many places). Limits: the grading and the pins are still placed on the bundle's body; the drape's floor stays where that body stood, so a hem that reaches the floor on a shorter body passes through it and is hidden by the floor; a typed shoulder width moves the arms, but a sleeve is still graded about the bundle body's arm axis. An estimate, like the rest.

**Neutral lighting, measured.** `classic` is ACES tone mapping with a warm ground bounce. `neutral` (`LIGHTING_RIGS`, `TRUE_TONE_GLSL`) is set so that a matt surface facing the camera gets irradiance π, which three.js renders as the surface's own colour (`frontIrradiance`, unit-tested), and its tone curve is the highlight roll-off of the Khronos PBR Neutral curve without that curve's offset in the darks (with the offset, three's `NeutralToneMapping`, the deep tone came out darker and yellower: Δb* +2.4 to +4.4). `spikes/garment-engine/viewer/avatar-renders.mjs` renders the pilot skirt and the azure dress through this package at Monk 2, 6 and 9 in both lightings and compares the median colour of 7 × 7 px patches of bare skin with the requested colour. Run of 14 Nov 2026, headless Chromium with SwiftShader (a software renderer, 390 × 760 CSS px at 2×; not a phone, not a calibrated display):

ΔE2000 per patch, with (ΔL*, Δa*, Δb*), rendered minus requested, on the azure dress (the skirt gives the same forehead, neck and forearm values; it covers the shin):

| Tone | Lighting | Forehead | Neck | Forearm | Shin | Mean ΔE2000 | Mean ΔE76 | Max ΔE2000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| light #f3e7db | classic | 5 (-4.7, -1.6, -4.4) | 5.5 (-6.1, -1.6, -4.3) | 6.8 (-9.2, -0.9, -4.1) | 6.6 (-8.8, -0.9, -4.1) | 6.0 | 8.5 | 6.8 |
| light #f3e7db | neutral | 1.7 (+2.8, +0, +0) | 1.5 (+2.4, -0.2, +0.4) | 1.1 (-1.8, +0, +0) | 0.6 (-1.1, +0, +0) | 1.2 | 2.0 | 1.7 |
| medium #a07e56 | classic | 5.1 (+5.4, -0.6, +2.8) | 3 (+2.7, -0.4, +3.1) | 2.7 (-2.6, +0.7, +2.7) | 2.2 (-1.8, +0.5, +3.2) | 3.2 | 4.4 | 5.1 |
| medium #a07e56 | neutral | 5.1 (+5.6, +0.7, +1) | 3.3 (+3.5, +0.1, +0.3) | 1 (-0.8, -0.2, -1.2) | 0.6 (-0.5, -0.3, -0.7) | 2.5 | 2.9 | 5.1 |
| deep #3a312a | classic | 3.8 (-5.6, +0.2, +0.3) | 4.8 (-7, +0.4, -0.3) | 6.8 (-10.2, -0.5, -0.5) | 6.7 (-10.1, +0, -0.3) | 5.5 | 8.2 | 6.8 |
| deep #3a312a | neutral | 3.6 (+5, -0.1, -0.2) | 2.6 (+3.6, -0.1, -0.2) | 0.9 (+0.9, +0.2, -0.7) | 0.9 (+0.9, +0.2, -0.7) | 2.0 | 2.8 | 3.6 |
| grey #8c8c8c | classic | 5.7 (+6.6, +0.4, +0.1) | 3.4 (+3.8, +0, +0) | 1.5 (-1.5, +0.2, +0.7) | 1.2 (-1.1, +0.2, +0.7) | 3.0 | 3.3 | 5.7 |
| grey #8c8c8c | neutral | 5.6 (+6.5, +0, +0) | 3.7 (+4.2, +0, +0) | 0.3 (-0.4, +0, +0) | 0 (+0, +0, +0) | 2.4 | 2.8 | 5.6 |

What the numbers say. In `classic` a light skin is rendered 5 to 9 L* darker and greyer (Δb* about −4) and a deep skin 6 to 10 L* darker; the hue of the medium tone moves about 3 b*. In `neutral` the hue and chroma stay within about 1 a*, b* of the request in every patch, and the patches that face the camera (forearm, shin) are within ΔE2000 1.1. The forehead and the neck are 2.4 to 5.6 L* lighter than asked in `neutral`: they tilt up towards the key light. That is shading, it is the same in `classic`, and it is why the mean is not zero. Not measured: garment colours against the shop photos (the bundle textures are baked from photos lit by the shop), any real phone, any display profile.

## Fork of the spike

`src/core/*` (`garment`, `grading`, `waistband`, `tape`, `weld`, `types`) and the device modules
in `src/` (`bundle`, `body`, `fitting`, `engine`, `cloth`, `collide`, `drapeJob`, `drapePool`,
`drape.worker`, `scene` without Line2/outlines) are copied from `spikes/garment-engine`, which is
left untouched. `test/parity.test.ts` checks the fork against the spike (chains, grading of every
size, top edge, weld) on the synthetic `aalter-studio-2` bundle, and `src/look.test.ts` does the same for the lighting rigs, the skin
material and the typed body (`scene.ts` and `body.ts` carry the same changes in both places); the tests copied from the spike
(`cloth`, `engine`, `fitting`) still pass. Deduplicate when the spike is promoted.

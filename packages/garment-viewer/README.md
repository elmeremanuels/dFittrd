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
| `lighting` | `'classic'` | `'neutral'`: white lights, a grey ground bounce and a tone curve that leaves colours alone below the highlights. `'neutral-v2'`: the same lights, plus a thin outline where bare skin meets the backdrop or the floor and a soft contact shadow under the feet (below, "Lighting neutral-v2"). Anything else is `classic` (`lightingOf`). Both change how every garment looks: **not switched on anywhere until the founder approves them from the pictures.** |
| `look.head: 'neutral-v2'` | | Head v2 of `@curtain/mannequin` (open eyes, brows, ears, a jaw and brow per family, no neck seam; its README). Opt-in for the look review; the default head is still `'neutral'`. The mesh carries a shade per vertex (brows, lash line, iris), drawn as a vertex colour that multiplies the skin colour. Its tube on the neck follows the neck's girth scale and the neck fit (`tubeWeight` in `body.ts`). |
| `look.head: 'neutral-v3'` | | Head v3 of `@curtain/mannequin` (v2's defects of the 19 Nov review fixed, short sculpted hair, 24.6k triangles; its README and `docs/reports/claude-head-v3.md`). Opt-in; the default head is still `'neutral'`. Drawn as head v2 (shade as a vertex colour, the tube follows the neck), plus the hair's own colour: with a skin tone chosen the hair is the dark brown `HAIR_HEX` or the skin darkened by `HAIR_SHADE`, whichever is darker per channel (`tintHair`, `hairLinear`; display only, like the skin); on the grey mannequin a darker grey. |

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

**What it is.** `neutral-v2` keeps `neutral`'s lights and tone curve, so skin and garment pixels that face the camera are the `neutral` ones, and adds three things (`LOOK_EXTRAS`):
- an **outline** 1.25 CSS px wide where bare skin meets the backdrop or the floor, never where it meets the garment. A second render writes a mask, multisampled like the frame, that holds the share of skin and of garment in each pixel, and a screen pass draws the line over the part of each pixel near the skin that is neither (so also over the cream the frame blended into the skin's own edge pixels), anti-aliased; both only cover the skin's box on screen, and the line is left out while the view turns, during a drag and while it damps out after one (below, frame cost). Its colour is the skin colour darkened, same hue, until it stands out 4.5:1 from the cream and from the floor as it comes out on screen (`outlineColour`, `FLOOR_SEEN_HEX`): a grey-brown on Monk 1 to 6 and on the default grey, a darker brown on Monk 7, no line at all on Monk 8 to 10, which stand out by themselves. This is the rule of the 2D figure's `figureOutline`, with a higher target: a line chosen for 3.2:1 left 28 to 36 % of the edge under 3:1, because the line is anti-aliased and the skin at the silhouette is shaded darker than its swatch.
- a **contact shadow**: a soft dark spot (32 %) on the floor under the feet.
- a **floor bounce** (`bounce: 1.0`, added in the review of 18 Nov 2026): a weak light straight up from the floor. A surface facing the camera gets none of it; it lifts the underside of the jaw, which under the lights alone read at phone size as a dark band, a chin strap, on both heads and both families. It also reaches whatever faces a little down on the garment: up to 1.2 ΔE there (below).

**Options tried and dropped** (all on `neutral`, same measurement): a backdrop panel behind the figure darkened until it stands out 3.2:1 from the skin swatch (`backdrop: 'adaptive'`): Monk 1 needs a mid grey (`#7f7b77`-ish) behind it, which turns the whole view grey, and the silhouette still measured only 1.8:1 at the median because the shaded edge of the skin is darker than the swatch; a rim light from behind each side (`rim: 1.2`): it brightens the edges of a light skin towards the cream and makes it worse (Monk 1: 1.1:1); the contact shadow alone: grounds the feet, does nothing for the arms and head. They stay in the code (`LookExtras`) for that comparison only; hosts cannot reach them except through `MountOptions.lookExtras`, which is documented as not for hosts.

**Head v2** (`look.head: 'neutral-v2'`, `@curtain/mannequin` `headV2.ts`): see that package's README for the geometry. In the viewer the head part takes the calm head scale as before, while the tube it has on the neck follows the neck's girth scale and the neck fit, blended over the lowest fifth of the head (`tubeWeight`); `fitNeckToHead` measures the jaw only above the tube. `look.test.ts` checks that the tube stays 0 to 6 mm outside the neck between the neck ring and the chin on bodies from 60/45/65 to 150/140/160 cm girths and that the mesh stays closed at 130 to 220 cm.

**Measured** (18 Nov 2026, `spikes/garment-engine/viewer/look-v2-renders.mjs`, headless Chromium on SwiftShader, a software renderer: not a phone, not a calibrated display). *Silhouette contrast*: the body alone at phone size (390 × 760 CSS px at 2×), a skin mask from a second render, and at every edge pixel of the skin the stronger of two WCAG contrasts: the skin just inside against what is just outside (the line, where there is one), and that against the backdrop 6 to 9 CSS px further out. Median, 10th percentile, and the share of edge pixels under 3:1. *Skin ΔE*: CIEDE2000 of four front-facing patches (forehead, neck, forearm, shin) against the swatch, mean (max). Female body, today's head; the male body gave the same numbers within 0.2.

| Monk | classic: median / p10 / under 3:1 | neutral | **neutral-v2** | neutral-v2 line | skin ΔE classic | neutral / neutral-v2 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 `#f6ede4` | 1.49 / 1.16 / 94 % | 1.42 / 1.02 / 96 % | **4.92 / 3.96 / 3.4 %** | `#605c59` | 6.1 (7.0) | 0.9 (1.2) / 0.8 (1.2) |
| 2 `#f3e7db` | 1.54 / 1.18 / 93 % | 1.48 / 1.02 / 94 % | **4.91 / 3.95 / 3.7 %** | `#615c58` | 6.0 (6.8) | 1.2 (1.7) / 1.1 (1.7) |
| 3 `#f7ead0` | 1.52 / 1.17 / 93 % | 1.45 / 1.02 / 95 % | **5.01 / 4.03 / 3.3 %** | `#605b51` | 7.5 (7.9) | 0.9 (1.1) / 0.8 (1.1) |
| 4 `#eadaba` | 1.67 / 1.25 / 89 % | 1.65 / 1.08 / 92 % | **4.94 / 3.97 / 4.4 %** | `#625c4e` | 6.5 (6.6) | 2.0 (3.4) / 1.8 (3.4) |
| 5 `#d7bd96` | 2.05 / 1.45 / 82 % | 2.08 / 1.36 / 78 % | **4.93 / 3.96 / 5 %** | `#675b48` | 4.6 (5.5) | 2.4 (5.0) / 2.3 (5.0) |
| 6 `#a07e56` | 4.18 / 2.60 / 22 % | 3.76 / 2.55 / 28 % | **4.86 / 3.91 / 5.2 %** | `#72593d` | 3.3 (5.1) | 2.5 (5.1) / 2.5 (5.1) |
| 7 `#825c43` | 6.62 / 4.27 / 0 % | 5.28 / 3.76 / 0 % | **4.84 / 3.87 / 5.2 %** | `#7a563f` | 4.2 (5.5) | 2.3 (4.9) / 2.3 (4.9) |
| 8 `#604134` | 9.36 / 7.06 / 0 % | 7.05 / 5.45 / 0 % | **6.89 / 5.28 / 0 %** | none | 5.2 (6.7) | 2.0 (3.8) / 2.1 (3.8) |
| 9 `#3a312a` | 11.6 / 9.42 / 0 % | 8.80 / 7.09 / 0 % | **8.66 / 6.87 / 0 %** | none | 5.5 (6.8) | 2.0 (3.6) / 2.1 (3.6) |
| 10 `#292420` | 12.9 / 10.4 / 0 % | 10.0 / 8.23 / 0 % | **9.90 / 7.89 / 0 %** | none | 5.3 (6.3) | 2.4 (3.6) / 2.4 (3.6) |
| grey `#8c8c8c` | 3.69 / 2.32 / 37 % | 3.41 / 2.31 / 40 % | **4.97 / 3.99 / 5 %** | `#5c5c5c` | 2.9 (5.7) | 2.4 (5.6) / 2.3 (5.6) |

What it says: with `neutral-v2` every tone's silhouette has a median of 4.8:1 or more and its 10th percentile at 3.8:1 or more; 3.3 to 5.2 % of the edge pixels of Monk 1 to 7 are still under 3:1 (male body 3.7 to 5.3 %). Until the review of 18 Nov 2026 it was 5 to 7 %, and most of that was not at the fingertips and feet, as had been assumed, but a light dotted gap one pixel wide between the skin and the line along the whole silhouette: the mask was drawn without multisampling while the frame is, so the skin's own anti-aliased edge pixels (blended with the cream) counted as skin and got no line. The mask is now multisampled like the frame and carries the share of skin and garment per pixel, and the line covers the open part of a partly-skin pixel too (`OUTLINE_FRAGMENT`); in 4× close-ups of the head, jaw, hand and foot on Monk 1, 3, 6 and 7 the gap is gone. Where the remaining 3 to 5 % sit was not mapped. `look-v2-renders.mjs` fails a run in which more than 8 % of any tone's edge is under 3:1 (not part of `pnpm check`: it needs WebGL). The other options, same table: outline chosen for 3.2:1 median 3.5, under 3:1 28 to 36 %; contact shadow alone as `neutral`; adaptive backdrop Monk 1 to 5 1.8 to 2.0 median, 85 to 92 % under 3:1, grey 2.25; rim lights worse than `neutral` (Monk 1 1.10, 99 % under 3:1). Skin ΔE of `neutral-v2` is `neutral`'s within 0.2 (the lights are the same; the floor bounce lifts the forearm and shin patches, which face a little down, by up to 1.1 ΔE against `neutral`'s pixel); in `neutral` it is about 1 on Monk 1 to 3 and 2 to 2.5 on the others (the forehead and neck tilt up to the key light; the forearm and shin are within 1.1).

*Garment colours* (median of 9 × 9 px patches on the garment: hip, thigh, and on the dress bust and waist; ΔE2000 against `neutral` at the same patch): `neutral-v2` against `neutral`: **0.0 at every patch of the crimson POM skirt** (a drape bake); azure dress up to 1.2 (the bust patch, 0.9 to 1.2; hip, thigh 0.4 to 0.8; waist 0.0) and photo skirt up to 1.2 (the thigh, 0.7 to 1.2; hip and knee 0.0 to 0.5), all five tones, with head v1 and v2 alike. Before the floor bounce these were 0.0 everywhere (the outline is never drawn over the garment); the bounce lifts patches whose cloth faces a little down. Under the 2.0 that `look-v2-renders.mjs` fails a run on (garment patches, and the forehead and neck), not under the threshold of seeing a difference side by side (about 1). `classic` against `neutral`, mean / max over the patches per tone: azure dress 2.4 to 3.7 / 4.0 to 5.8, POM skirt 4.2 / 4.7, photo skirt 3.5 to 4.3 / 5.1 to 6.2: `classic` is darker. (The dress's knee patch is below the hem, on the skin, and is left out. The dress's numbers vary by tone because each lighting is its own mount and drape, so the cloth is not in exactly the same place; the bake skirt's do not.) What the eye does with a darker line next to a light garment is not measured.

*Frame cost* in the throttled phone page (412 × 915 CSS px at 2×, DevTools CPU throttle 4×; SwiftShader renders on the CPU, so a fragment-heavy pass costs far more here than on a phone GPU; a phone was not measured). Re-measured on 19 Nov 2026 after the review (multisampled mask, no line while the view damps out): 8 runs per figure, the first a warm-up left out of the median (it is often an outlier: 204 ms against a median of 105). Body alone, ms per frame (each frame read back), turning as a drag does, median of runs 2 to 8 (range):

| head | classic | neutral | neutral-v2 while turning | neutral-v2 still frame (with the line) |
| --- | --- | --- | --- | --- |
| v1 (`neutral`, 30,016 triangles) | 103 (100 to 109) | 105 (97 to 112) | 129 (120 to 142) | 554 (538 to 576) |
| v2 (`neutral-v2`, 60,672 triangles) | 139 (130 to 149) | 151 (128 to 163) | 177 (165 to 212) | 630 (599 to 647) |

The still frame with the line is slower than before the review (370 to 500 ms): the mask is now drawn with 4× multisampling, like the frame, which is what closes the gap between the skin and the line; on SwiftShader that pass costs about a fifth more. It is drawn only on frames where the camera does not move.

In the mount with the azure dress, 4 drags of 4 s each, frames per second: classic head v1 8.9 / 3.8 / 4.5 / 3.2, neutral-v2 head v1 7.4 / 3.9 / 3.4 / 3.8, classic head v2 8.4 / 3.4 / 3.8 / 3.7, neutral-v2 head v2 6.9 / 3.3 / 3.4 / 3.3. Every lighting drops from the first drag to the later ones alike, so it is not the line; the cause was not looked into (assumed: the neighbouring sizes draping in the background after the first settle, and a second agent on the same 4-core machine). The 1.5 s after the finger lifts (the damping, then the frame the view stops on): 2 to 4 slow frames in every configuration, median 267 to 283 ms in classic and 275 to 317 ms in neutral-v2 (longest 333 ms; one classic outlier 517 ms), so the damping no longer draws the line on every frame: before, each of those frames would have cost about 400 ms or more. Only the frame the view stops on, and frames while the camera is still (a drape settling, a size switch), draw it. Head v2 costs about 35 % more per frame on the body alone and about 10 % in the mount, where the garment dominates.


## Skin shading skin-v2 (the skin review, D22 point 3)

`look.shading: 'skin-v2'` (opt-in; default `'flat'`, the material of before, unchanged) shades a picked skin colour with its own material (`src/skin.ts`); the grey mannequin, the garment, the floor and the outline are not touched. `setLook` keeps the shading of the mount unless the new look names one.

- **Pre-integrated scattering.** A table computed once in code (`skinLut`, 64 × 32 half floats): d'Eon and Luebke's six-Gaussian skin profile (published numbers, no asset) integrated over a ring of the local radius, per light angle and curvature, each row scaled so a surface facing the light keeps its full light. The curvature is read per pixel from the screen derivatives of the normal and the position, exaggerated twelvefold (`SKIN_SCATTER_SCALE`: a true-scale terminator is thinner than a pixel at phone size). Red reaches furthest past the terminator, so the shadow edge is softer and slightly red.
- **A soft sheen.** Roughness 0.62 (light tones) to 0.45 (deep), against the flat skin's 0.75; specular 0.32; a faint grazing sheen tinted by the skin. A broad, strong white reflection was tried first and read as a grey, ashy veil on Monk 8 to 10.
- **Per-tone exposure care** (`skinToneCare`, `skinToneStage`; the body's material does its own tone stage in place of the rig's). Under `classic` (ACES) the lightness of ACES is kept for light and medium tones, so their contrast with the cream is what it was, but hue and chroma are the swatch's as shaded; on deep tones the lightness moves to the true one (ACES made Monk 10 L* 4.5 against the swatch's 14.6). Under `neutral` and `neutral-v2` highlights roll off keeping their hue, from just above the swatch's own largest channel, so light skins do not clip to white.
- **Hair of head v3.** It is a per-vertex cover on the body mesh, so it is drawn by the same material; weighted by the cover it takes the flat material's terms (plain Lambert, roughness 0.75, specular 0.3, no sheen, the rig's own tone curve), not the skin's. With the skin's terms it read shiny grey on Monk 8 to 10. A geometry without the `hair` attribute is all skin.
- **Guard.** The patch replaces lines of three r186's fragment and vertex chunks (`SKIN_V2_HOOKS`); `skinV2ChunksPresent` checks them and `patchSkinV2` throws if a three.js upgrade moved them (`skin.test.ts`).
- Measured on SwiftShader (colour against the swatch per tone, garment ΔE flat against skin-v2, frame cost in the throttled phone page): `docs/reports/claude/skin-v2.md`. Pictures: `docs/screens/claude/skin-v2/` (`spikes/garment-engine/viewer/skin-v2-renders.mjs`, `skin-v2-grid.mjs`). The embed switches it on only with the build flag `VITE_AVATAR_SKIN=skin-v2`, set nowhere until the founder approves.

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
  the size was not draped on (its band cannot be pulled over that body, `refusedRule: 'pull-on'`), or `refused` at or past such a body (`notDraped`): the size is then
  not drawn on the shopper, and `refusedHipCm` names that body's hip). The host prints it under the estimate label
  (`apps/web` `Garment3D.tsx`). An on-device view says `{ kind: 'device' }`.
- A bake is draped on the girth avatar: with a typed body (height, shoulders) it is `GarmentViewError('incompatible')`.
- The import gate admits a bake only flagged `tape_built_no_chart_check` (`qa.json` `chartAgreement.kind: 'tape-built'`):
  its QA pass is not a measured chart agreement.
- The reader and its meshopt decoder are a separate lazy chunk (`drapeBakeRead`, 8.3 KB gzip), not in the viewer chunk
  (159.6 KB gzip of the 400 KB budget) and not precached.

## Hold length (hang lines)

A bundle whose anchors.json says `"support": { …, "holdLength": true }` keeps the length it was cut on its way down from
where it is held (`cloth.ts` `addHangLines`, `ClothParams.hangStretch`; docs/reports/claude/cloth-hang.md). Without it the
tethers hold every particle within its cloth distance of a pin along a straight line, which has slack wherever the cloth
bends (bust, seam, hip, folds): the tape-built dress came out 2.2 to 2.9 % long. A hang line is a pair of particles on one
shortest path from the support, 1, 2, 4, 8 … steps apart, that may not be longer than the cloth between them plus a fifth
of material.json `stretchPct` (0.2 to 1 %; the fifth is assumed). One way only, so the cloth still folds and gathers.

- Measured on the SYNTHETIC tape dress, AU 8 to 16 and at 156 and 180 cm: length +1.0 to +1.2 % (from +2.2 to +2.9 %).
- **Off for every bundle that does not ask** (their drape is bit for bit the one of before), because it is not free: below
  the waist less of the size difference survives (dress, hip: 52 → 21 % of the graded spread), and forced onto the men's
  tee the peak strain doubles. Read the report before setting it on another bundle.
- `canvas.dataset.solveMs`: the worker's solver time for the size on show (a timing for the demo scripts).

## Realistic body spike (`bodyShape: 'realistic-spike'`, opt-in, off by default)

One week spike of route B in `docs/research/realistic-avatar-route.md` (female family only). Report, numbers and
pictures: `docs/reports/claude/realistic-body-spike.md`.

```ts
mountGarmentView(canvas, { ...options, bodyShape: 'realistic-spike' }); // web build: VITE_VIEWER_BODY=realistic-spike
```

- **What is drawn.** The MakeHuman CC0 base mesh (`assets/realistic-body/female-v1.crb`, 337,732 bytes, 13,524
  vertices, 27,036 triangles, no texture; provenance and licence quotes in `assets/realistic-body/PROVENANCE.md`),
  fitted on the device to the drawn body's 12 ring girths (`realisticBody.ts`) and swapped in for the procedural skin
  when ready. `canvas.dataset.body` says `procedural`, `realistic-loading`, `realistic` or `procedural-fallback`.
- **What does not change.** The cloth collides with the ring table's field as before (the realistic mesh is a skin
  only), the fit and the sizes come from the embed's `FitResult`, the bundle is the same, and every default is the
  procedural body. A male body ignores the option. `look.head` is not used on it: its head is MakeHuman's, untextured,
  with two grey eye spheres (D27: no face work).
- **Cost.** One more GET (the asset, the same file for everyone, no credentials, no referrer) and a lazy chunk
  `realisticBodyLoad` (6.1 KB gzip in the web build, never precached by the service worker); the viewer chunk does
  not carry it. The fit runs on the main thread once per mount (about 240 to 510 ms in Node on the build container
  since the review fixes of 21 Nov, before 100 to 250 ms; not measured on a phone).
- **Girth is the loop** (the closed section round the ring centre, as `meshRingCircumference`); the tape (convex hull)
  is reported next to it. Which one a typed girth means is open (OI-141). The girths are tested against the typed
  measurements and `buildBody`'s ring table with an independent slicer (`test/independentSlice.ts`,
  `test/realisticBodyGirth.test.ts`, with negative controls); every ring centre must lie inside its drawn section, and
  the fit moves each torso ring's and five arm stations' sections so their area centre is on the ring table's centre
  line or arm axis (MakeHuman's forearm is bent forward of the line through its joints).
- **Under a garment it is conformed.** The cloth meets the ring table's ellipses, and the realistic section is outside
  them in places (bust, seat, shoulder caps, the backs of the calves: 1.5 to 5 cm on the torso). While a garment is
  drawn, the vertices it covers (`coverZone` of the bundle's rest particles) are pulled inside the field plus 0.1 cm
  (`conformToField`), so the skin does not show through; `canvas.dataset.body` is then `realistic-conformed`. The
  pull alone took 1 to 3 % off the girths; by default the covered skin inside the field is then scaled back out
  (never past it) per height until each loop is the fitted mesh's again: chest within about 1.2 %, underbust, waist
  and hip within about 0.7 % (the arms are pulled only). It is a display mesh: nothing measures it but the spike
  pictures' tag (`canvas.dataset.bodyGirths` and `bodyGirthsConformed`). `realisticBodyConform: false` draws it as
  fitted (comparison pictures only). The real fix is a collider made from the realistic mesh (OI-143). A drape bake
  draws it unconformed.
- Bake again: `pnpm --filter @curtain/garment-viewer exec tsx scripts/bake-realistic-body.ts <mpfb2 checkout> --fetch`
  (deterministic; every source checked by sha256). Measure: `scripts/realistic-body-report.ts`. Pictures:
  `spikes/garment-engine/viewer/realistic-body-renders.mjs`.

### Procedural skin and studio light (`realisticSkin: true`, with the realistic body only, off by default)

```ts
mountGarmentView(canvas, { ...options, bodyShape: 'realistic-spike', realisticSkin: true, look: { skinHex: '#a07e56' } });
```

Report, numbers and pictures: `docs/reports/claude/realistic-body-skin.md`. Nothing here is a third-party texture or a
download: the skin and the light are made in code, in the realistic body's lazy chunk (`realisticBodyLoad`), so the
viewer chunk does not carry them. Without the option (and for the procedural body, the male body, a failed load) the
materials, lights and tone mapping are those of before.

- **Skin** (`realisticSkin.ts`): a physical material patched in `onBeforeCompile` (hooks pinned for r186 by
  `realisticSkinChunksPresent`). Per-channel wrap lighting (red furthest); translucency at thin parts (ears, fingers,
  a little at the nose) from the direct lights and from the environment behind; pores and fine creases from a
  128 × 128 RGBA8 tile generated in code (`skinDetailPixels`, 64 KB, deterministic; height gradient, roughness
  variation, a soft mottle), projected from three sides in the body's own space (the asset has no UVs) and faded out by
  mipmaps at full-body distance; redness at the cheeks, nose, ears, elbows, knees and knuckles (a per-vertex mask found
  on the asset's rest mesh by landmarks, `skinMaskOf`); a slight sheen tinted by the skin. Every per-tone value comes
  from the one skin-tone value (`realisticSkinCare`; D20): redness is a step in CIE a* (9 on light tones, 5 on deep),
  wrap and translucency are less red on deep tones, and deep tones get a tighter, weaker white reflection and a sheen
  in their own colour (a white one greyed them). No tone: the grey mannequin with no redness. MakeHuman's eye spheres
  are drawn off-white with a dark iris (stylised, D27). `Figure.setSkinOverride` is the hook: the figure hands the
  override its skin colour on every `setSkin`.
- **Studio light** (`studioLight.ts`): the rig's lights are switched off and an environment made in code goes in (an
  inside-out sphere coloured by `studioRadiance`: sky-to-floor gradient, a key softbox, a weak fill, a strip behind;
  prefiltered by three's `PMREMGenerator`), plus one soft directional key from the rigs' key direction, with the
  `neutral` rig's true-tone curve. Calibrated so a matt surface facing the camera gets irradiance π (its own colour;
  `studioFrontIrradiance`, integrated from `studioRadiance`, not read back from the prefiltered map). It lights the
  garment and the floor too.
- `canvas.dataset.bodySkin` is `procedural-skin` while it is drawn. Pictures:
  `spikes/garment-engine/viewer/realistic-body-skin-renders.mjs` and `realistic-body-skin-sheets.mjs`
  (`skinlook=procedural`, `frame=upper` on `avatar.html`). The embed has no build flag for it yet.

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

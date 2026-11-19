# Skin v2 (`skin-v2`): report, branch `claude/skin-v2`

19 Nov 2026. D22 point 3 says skin tones must look better than today's flat shading, on the 3D mannequin and on the 2D figure, for every Monk tone. I built a skin shading `skin-v2` for both, behind an option. **Defaults are unchanged:** the viewer's `look.shading` defaults to `'flat'` (the material of before), `AvatarView` defaults to `skinShading="flat"` (the female figure is still pinned byte for byte by `femaleFigureGolden.test.tsx`), and the embed switches skin-v2 on only with the build flag `VITE_AVATAR_SKIN=skin-v2`, which is set nowhere. Every 3D picture is an ESTIMATE render from headless Chromium on SwiftShader (a software renderer), **not a phone**; every 2D figure keeps its "Estimate · not measured" badge.

## What was built

### 3D: `packages/garment-viewer/src/skin.ts` (`look.shading: 'skin-v2'`)

Only the body's own material changes. The garment, floor, backdrop and the neutral-v2 outline keep their materials, and the grey mannequin (no colour picked) is the same either way. It uses only our own shader code and published numbers, with no scanned asset and no model.

- **Pre-integrated scattering** (Penner's method). The table is computed once in code (`skinLut`, 64 × 32, half floats). It takes d'Eon and Luebke's six-Gaussian skin profile (GPU Gems 3, ch. 14: published variances and weights) and integrates it over a ring of the local radius, per light angle and curvature. Each row is scaled so that a surface facing the light keeps exactly its Lambert light, so a front-facing patch keeps the swatch.
  - The curvature is read per pixel from the screen derivatives of the normal and the position.
  - It is exaggerated twelvefold (`SKIN_SCATTER_SCALE` 1.2): at phone size a true-scale terminator is thinner than a pixel. That number was chosen by eye.
  - Red travels furthest, so the shadow edge is softer and turns slightly red. This is the "red shift in the shadow terminator".
- **Soft sheen.** Roughness is 0.62 on light tones down to 0.45 on deep ones (flat: 0.75). Specular is 0.32 (flat: 0.3). A faint grazing sheen (0.04) takes half the skin's own colour.
- **Per-tone exposure care** (`skinToneCare`, `skinToneStage`). The body material runs its own tone stage instead of the rig's:
  - Under `classic` (ACES), light and medium tones keep ACES's lightness, so their contrast with the cream stays what it was, but they get the swatch's hue and chroma as shaded. Deep tones (Monk 7 partly, Monk 8 to 10 fully) move to their true lightness.
  - Under `neutral` and `neutral-v2`, highlights roll off keeping their hue. The roll-off starts just above the swatch's own largest channel (0.90 to 0.96 linear), so a front-facing patch is untouched and nothing clips to white.
- **Guard.** The patch replaces four lines of three r186's shader chunks (`SKIN_V2_HOOKS`). `skinV2ChunksPresent()` checks for them, and `patchSkinV2` throws if a three.js upgrade has moved them. `skin.test.ts` pins this.
- **Plumbing.**
  - `Figure.setSkinShading(kind, lighting)`.
  - `MountOptions.look.shading` on both mounts (device drape and drape bake) and in `mountFigureView`.
  - `setLook` keeps the mount's shading unless the new look names one; the embed calls `setLook({ skinHex })` only.

### 2D: `apps/web/src/render/skin2d.ts` (`AvatarView skinShading="skin-v2"`)

The flat figure shades the swatch by adding and taking away the same number on each channel (+10 to −22). That clips light swatches to white at the top, greys them at the bottom and nearly halves a deep swatch. skin-v2 multiplies the swatch in linear light instead:

- **Radial fill.** The lit centre is the swatch itself, then a middle shade (0.94, 0.92, 0.91), then a warm shadow (0.76, 0.68, 0.65): red is kept more, which gives the warm edge. The light comes from the viewer's right, like the 3D key light.
- **Side shading.** It is that warm shade, not black (opacity 0.45 at the shadowed left edge, 0.2 at the lit right edge).
- **Sheen.** A faint white band down the lit side: opacity 0.05 on light tones up to 0.15 on deep ones.
- **Outline.** A shade a little darker than the warm shadow, darkened further (hue kept) only until it stands out 3.2:1 from the mirror backdrop. On light tones it is a brown line; on deep tones a slightly darker warm edge where the flat outline was the fill itself.
  - I tried a line that also had to stand out 1.3:1 from the figure's own edge on deep tones. It came out near black and drew the body path's inner joins (shoulders, hips) as black seams, so I dropped it.
- **Face ink.** `faceInk` takes the head as drawn (`skin2d(hex).head`). The test checks 3:1 over lit, mid, head and shadow for all ten tones.
- **Hero render.** The hero render's person stays `plain`.

### Embed, tools and tests

- **Build flag.** `VITE_AVATAR_SKIN=skin-v2` (`avatarSkinFlag` in `embed/look.ts`) feeds `ResultScreen`, `PeekApp` and `Garment3D`; `Garment3D` sends `look.shading: 'skin-v2'` only then.
- **Tools.**
  - `spikes/garment-engine/viewer/skin-v2-renders.mjs`: faces, bodies, patches, phone, garment and frames sections.
  - `skin-v2-grid.mjs`: the grids.
  - The look page gets `shading=` and `avatarCheck.skinMask()`, a mask of bare skin with head v3's hair left out.
  - `apps/web/dev/skin.html` with `src/dev/skinHarness.tsx` (dev only) and `apps/web/scripts/skin-2d-shots.mjs`: 2D pictures and measurements.
- **Tests.**
  - `packages/garment-viewer/src/skin.test.ts` (10 tests): the table, the per-tone care, the tone stage on the CPU (the shader's twin), the patch against three's chunks, and the figure's default material.
  - `apps/web/src/embed/__tests__/skinV2.test.tsx` (11 tests): the 2D shades, the outline, the face ink, the prop, the flag, and the viewer option.

### Head v3's hair under skin-v2 (fixed after the first review)

Head v3's hair is a cover per vertex on the body mesh (`Mesh.hair`), not separate triangles, so it is drawn by the body's material. In the first version it took the skin's terms: the skin's tighter highlight, its sheen and its tone stage (which lifts deep tones). On Monk 8 to 10 that made the hair shiny dark grey, with a thin light line along the hairline.

Now, weighted by the cover, the hair gets the flat material's own terms:
- plain Lambert (no scattering);
- roughness 0.75 and specular 0.3, as the flat skin;
- no sheen;
- the rig's own tone curve.

The vertex shader reads the `hair` attribute only on a body that has it (`#define SKIN_HAIR`), and `Figure.setBody` rebuilds the material when a body swap changes that.

Measured on the 2× three-quarter close-ups: lightness of the hair area (backdrop left out), median / 99th percentile L*.

| | flat | skin-v2, hair with the skin's terms | **skin-v2, hair with its own terms** |
| --- | --- | --- | --- |
| female classic, Monk 8 / 9 / 10 | 10.2/19.4 · 4.5/14.9 · 2.5/12.8 | 22.0/60.2 · 16.6/61.3 · 13.0/60.9 | **10.2/19.4 · 4.5/14.9 · 2.5/12.8** |
| female neutral-v2, Monk 8 / 9 / 10 | 21.2/26.9 · 15.1/23.3 · 11.5/21.3 | 22.5/55.2 · 16.5/56.4 · 12.9/55.9 | **21.2/26.9 · 15.1/23.3 · 11.5/21.3** |
| male classic, Monk 8 / 9 / 10 | 9.7/19.2 · 4.2/14.9 · 2.3/12.8 | 21.3/59.4 · 16.2/60.6 · 12.9/60.2 | **10.0/19.2 · 4.2/14.9 · 2.3/12.8** |
| male neutral-v2, Monk 8 / 9 / 10 | 20.7/26.7 · 14.7/23.0 · 11.0/21.3 | 21.9/54.4 · 16.0/55.6 · 12.5/55.1 | **20.8/26.7 · 14.7/23.0 · 11.0/21.3** |

- **The hair is the flat hair again,** within 0.3 L*, on every tone, both families and both lightings (Monk 6 too).
- **The shiny highlight is gone:** before the fix it reached L* 54 to 61.
- **The hairline line on Monk 8 is gone** in the close-up.
- **Side effect under `classic`:** on Monk 9 and 10 the hair is as dark as in flat (L* 2 to 5), while the skin around it is now at its true lightness (L* 16 to 21). For the first time the hair separates from deep skin at all; on flat both were near black.
- **Pictures:** `hair-faces-*` and `hair-phone-*` in `docs/screens/claude/skin-v2/`. Rows: flat, skin-v2 with the hair sharing the skin's terms (the pictures of the first round), and skin-v2 with the hair's own terms.
- **What did not change:** the skin pixels (the hair cover is 0 there), and so every skin and garment number above.

## The Monk swatches and their licence

- **Values.** The ten values in `MONK_SWATCHES` (`#F6EDE4 #F3E7DB #F7EAD0 #EADABA #D7BD96 #A07E56 #825C43 #604134 #3A312A #292420`) match the published list in the Wikipedia article on the scale, which cites Google's skintone.google "Get Started" page. **Nothing was changed.**
- **Licence.** The same article says: "The Monk scale is open source. Its ten tones are licensed under the Creative Commons Attribution 4.0 International license." That confirms the earlier note (CC BY 4.0). The credit line under the swatches and `docs/LICENSES.md` stay as they are; `LICENSES.md` now records this check.
- **Not verified at the primary source.** skintone.google renders in the browser, and from this container I could fetch its HTML and script but not the rendered page, so I could not read the values or the licence on Google's page itself. That check is open.

## Measured

All on this machine: SwiftShader, phone page 390 × 760 CSS px at 2×, head `neutral-v3`. Colour is CIEDE2000.

- **3D "every pixel":** every inner bare-skin pixel of the body alone, front view, using a mask render (hair left out). I report the median, and the 10th and 90th percentile by lightness.
- **2D:** every inner pixel of the body fill of the 240 × 432 figure at 2×.

### Skin colour against the swatch

### female: 3D body alone, every inner bare-skin pixel (hair left out): median against the swatch, ΔE2000 (median L*)

| Monk | swatch (L*) | classic flat | classic **skin-v2** | neutral-v2 flat | neutral-v2 **skin-v2** | classic L* p10–p90 flat → skin-v2 | neutral-v2 L* p10–p90 flat → skin-v2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `#f6ede4` (94.2) | 7.4 (83.3) | **7 (83.2)** | 1.6 (91.8) | **1.4 (92.1)** | 70.4–87.2 → 70.5–87.1 | 74.4–96 → 75–96.6 |
| 2 | `#f3e7db` (92.3) | 7.1 (82.4) | **6.5 (82.3)** | 1.6 (89.8) | **1.4 (90.2)** | 69.3–86.3 → 69.3–86.5 | 73–94.7 → 73.5–95.1 |
| 3 | `#f7ead0` (93.1) | 8.4 (82.6) | **6.7 (82.7)** | 1.5 (90.7) | **1.3 (91)** | 69.6–86.7 → 69.8–86.7 | 73.6–94.5 → 74.1–95.2 |
| 4 | `#eadaba` (87.6) | 6.8 (79.8) | **5.1 (80)** | 1.5 (85.4) | **1.2 (85.8)** | 65.5–84.3 → 65.8–84.3 | 69–92.1 → 69.7–92.2 |
| 5 | `#d7bd96` (77.9) | 4.5 (73.3) | **3.3 (73.5)** | 1.4 (76) | **1.1 (76.4)** | 57.4–79 → 57.8–79 | 61.2–82.6 → 61.7–83.1 |
| 6 | `#a07e56` (55.1) | 3.8 (51.3) | **3.8 (51.4)** | 1.3 (53.9) | **1 (54.3)** | 34.5–58.3 → 35.3–59 | 42.6–59.1 → 43.4–59.8 |
| 7 | `#825c43` (42.5) | 6.5 (35.4) | **4.5 (38.1)** | 1.1 (41.6) | **0.7 (42.2)** | 21.6–42.2 → 26.3–44.9 | 32.4–46.2 → 33.3–47.1 |
| 8 | `#604134` (30.7) | 7.4 (20.9) | **1.1 (29.6)** | 0.8 (30.4) | **0.8 (30.9)** | 10.6–26.4 → 21.7–34.7 | 22.9–34.2 → 24.1–35.2 |
| 9 | `#3a312a` (21.1) | 7.4 (9.9) | **0.8 (21.4)** | 0.7 (21.6) | **0.9 (22)** | 3.7–14.1 → 15.3–26.4 | 15.3–24.7 → 16.7–26.2 |
| 10 | `#292420` (14.6) | 6.6 (4.5) | **1.1 (15.9)** | 1.1 (15.9) | **1.4 (16.4)** | 1.7–7.6 → 11.1–20.6 | 10.6–18.9 → 12.1–20.6 |

### male: 3D body alone, every inner bare-skin pixel (hair left out): median against the swatch, ΔE2000 (median L*)

| Monk | swatch (L*) | classic flat | classic **skin-v2** | neutral-v2 flat | neutral-v2 **skin-v2** | classic L* p10–p90 flat → skin-v2 | neutral-v2 L* p10–p90 flat → skin-v2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `#f6ede4` (94.2) | 7.3 (83.3) | **7 (83.2)** | 1.5 (91.8) | **1.3 (92.1)** | 70.7–86.9 → 70.7–87.1 | 73.7–95.9 → 74.1–96.6 |
| 2 | `#f3e7db` (92.3) | 7.1 (82.4) | **6.4 (82.3)** | 1.6 (89.8) | **1.4 (90.2)** | 69.3–86.2 → 69.4–86.2 | 72–94.7 → 72.4–95 |
| 3 | `#f7ead0` (93.1) | 8.4 (82.6) | **6.7 (82.7)** | 1.5 (90.7) | **1.3 (91)** | 69.9–86.5 → 69.9–86.6 | 72.5–94.5 → 73.1–95.2 |
| 4 | `#eadaba` (87.6) | 6.8 (79.8) | **5.4 (79.7)** | 1.5 (85.4) | **1.2 (85.7)** | 65.6–84 → 66–84.3 | 68.1–91.9 → 68.6–92.1 |
| 5 | `#d7bd96` (77.9) | 4.5 (73.3) | **3.3 (73.4)** | 1.4 (76) | **1.1 (76.4)** | 57.5–78.6 → 57.8–78.9 | 60.4–82.3 → 60.9–82.7 |
| 6 | `#a07e56` (55.1) | 4.1 (51) | **3.8 (51.4)** | 1.3 (53.9) | **1 (54.3)** | 34.8–58.2 → 35.3–58.7 | 42.1–58.8 → 42.7–59.5 |
| 7 | `#825c43` (42.5) | 6.5 (35.4) | **4.2 (38)** | 1.1 (41.6) | **1.1 (42.1)** | 21.7–42.2 → 26.4–44.7 | 32–45.8 → 32.8–46.9 |
| 8 | `#604134` (30.7) | 7.4 (20.7) | **1.5 (29.5)** | 0.8 (30.4) | **0.8 (30.9)** | 10.6–26.2 → 21.7–34.6 | 22.6–34.1 → 23.6–35 |
| 9 | `#3a312a` (21.1) | 7.7 (9.6) | **0.8 (21.4)** | 0.8 (21.4) | **0.9 (22)** | 3.9–14 → 15.7–25.9 | 15.3–24.7 → 16.6–25.9 |
| 10 | `#292420` (14.6) | 6.6 (4.5) | **1.1 (15.9)** | 1.1 (15.9) | **1.4 (16.4)** | 1.7–7.1 → 11.1–20.2 | 10.5–18.8 → 12–20.2 |

What it says:

- **Under `classic`, today's lighting:**
  - Monk 8 to 10 go from L* 4.5 to 21 (6.6 to 7.7 ΔE from the swatch, near black) to within 0.8 to 1.5 ΔE, and their whole lightness range (p10 to p90) moves up to where the swatch is: Monk 10 from 1.7–7.6 to 11.1–20.6. The spread stays about the same (Monk 8 16 → 13 L* units, Monk 10 6 → 9.5), so the gain is that the form is now visible at a lightness the eye can separate, not that the shading contrast is larger.
  - Monk 7 goes from 6.5 to 4.2 to 4.5 ΔE.
  - Monk 2 to 5 lose 0.6 to 1.7 ΔE: the grey cast is lifted and hue and chroma are the swatch's again.
  - Monk 1 to 4 stay 10 to 11 L* darker than the swatch **on purpose** (the lightness of ACES is kept, see below), so they are still 5 to 7 ΔE from the swatch.
- **Under `neutral-v2`:** flat was already within 0.7 to 1.6 ΔE. skin-v2 is within 0.7 to 1.4 and about 0.3 to 0.5 L* lighter, from the sheen. The highlights of Monk 1 to 3 roll off without going white (p90 L* 95 to 97, below the cream backdrop's).
- **Male and female agree** within 0.4 ΔE on every tone.

### The 2D figure against the swatch and against the 3D body

### female: 2D figure against the swatch and against the 3D body, ΔE2000 of the medians

| Monk | 2D vs swatch flat → skin-v2 | 2D vs 3D classic flat → skin-v2 | 2D vs 3D neutral-v2 flat → skin-v2 | 2D median L* flat → skin-v2 (swatch) |
| --- | --- | --- | --- | --- |
| 1 | 3.1 → **2.9** | 4.6 → **4.5** | 1.8 → **1.8** | 89.2 → 89.8 (94.2) |
| 2 | 3.2 → **3** | 4.7 → **4.1** | 1.9 → **2** | 87.3 → 87.9 (92.3) |
| 3 | 3.2 → **3** | 6.5 → **4.4** | 1.9 → **1.9** | 88.1 → 88.8 (93.1) |
| 4 | 3.5 → **3.2** | 5 → **2.9** | 2.2 → **2.2** | 82.3 → 83.2 (87.6) |
| 5 | 4.2 → **3.5** | 4 → **1.5** | 3 → **2.6** | 72.2 → 73.4 (77.9) |
| 6 | 6.2 → **5.1** | 2.5 → **2.5** | 5 → **4.3** | 49.1 → 50.5 (55.1) |
| 7 | 4.8 → **3** | 3.4 → **2.3** | 4 → **2.8** | 37.1 → 39.1 (42.5) |
| 8 | 3.7 → **1.8** | 4.2 → **1** | 3.4 → **2** | 26 → 28.4 (30.7) |
| 9 | 3.1 → **1.1** | 4.8 → **1.4** | 3.2 → **1.6** | 17 → 19.7 (21.1) |
| 10 | 2.4 → **0.9** | 4.4 → **2** | 3.1 → **2.3** | 11.1 → 13.8 (14.6) |

### male: 2D figure against the swatch and against the 3D body, ΔE2000 of the medians

| Monk | 2D vs swatch flat → skin-v2 | 2D vs 3D classic flat → skin-v2 | 2D vs 3D neutral-v2 flat → skin-v2 | 2D median L* flat → skin-v2 (swatch) |
| --- | --- | --- | --- | --- |
| 1 | 3.2 → **3.2** | 4.6 → **4.4** | 1.8 → **2.1** | 89.2 → 89.5 (94.2) |
| 2 | 3.4 → **3** | 5 → **3.9** | 2 → **2** | 87.1 → 87.8 (92.3) |
| 3 | 3.5 → **2.9** | 6.7 → **4.3** | 2.4 → **1.9** | 88 → 88.6 (93.1) |
| 4 | 3.5 → **3.5** | 5.2 → **3** | 2.3 → **2.8** | 82.3 → 82.9 (87.6) |
| 5 | 4.3 → **3.4** | 4.1 → **1.1** | 3.1 → **2.4** | 72.2 → 73.3 (77.9) |
| 6 | 6 → **5** | 2.6 → **2.1** | 4.7 → **4.2** | 49.1 → 50.4 (55.1) |
| 7 | 4.8 → **3.1** | 3.4 → **1.2** | 3.9 → **2.8** | 37.2 → 39 (42.5) |
| 8 | 3.5 → **1.9** | 4.2 → **1.1** | 3.3 → **2** | 26.2 → 28.3 (30.7) |
| 9 | 2.7 → **1.2** | 5.2 → **1.5** | 3 → **2** | 17.2 → 19.6 (21.1) |
| 10 | 2.2 → **1.4** | 4.6 → **2.5** | 3.2 → **2.7** | 11.2 → 13.3 (14.6) |

- **2D against the swatch:** better or equal on every tone and both families, most on Monk 7 to 10 (for example Monk 9, 3.1 → 1.1).
- **2D against 3D:**
  - Under `classic`, 2D and 3D now agree much better on Monk 3 to 10 (Monk 8, 4.2 → 1.0).
  - On Monk 1 and 2 they still differ by about 4 to 4.5, because the 3D light tones stay darker under `classic`.
  - Under `neutral-v2` it is about the same or better, except Monk 1 and 4 male (+0.3, +0.5) and Monk 2 female (+0.1).
- **Remaining gap:** the 2D median is still 4 to 5 L* below the swatch on Monk 1 to 6. The figure is shaded and the swatch is its lit stop. The largest remaining difference is Monk 6 (5.0 to 5.1 ΔE).

### Silhouette contrast (body alone; the median WCAG ratio at the skin's edge and the share of the edge under 3:1)

### female: silhouette contrast (body alone, median WCAG ratio / share of edge under 3:1)

| Monk | classic flat | classic skin-v2 | neutral-v2 flat | neutral-v2 skin-v2 |
| --- | --- | --- | --- | --- |
| 1 | 1.51 / 88.8 % | 1.5 / 89.1 % | 4.92 / 3.3 % | 4.92 / 3 % |
| 2 | 1.56 / 88 % | 1.55 / 88.4 % | 4.91 / 3.6 % | 4.91 / 3.5 % |
| 3 | 1.54 / 88.3 % | 1.53 / 88.7 % | 5.01 / 3.3 % | 5.01 / 3 % |
| 4 | 1.71 / 84.4 % | 1.69 / 85.6 % | 4.94 / 4.4 % | 4.94 / 4.2 % |
| 5 | 2.12 / 77 % | 2.09 / 77.9 % | 4.93 / 5 % | 4.93 / 5 % |
| 6 | 4.35 / 20.1 % | 4.15 / 23.6 % | 4.86 / 5.2 % | 4.86 / 5.2 % |
| 7 | 6.84 / 0 % | 5.83 / 0 % | 4.84 / 5.2 % | 4.84 / 5.2 % |
| 8 | 9.63 / 0 % | 6.81 / 0 % | 7 / 0 % | 6.5 / 0.1 % |
| 9 | 11.71 / 0 % | 8.13 / 0 % | 8.75 / 0 % | 7.95 / 0 % |
| 10 | 12.97 / 0 % | 9.12 / 0 % | 10.01 / 0 % | 9.03 / 0 % |

### male: silhouette contrast (body alone, median WCAG ratio / share of edge under 3:1)

| Monk | classic flat | classic skin-v2 | neutral-v2 flat | neutral-v2 skin-v2 |
| --- | --- | --- | --- | --- |
| 1 | 1.51 / 90 % | 1.5 / 90.8 % | 4.93 / 3.7 % | 4.93 / 3.6 % |
| 2 | 1.56 / 89 % | 1.55 / 89.6 % | 4.91 / 4 % | 4.91 / 3.9 % |
| 3 | 1.53 / 89.5 % | 1.53 / 90 % | 5.01 / 3.7 % | 5.01 / 3.6 % |
| 4 | 1.69 / 84.9 % | 1.68 / 86.2 % | 4.94 / 4.7 % | 4.94 / 4.6 % |
| 5 | 2.1 / 81 % | 2.07 / 81.5 % | 4.93 / 5.2 % | 4.93 / 5.1 % |
| 6 | 4.35 / 17.4 % | 4.16 / 21.6 % | 4.86 / 5.3 % | 4.86 / 5.3 % |
| 7 | 6.78 / 0 % | 5.79 / 0 % | 4.84 / 5.4 % | 4.84 / 5.4 % |
| 8 | 9.53 / 0 % | 6.79 / 0 % | 6.95 / 0 % | 6.44 / 0 % |
| 9 | 11.62 / 0 % | 8.11 / 0 % | 8.71 / 0 % | 7.97 / 0 % |
| 10 | 12.87 / 0 % | 9.1 / 0 % | 9.87 / 0 % | 9.01 / 0 % |

- **Unchanged for light tones.** skin-v2 does not change light-tone contrast under either lighting: under `classic`, Monk 1 to 5 stay at 1.5 to 2.1:1, 77 to 91 % under 3:1, as with flat. That is what `neutral-v2`'s outline is for (4.9:1).
- **Lower for deep tones but still high.** Deep tones' contrast goes down, because they are no longer near black: under `classic`, Monk 7 to 10 go from 6.8–13.0:1 to 5.8–9.1:1; under `neutral-v2`, Monk 8 to 10 go from 7.0–10.0:1 to 6.4–9.0:1 (Monk 7 is unchanged at 4.8:1, with its outline). The share of edge under 3:1 stays 0 to 0.1 %.
- **Monk 6 under `classic`** goes from 20 % of the edge under 3:1 to 24 % (female) and 17 → 22 % (male).

### Garment colour, flat against skin-v2 (median of 9 × 9 px patches on the cloth, ΔE2000, maximum over the patches)

| garment | lighting | Monk 1 | Monk 2 | Monk 3 | Monk 4 | Monk 5 | Monk 6 | Monk 7 | Monk 8 | Monk 9 | Monk 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic dress (opacity 0.85) | classic | 0.6 | 0.6 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.8 | 1.2 | 1.2 |
| synthetic dress (opacity 0.85) | neutral-v2 | 0 | 0.8 | 0.8 | 0.4 | 0.8 | 0.8 | 0 | 0 | 0.4 | 0 |
| synthetic tee (opaque; hip, waist, chest) | classic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| synthetic tee (opaque; hip, waist, chest) | neutral-v2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

- **The tee is opaque:** hip, waist and chest patches are **0.0** at every tone in both lightings. The skin-v2 material is not on the garment.
- **The dress has opacity 0.85**, so about 15 % of the body shows through it. Under `classic`, its patches move 0.6 to 1.2, all slightly lighter (about +3 per channel on Monk 9 and 10), because the skin behind the cloth is no longer near black. That is the see-through skin, not a change of the garment's material.
- **Some of it is drape noise.** Under `neutral-v2` the dress patches move 0 to 0.8 with no pattern by tone: each picture is its own mount and drape, so part of it is the drape (the cloth is not in exactly the same place).
- **Leg patch left out.** The tee's "thigh" patch is bare leg below the hem, so it is left out. It moved 2.0 to 7.6 under `classic`, the same skin change as above.
- **Raw data.** `docs/screens/claude/skin-v2/skin-v2-phone-garment.json`.

### Frame cost (throttled phone page, 412 × 915 CSS px at 2×, DevTools CPU throttle 4×; body alone, turning; 8 runs of 30 frames, median of runs 2 to 8; Monk 6)

| body | lighting | flat, ms per frame (range) | skin-v2 | difference |
| --- | --- | --- | --- | --- |
| female | classic | 92.7 (86.4 to 97.7) | 108.8 (99.4 to 113.2) | +17 % |
| female | neutral-v2 | 94.6 (90.2 to 101.6) | 118.4 (111.1 to 126.9) | +25 % |
| male | classic | 90.7 (83.4 to 96.8) | 112.5 (105.6 to 116.8) | +24 % |
| male | neutral-v2 | 97 (92.3 to 101.3) | 119.3 (115.7 to 124.5) | +23 % |


skin-v2 costs **17 to 25 %** more per frame here. It runs per pixel: two screen derivatives, a table lookup per light and the material's own tone stage. On SwiftShader every pixel's work is on the CPU, so this probably overstates a phone GPU's cost, but **I did not measure a phone.** In the mount the garment dominates, so the share there should be smaller; that was not measured either.

### What I measured and what I assumed

- **Measured:** every number above, on one machine, in one software renderer. The colour numbers are medians over many pixels; the per-picture runs were not repeated, apart from the frame runs.
- **Assumed, not measured:**
  - how this looks on a phone screen, or under any display profile;
  - the scattering exaggeration (`SKIN_SCATTER_SCALE` 1.2), the sheen strengths and the 2D shade factors: all chosen by looking at pictures;
  - whether keeping ACES's lightness for light tones under `classic` is right. It is a trade: true lightness would bring Monk 1 to 3 within about 1 ΔE of their swatch but take their silhouette from 1.5:1 towards 1.1:1 against the cream with no outline, so I kept it.
- **Not measured:** the drape-bake mount (no bake bundle in this checkout), the real embed's production build with the flag, and any garment other than the synthetic dress and tee.

## How the pictures look (I looked at each grid)

Grids are in `docs/screens/claude/skin-v2/`: `faces-*`, `bodies-*`, `phone-*`, `closeup-terminator-*`, `closeup-phone-*`, `figure2d-*`, `closeup-figure2d-*` and `figure2d-dress-female`. Each has flat (today) in the top row and skin-v2 below, for all ten tones, both families and both lightings.

Honest verdict per tone (3D first, then 2D):

| Monk | 3D under `classic` (today's lighting) | 3D under `neutral-v2` | 2D figure |
| --- | --- | --- | --- |
| 1 | **About the same.** Still a light grey-white; only a trace warmer. Not fixed: the greyness is mostly ACES's lightness, which I kept for contrast. | Same as flat; highlights roll off without going white. Small gain. | Practically the same; the outline is a warmer brown. |
| 2 | Slightly warmer, less grey. Small gain. | Same as flat. | Same, a shade warmer. |
| 3 | Visibly creamier, the yellow of the swatch comes back. Gain. | Same as flat. | Same. |
| 4 | Warmer, reads as skin rather than beige-grey. Gain. | Same as flat. | Slightly warmer. |
| 5 | Warmer and less flat. Gain. | Same as flat. | Slightly better (3.5 vs 4.2 ΔE). |
| 6 | Little change: a little less orange than ACES's, closer in hue. Neutral. | Same as flat. | Somewhat better (5.1 vs 6.2) but still the furthest from its swatch. |
| 7 | Less orange and a little lighter; reads more like the swatch. Gain. | Same as flat. | Better (3.0 vs 4.8). |
| 8 | **Clear gain.** A brown with visible cheeks, nose and lids instead of a dark mass. | Slightly more form from the highlight; the hairline gets a thin light line in the close-up. Small gain with a defect. | Better (1.8 vs 3.7); the sheen band shows the torso's roundness. |
| 9 | **Clear gain.** Flat is nearly black at phone size; skin-v2 shows the face and the limbs' form. | A soft highlight on the forehead and cheek; the eyes read better. Small gain. | Better (1.1 vs 3.1); the sheen band reads as form. |
| 10 | **Clear gain.** Flat is a black silhouette; skin-v2 is a deep brown with readable features. The hair now has highlights and reads dark grey rather than brown. | The eyes and nose read better; slightly lighter than flat (+0.5 L*). Small gain. | Better (0.9 vs 2.4); the figure reads as a rounded form, not a flat cut-out. |

More from the pictures:

- **Shadow edge.** The red shift at the terminator is real (it is in the table and the tests) but subtle. In the 2× three-quarter close-ups it shows as a softer, slightly warmer edge on the cheek and jaw; at phone size I cannot point to it. A stronger exaggeration was not tried.
- **Hair.** Head v3's hair is part of the body mesh, so it gets the same material. On Monk 8 to 10 under `classic` the hair now catches highlights and reads as shiny dark grey-brown rather than black; on Monk 8 a thin light line shows along the hairline in the close-up.
- **2D figure.** The change is subtle at frame size (the figure is small). In the close-ups the light tones look nearly the same, and the deep tones gain a sheen band down the lit side and a warmer shadow edge.

## Open issues

1. **Light tones under `classic` still look grey-white.** skin-v2 restores their hue but keeps ACES's lightness for contrast. Fixing both needs `neutral-v2` (its outline) or a decision to accept less contrast. With `neutral-v2`, Monk 1 to 5 are within 1.1 to 1.4 ΔE, flat or skin-v2.
2. ~~Head v3's hair shares the skin material.~~ **Fixed** (section "Head v3's hair under skin-v2"). What remains is head v3's own issue: on Monk 9 and 10 the hair is still a very dark shade of the skin, as in flat.
3. **Frame cost** is +17 to 25 % on SwiftShader, body alone. Not measured on a phone GPU or in the mount.
4. **The red terminator is subtle** at phone size; the exaggeration is a guess made by eye.
5. **The dress lets 15 % of the body through**, so a garment patch over skin changes by up to 1.2 ΔE with skin-v2 under `classic`. That is expected for a see-through cloth, but it is above "near 0".
6. **The 2D figure** is still 4 to 5 L* below the swatch on Monk 1 to 6 (it is shaded, and the swatch is its lit stop); Monk 6 is the furthest from its swatch at 5 ΔE.
7. **Primary source.** The Monk values and licence were checked against Wikipedia's citation of skintone.google, not against Google's page itself (it would not render here).
8. **Not tested:** the drape-bake mount, the production embed build with `VITE_AVATAR_SKIN=skin-v2`, and a real phone.
9. **A bug found in passing, not mine and not fixed:** `Figure.setBody` puts the shared grey material back on a figure that has a skin colour when the new geometry has the same vertex-colour setting (its final `else`). Only the spike's `main.ts` calls it. The skin-v2 rebuild in `setBody` returns before that branch.

## Verdict

**Ready for the founder's look review; not to be switched on by default yet.**

- **For it:**
  - Under today's `classic` lighting, skin-v2 clearly fixes the worst case of the review: Monk 8 to 10 no longer go near black and now keep their form, within about 1 to 1.5 ΔE of the swatch instead of 6.6 to 7.7.
  - Monk 2 to 7 lose the grey or orange cast.
  - The 2D figure is closer to its swatch on every tone and closer to the 3D body.
  - The garment is untouched (0.0 on the opaque tee).
- **Against it:**
  - Monk 1 hardly changes under `classic`.
  - It costs about a fifth more per frame on the software renderer.
  - Under `neutral-v2` the gain is small, because that lighting was already accurate.
- **My recommendation:** review it together with `neutral-v2` lighting, measure one real phone, and then decide. The hair material (open issue 2) is fixed.

## Merged with claude/garment-engine

`claude/garment-engine` (AI realism export passes, head v3 as the default, male shape v2, men's fit) is merged into this branch. Both sides' behaviour is kept:

- **Garment3D** takes both `aiRealism` and `skinShading`.
- **2D figure on the result** keeps the face tile `media` and gets `skinShading`.
- **Viewer index** exports both the passes and the skin helpers.
- **Spike look page** takes `maleShape` and `shading`.
- **AI realism passes:** `renderPasses` draws the body in the shared grey material, so neither a picked colour nor skin-v2 reaches them.
- **Head default:** `neutral-v3` stays the default.

The pictures above were taken before the merge, on the female body and male shape v1; the merged branch was not re-rendered, apart from the hair shots.

## Reproduce

```sh
pnpm install --frozen-lockfile && pnpm build:packages
# Synthetic bundles (no GPU) and their payloads
(cd spikes/garment-engine && npx tsx scripts/build-bundle.ts --skip-separation && npx tsx -e "import {spikeProduct} from './src/product'; import {writeFileSync} from 'node:fs'; for (const id of ['aalter-studio-2','synthetic-men-tee']) writeFileSync('out/'+id+'/payload.json', JSON.stringify(spikeProduct(id),null,2))")
# 3D: faces, bodies and skin colour (about 50 min on 4 cores), mount and garment (about 40 min), frame cost (about 15 min, run alone)
node spikes/garment-engine/viewer/skin-v2-renders.mjs /tmp/skin --only faces,bodies,patches
node spikes/garment-engine/viewer/skin-v2-renders.mjs /tmp/skin --only phone,garment
node spikes/garment-engine/viewer/skin-v2-renders.mjs /tmp/skin --only frames
# 2D figure: pictures and colour (about 2 min)
node apps/web/scripts/skin-2d-shots.mjs /tmp/skin
# Grids
node spikes/garment-engine/viewer/skin-v2-grid.mjs /tmp/skin docs/screens/claude/skin-v2
# Hair before/after: render the faces (and phone) once with the earlier build into /tmp/skin-before, once now into /tmp/skin
node spikes/garment-engine/viewer/skin-v2-hair-grid.mjs /tmp/skin-before /tmp/skin docs/screens/claude/skin-v2
# Unit tests
pnpm --filter @curtain/garment-viewer test && pnpm --filter @curtain/web test
# A build of the embed with skin-v2 (for the look review only)
VITE_AVATAR_SKIN=skin-v2 pnpm --filter @curtain/web build
```

Options: `SKIN_TONES=1,6,10`, `SKIN_FAMILIES=female`, `SKIN_LIGHTINGS=classic`, `SKIN_QUICK=1` (female, classic, faces only), `SKIN_SAMPLES=8` (frame runs); `SKIN2D_FAMILIES=female` for the 2D script.

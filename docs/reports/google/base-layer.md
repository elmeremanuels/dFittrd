# WO-009 · Base layer: plain fitted vest and briefs (CUR-22)

- **Model:** Gemini 4 Neon
- **Branch:** `google/wo-009-base-layer` (from `origin/claude/realistic-body` at `0a631f0`)
- **Decision:** D30 (base layer replaced by the garment), D25 / D26 (generated in code, zero external assets)
- **Allowed code files touched:**
  - `packages/garment-viewer/src/baseLayer.ts` (new)
  - `packages/garment-viewer/src/baseLayer.test.ts` (new)
  - `packages/garment-viewer/src/realisticBodyLoad.ts` (exports + `attachBaseLayer`)

---

## Done

1. **Procedural fitted vest and briefs (`packages/garment-viewer/src/baseLayer.ts`):**
   - Generates a fitted scoop-neck tank top (vest) and classic mid-rise briefs directly from the fitted realistic body mesh using marching-triangles clipping against smooth anatomical signed-distance fields (`evaluateFields` + 2-pass graph-Laplacian field smoothing).
   - Uses strictly outward-only normal displacement (`buildOutwardSurface`) with a broad spherical cloth dome over each front bust apex (so conical nipple peaks vanish smoothly into natural fitted-jersey contours on every body size) and outward-only Laplacian bridging over cleavage, navel, and pelvic/gluteal creases — preventing skin poke-through on all five test bodies (`slim`, `mid`, `full`, `tall`, `petite`).
   - Smooths cut-edge boundary loops tangentially (4 passes, never pulling inward) and adds a narrow tucked hem lip along every cut edge (`hemOffsetCm → 0.03 cm`) so straps, scoop neckline, armholes, waist hem, and briefs leg cuts sit crisply against skin.
   - Uses one plain neutral matte `MeshStandardMaterial` (`BASE_LAYER_COLOUR = '#989189'`, warm stone grey, `roughness: 0.92`, `metalness: 0`, `map: null`, `polygonOffset`) shared across vest and briefs, with zero external textures or third-party assets.
   - Supports optional `conformedMesh` switching in `createBaseLayer`: when a garment is mounted and the body is conformed inside the garment's collision field (`conformToField`), the uncovered base-layer piece automatically switches to a tighter-offset conformed geometry (`0.14–0.16 cm`) so overlapping hems (e.g. a long tee over briefs) do not clip through.
2. **D30 garment replacement rules (`baseLayerVisibility`):**
   - No garment / `garmentShown: false` / `shoes` / `accessory`: `{ vest: true, briefs: true }`.
   - `top` / `outerwear` (`shirt`, `tee`, `t-shirt`, `blouse`, `sweater`, `jacket`, `coat`): `{ vest: false, briefs: true }`.
   - `bottom` (`skirt`, `trousers`, `pants`, `shorts`, `jeans`): `{ vest: true, briefs: false }`.
   - `dress` (`jumpsuit`, `playsuit`, `overall`): `{ vest: false, briefs: false }`.
3. **Attachment boundary (`packages/garment-viewer/src/realisticBodyLoad.ts`):**
   - Re-exports the base layer API and adds `attachBaseLayer(figure, mesh, asset, drawn, options)` inside the lazy `realisticBodyLoad` chunk so zero bytes are added to the main `garment-viewer` chunk.
   - Per WO-009's file allowlist, `mount.ts` was not edited. Wiring `startRealisticBody` in `mount.ts` takes four lines: call `mod.attachBaseLayer(figure, r.plain, asset, plan.drawn, { conformedMesh: r.conformed, coverage: { category: anchors.category, garmentShown: shown } })`, update via `baseLayer?.setCoverage({ category: anchors.category, garmentShown: v })` in `garmentShown`, and call `baseLayer?.dispose()` in `stop()`.

---

## Measured

### Mesh complexity & anatomical coverage (all 5 test bodies)

| Body | Vest triangles | Briefs triangles | Total triangles | Nipples / areola covered | Pubic / crotch / gluteal covered |
|---|---:|---:|---:|---|---|
| `slim` (164 cm, 80/62/88) | 2,990 | 1,154 | 4,144 | Pass (`vestField > 1.5`) | Pass (`briefsField > 0.5`) |
| `mid` (168 cm, 92/74/100) | 2,991 | 1,174 | 4,165 | Pass (`vestField > 1.5`) | Pass (`briefsField > 0.5`) |
| `full` (170 cm, 116/98/122) | 3,027 | 1,178 | 4,205 | Pass (`vestField > 1.5`) | Pass (`briefsField > 0.5`) |
| `tall` (182 cm, 92/74/100) | 3,000 | 1,154 | 4,154 | Pass (`vestField > 1.5`) | Pass (`briefsField > 0.5`) |
| `petite` (152 cm, 84/66/92) | 2,993 | 1,166 | 4,159 | Pass (`vestField > 1.5`) | Pass (`briefsField > 0.5`) |

### Frame time & build time (SwiftShader CPU, headless Chromium, 390 × 844 @ 2×)

Measured on the same warmed WebGL2 stage (`mid` body + procedural skin + studio light, same camera), 3 alternating runs × 24 orbit frames with a synchronous `gl.readPixels(0, 0, 1, 1)` fence (full raw runs in `docs/screens/google/base-layer/renders.json`):

| Metric | Without base layer | With base layer (vest + briefs) | Delta |
|---|---:|---:|---:|
| Median frame time (mean of 3 runs) | 864.27 ms (`788.2 / 698.1 / 1106.5`) | 853.80 ms (`711.2 / 888.3 / 961.9`) | −10.47 ms (within CPU noise) |
| Mean frame time (mean of 3 runs) | 1,118.33 ms | 909.45 ms | −208.88 ms (run-1 tail noise) |
| P95 frame time (mean of 3 runs) | 1,517.80 ms | 1,377.70 ms | −140.10 ms |
| One-time base-layer mesh build (`mid`) | — | 275.9 ms | one-time on fit |

Because the opaque matte vest and briefs use a standard shader (`MeshStandardMaterial`, `renderOrder = 1`) and add only ~4,165 triangles while occluding procedural-skin fragments underneath, frame-time impact on SwiftShader CPU is within run-to-run noise.

### Bundle & chunk gates

- `apps/web/scripts/check-viewer-chunk.mjs`: **PASS** — `garment-viewer-iKOEh63K.js 189.7 KB gzip of 400 KB` (0 bytes added to main viewer chunk; `three.js` in no other chunk; not precached).
- Lazy chunk `realisticBodyLoad-DItCYowN.js`: `38.91 KB` raw / `16.52 KB` gzip (not precached).
- `scripts/check-bundle-secrets.mjs`: **PASS** — no secret-looking strings in client bundles.
- `scripts/check-language-packs.mjs`: **PASS** — `en` on all 5 surfaces.

### Automated checks

- `pnpm --filter '!@curtain/woocommerce-plugin' --filter './packages/**' build`: **PASS** (9/9 packages).
- `pnpm --filter '!@curtain/woocommerce-plugin' typecheck`: **PASS** (14/14 workspace projects).
- `pnpm --filter '!@curtain/woocommerce-plugin' lint`: **PASS** (14/14 workspace projects, 0 errors, 0 warnings).
- `pnpm --filter @curtain/garment-viewer test baseLayer realisticSkin realisticBody`: **PASS** — 4 test files, **72/72 tests passed** (10 in `baseLayer.test.ts` covering all D30 replacement cases — none, top, bottom/skirt, dress, shoes/accessory — live visibility toggling, `conformedMesh` switching, nipple/pubic/crotch/gluteal coverage on all 5 bodies, `attachBaseLayer` attach/dispose, and lazy-chunk isolation).
- `pnpm build:apps`: **PASS**.

### Visual sheets (`docs/screens/google/base-layer/`)

- `docs/screens/google/base-layer/five-bodies-front-3q-back.png` — Five test bodies (`slim`, `mid`, `full`, `tall`, `petite`), front, three-quarter, and back without a garment (vest + briefs visible).
- `docs/screens/google/base-layer/five-bodies-with-garment.png` — Five test bodies, front, three-quarter, and back with draped shirt dress (`aalter-studio-2`, D30 hides both vest and briefs).
- `docs/screens/google/base-layer/d30-replacement-and-tones.png` — Row 1: D30 replacement across no garment (vest + briefs), draped top (`monochrome-03`, briefs only), bottom skirt (vest only), and draped dress (`aalter-studio-2`, both hidden); Row 2: light (Monk 2 `#f3e7db`), medium (Monk 6 `#a07e56` ¾), deep (Monk 9 `#3a312a`), and `full` body back close-ups.
- `docs/screens/google/base-layer/renders.json` — Triangle counts, visibility states, build time, and 3× alternating frame-time runs.

---

## Not verified

- **Real phone GPU frame time:** Measured only on headless Chromium SwiftShader (CPU software WebGL2, 390 × 844 @ 2×), not on a physical iOS/Android GPU.
- **`@curtain/woocommerce-plugin` (`php -l`):** `php` is not installed on this macOS host, so WooCommerce PHP lint/build was skipped (no PHP files were touched).
- **Live `mountGarmentView` integration:** `packages/garment-viewer/src/mount.ts` is outside WO-009's allowed file list, so `attachBaseLayer` was verified directly against `Stage`, `Figure`, `realisticBodyFor`, `conformToField`, `realisticSkinOf`, and real draped `@curtain/garment-spike` bundles (`monochrome-03`, `aalter-studio-2`), not via `mountGarmentView` itself.
- **External evaluated shop dress bundles (e.g. `eval/azure-palm-baby-doll-dress`):** Gitignored and not present in this checkout; visual garment checks used the repo's deterministic spike bundles (`monochrome-03` top and `aalter-studio-2` dress) plus a fitted procedural skirt for the `bottom` state.
- **Male realistic body:** Only the female realistic body (`female-v1.crb`) exists in the repo; male base layer is out of scope for WO-009.

---

## Open issues

- **Wiring `mount.ts` (for Claude):** Connect `mod.attachBaseLayer` inside `startRealisticBody` in `packages/garment-viewer/src/mount.ts` (passing `conformedMesh: r.conformed` and `coverage: { category: anchors.category, garmentShown: shown }`) and hide `BASE_LAYER_GROUP` in `passesOf` only if the AI realism layer expects bare/garment passes without base layer (or keep visible per D30).
- **Shoulder clipping in synthetic spike bundles:** In `five-bodies-with-garment.png` and `d30-replacement-and-tones.png`, minor deltoid clipping on `monochrome-03` and `aalter-studio-2` is inherent to those synthetic spike garment meshes on the realistic body (the vest is hidden under both garments).

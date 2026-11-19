# Report: AI realism layer (D22), branch `claude/ai-realism`

19 Nov 2026.

- Research and design: `docs/research/ai-realism-layer.md`, with source notes in `docs/research/ai-realism-sources/`.
- Screenshots: `docs/screens/claude/ai-realism/`.
- Everything ships behind the server flag `AI_REALISM`, which is **off** by default. With the flag off, nothing changes for shoppers.

## What the founder gets

1. **Research (read at the source today; quotes and URLs in the doc).**
   - **Primary: fal.ai Z-Image-Turbo ControlNet.**
     - Apache-2.0 weights.
     - Our depth pass goes in as the control image.
     - $0.0065 per MP.
     - No training on client content.
     - Storage off per request.
     - No documented EU or AU region; zero retention needs a sales contract.
   - **Fallback: the same weights self-hosted on Modal `eu`.** EU region, nothing kept, identical behaviour, so the same thresholds apply.
   - **Withdrawn this year:** most first-party structure control (Vertex Imagen controlled customisation, Nova Canvas, BFL FLUX.1 Depth/Canny [pro]).
   - **Rejected:**
     - BFL EU: trains on inputs, with no opt-out found.
     - FLUX.1 [dev] ControlNets: non-commercial.
   - **On the device: not feasible today.** The best native number is 512² in 9.4 s on an iPhone 17 Pro Max, with no structure control. The browser takes about 22 s on a desktop GPU after a 6.5 GB download.
   - **Six non-commercial models added to `bannedModels.ts`:** FLUX.2 klein 9B, FLUX.1 Depth/Canny dev, IC-Light v2, SDXL-Turbo, RMBG-2.0.
2. **Proof the layer does not lie.**
   - Checks: silhouette and garment IoU, garment colour CIEDE2000, hem shift, waist-line shift, waist and hip widths, and the shown size against its neighbour.
   - Any one of them refuses the image. Thresholds and reasons are in §2 of the doc.
   - Every answer, image or refusal, is labelled `ai-enhanced-estimate` with the estimate disclaimer. The embed shows **"AI-enhanced estimate"** in every state.
3. **Plumbing behind the flag:**
   - The viewer's `exportPasses()`: colour, depth, normals, garment and figure masks, neighbour mask, waist and hip rows; standard head and colour; the view is restored after.
   - A strict wire schema with no photo, face or person field.
   - `POST /v1/renders/realism`: 404 with the flag off; passes guard → adapter → checks; image inline, nothing stored; one ledger line.
   - A fake provider that can lie in six ways, and the fal adapter (fake transport only).
   - The embed panel next to the 3D view.
4. **Next step (recommendation):**
   - Open a fal.ai pay-as-you-go account and ask sales for zero retention and the region.
   - Pilot cost: about USD 1 per shop per month, at most 2.60 with the cap; about USD 5–13 a month for five shops.
   - Keep the flag off until the bake-off on real output, the per-shop cap, the printed-garment segmentation and Naomi's review are done (doc §6).

## What the real browser run found (and fixed)

The synthetic fixture passed everything first time. The real WebGL export (`apps/web/e2e/aiRealism.spec.ts`, POM v2 rest fixture) found two bugs:

- **Garment key too strict for real shading.**
  - Symptom: a *faithful* image was refused (garment IoU 0.848, widths off by 5–6 cm), because the lit edges of the skirt lose chroma.
  - Fix: chromatic garments are now keyed by hue (±20°, at least 35 % of the chroma).
  - Result: the faithful image passes with IoU 0.996, and every lie is still refused.
- **No room under the hem.**
  - Symptom: the screen frame left about 8 px under the hem, so a 4 cm hem move measured 1 cm and passed.
  - Fix: the passes use their own front frame with 16 % margin (`passFrame`).
  - Result: the same lie now measures 3.98 cm and is refused.

That export is frozen as a regression test that runs in `pnpm check` (`packages/tryon-providers/fixtures/realism-pom-v2-rest-10`, `realExport.test.ts`).

## Tests

- **`tryon-providers`:**
  - `realism.test.ts`: the pass guard refuses a photo-like picture, soft masks, depth off the figure and non-unit normals. A moved hem, a recolour, the neighbour size, widening and a repainted backdrop are each refused. Mild relighting passes. Labels are present. Banned models and the cost cap are refused.
  - `realExport.test.ts`: the same on the real export.
  - `falZImage.test.ts`: only the depth pass and the prompt are sent, with `x-fal-store-io: 0`; errors map to typed errors.
- **`apps/api` `realism.test.ts`:**
  - Flag off: 404 and no provider call.
  - No photo accepted: `person`, `photo` and `faceImageBase64` fields, an extra pass key, a wrong `kind`, a JPEG pass and a textured background all give 400 or 422, before any provider call.
  - A moved hem and a changed colour are refused, with the label.
  - The fake provider and a fal provider without a key are refused in production.
- **`apps/web` `aiRealism.test.tsx`:**
  - The request matches the strict schema and carries no photo, face or measurement key.
  - The label is there before, during and after, and on a refusal.
  - No panel without the flag.
  - The panel sends the exported passes.
- **`garment-viewer` `passes.test.ts`:** the pure helpers and the pass frame.
- **`e2e/aiRealism.spec.ts`** (not in `pnpm check`; SwiftShader, emulated phone, not a real phone): with the flag on, a faithful image is shown labelled and a moved hem is refused; with the flag off there is no panel. Passed 2/2 on 19 Nov 2026.

`npm_config_workspace_concurrency=1 pnpm check`: see the result at the end of this file.

## Screenshots (`docs/screens/claude/ai-realism/`)

| File | Shows |
|---|---|
| `flag-on-before.png` | Flag on: the panel under the 3D view, labelled, with consent first |
| `flag-on-faithful-size-10.png` | The checked image, labelled twice, with caption and disclaimer |
| `flag-on-refused-hem-size-8.png` | The hem moved 4 cm: refused, "The length moved.", no picture, still labelled |
| `flag-off.png` | Flag off: the 3D view as before, no panel |
| `pass-10-*.png`, `pass-10-neighbour-12-garmentMask.png` | The exported passes as the server received them |
| `checks.json` | The request keys and the checks' metrics for both runs |

The "AI" picture in these screenshots is the **fake provider's** output: the colour pass with grain. No real model was called; there was no key and no paid call. Production refuses the fake provider.

## Not done, and why

- No call to any real provider: no keys, and no paid calls by rule. The fal fields `image_size` and `sync_mode`, the ControlNet checkpoint fal runs, and real latency are **not verified**.
- No Modal adapter: it is the fallback's next step, and there were no GPU runs by rule.
- No per-shop monthly cap yet. Today there is a per-request cost cap and a per-IP rate limit. It is needed before the flag goes on.
- Printed garments: the colour-key segmentation is for plain colours, and a print is refused as unverifiable or by the outline checks. Learned segmentation (MediaPipe multiclass, Apache-2.0) is next.
- The route is synchronous (60 s provider timeout). If real latency is long it can move to the job queue.
- `apps/web/src/embed/__tests__/avatarPrompt.test.tsx` failed once in a full embed run during this work (a timing flake). It passed alone and in two more full runs. That test is not touched by this branch.
- `packages/fit-engine`, `.github/` and `.github/modal/run.txt` are untouched.

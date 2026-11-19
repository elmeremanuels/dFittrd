# Slice 6 spike: the shopper's face on the 3D head, on the device

Branch `claude/face-on-head-spike` (from `claude/garment-engine`), 19 Nov 2026. Written by an AI agent.
Plan: `docs/research/photo-avatar-plan.md` slice 6, read with the D19 update box and
`docs/legal/avatar-consent-copy.md` (variant A).

## Verdict

**No-go for building slice 6 as planned (5 agent-days) now. Go for one more, narrower spike first.**

The mechanics work and are cheap: one picture becomes a face on the mannequin's 3D head in about
1 s in this container, entirely on the device, with nothing sent (a test proves it). But what it
looks like is not good enough to ship. From the front at close range it reads as *a face painted on
a mannequin*, not as *you*: the photo's eyelids sit on top of the sculpted eyelids, the photo's nose
shadow sits on top of the 3D nose, and the shopper's proportions are pulled onto the mannequin's
(that is how the method works). At the normal phone view (the whole figure, the head about 60 px
high) the face adds little that slice 5's 2D "you" chip does not already give. On the light tone it
picks up a grey, slightly metallic cast from the photo's cool fill light. It is not a hard-edged
pasted mask (the edge and the turn-away fade both work), but it is uncanny.

What it would take to say go (estimate, about 6 to 8 agent-days on top of what is here, plus G1):

1. **A "face-ready" head**: head v2 with the eye, lid and lip relief flattened (and the painted
   shade off) when a face is on, so the photo's features are not doubled by the sculpt. 1 to 2 days,
   in `packages/mannequin`.
2. **Keep the shopper's proportions**: fit the head's face region to the landmarks (a few
   morph targets driven by eye spacing, face width, nose and mouth position) instead of normalising
   the photo to the mannequin. 2 to 3 days. Without it the result never looks like the person.
3. **Better de-lighting**: the quadratic fit here removes a side light and a colour cast, not the
   photo's own shading of the nose and the eye sockets. Needs an albedo step (e.g. shading from
   the canonical mesh's normals under an estimated light) and a capture-time light check
   (slice 4's gates). 2 days.
4. **A test on a real mid-range phone with real, consented photos** across Monk 1 to 10. This spike
   ran on synthetic faces in a container with a software GPU; nobody has seen a real face on it.
   This is the one-day "real phone" spike the plan asked for, and it is still owed.
5. Counsel (G1, D20.4) before any of it reaches a shopper.

Until then slice 5 (the face in 2D and the "you" chip) remains the answer, as the plan foresaw.

## A finding that matters beyond this spike: MediaPipe phones home

The network test caught a request the code never asked for: **`POST https://odml.pa.googleapis.com/v1/log`**,
from the scan worker. `@mediapipe/tasks-vision` 1.2.2 (the version pinned in `apps/web`) creates a usage
logger with every task (FaceLandmarker, PoseLandmarker, ImageSegmenter and the others). Every 60 s, and
when the task closes, it sends a protobuf (`application/x-protobuf`) with an `x-goog-api-key` header. From
reading the minified bundle, the message holds the task type, the running mode and timing counters, not
pixels or landmarks. I did not decode a real message, and I found no option to switch it off.

This is not specific to the face spike. **The existing capture step (face and body scan) has made the same
request** whenever its models were present. `privacy.spec.ts` never saw it because CI runs without the
models, so the worker falls back before any task starts. It breaks D3 ("onboarding makes zero
third-party requests") as written. It carries no photo, but it does tell Google that a Curtain shopper
used the face landmarker just now, from their IP address.

Fixed on this branch: `apps/web/src/features/capture/sameOriginOnly.ts`. The worker wraps `fetch` and
`XMLHttpRequest` before any task exists and refuses every request to another origin (MediaPipe catches
the error and stops its timer). Unit-tested, and the e2e test now passes with the origin check in force.
Two more things are needed: a `connect-src 'self'` CSP for the app and the embed as a second wall (not
checked here), and a privacy e2e that runs **with** the models, so this cannot come back unseen. During
this spike's own measurement runs, before the guard existed, these log requests probably went out from
this container through its proxy. They carried synthetic usage only.

## What I built

All behind `VITE_AVATAR_FACE_ON_HEAD=1`, **off by default**. In normal builds the face row stays as it
was: hidden, or the disabled "coming soon" line with `VITE_AVATAR_FACE_PHOTO=1`.

| Where | What |
|---|---|
| `apps/web/src/features/capture/faceBake.ts` | The bake, pure (no DOM, no network): piecewise-affine warp of the photo over MediaPipe's 898 canonical triangles into a 512 px face texture in the head v2 face frame; feathered edge; at the edge only skin-like pixels kept (hair over the forehead fades out); crude de-light (a quadratic light field per colour channel, fitted to the skin only); per-channel match of the median to the confirmed swatch; head yaw and roll from the landmarks. `rematchFaceTexture` recolours a baked face when the swatch changes, without the photo. |
| `apps/web/src/features/capture/faceMeshUv.json` | 18.1 KB (7.8 KB gzip): the canonical triangles and, per landmark, its point on head v2 (eyes, nose tip, mouth line aligned by least squares: sx 1.00, sy 0.825). Built by `scripts/build-face-mesh-uv.mjs` from the pinned, hash-checked source. Imported by the worker, so no extra request. |
| `scan.worker.ts`, `workerProtocol.ts`, `scanSession.ts` | New `faceTexture` message: bitmap in (transferred, closed in the worker), texture + a few numbers + timings out. **The 478 landmarks never leave the worker.** Init can skip the 16 MB segmenter (`needSegmenter: false`) and force a delegate (measurement only). |
| `apps/web/src/features/capture/sameOriginOnly.ts` | The worker refuses every request off its own origin (see the finding above). |
| `apps/web/src/features/capture/faceOnHead.ts` | Main-thread flow: decode (scaled to at most 1280 px) → worker with only the Face Landmarker → bake → worker disposed before the face is drawn. |
| `packages/mannequin/src/faceUv.ts` | `FACE_UV_FRAME` (a flat frame in head v2 unit cm) and `faceUvOf(mesh)`: a planar UV for every head v2 vertex. A test ties it to the JSON. |
| `packages/garment-viewer/src/faceOverlay.ts`, `scene.ts`, `mount.ts` | `Figure.setFace`: a thin copy of the front of the head with the texture, drawn over it (polygon offset), fading out between 38° and 58° from the front. The body and its material are untouched; removing the face is removing one mesh. `AvatarLook.face` (only with `head: 'neutral-v2'`), settable with `setLook`. |
| `packages/garment-viewer/src/figureView.ts` | `mountFigureView`: the figure alone (no garment), drawn on demand, for the harness. |
| `apps/web/src/embed/AvatarPrompt.tsx`, `strings/en.ts` | With the `faceOnHead` prop (only the flag-on harness passes it) the face row is live with variant A of the copy, word for word: C6, C7, C9, "Yes, use my photo" / "No, keep the standard face" (same size and weight, G2), C27 under the avatar, C4 in the footer. The file input is created only on the yes press and removed after. Strings are in the English catalogue (D21); a test checks them against the copy document. |
| `apps/web/dev/face-on-head.html`, `src/dev/faceOnHeadHarness.tsx` | Dev-only harness (Vite dev only, never bundled): the real prompt, the real worker, the shipped viewer. |
| `apps/web/e2e/faceOnHead.spec.ts` (+ `faceOnHead.config.ts`) | The network trap over the whole flow (below), and the flag-off check. |
| `apps/web/e2e/fixtures/synthetic-faces/*.jpg` | Seven synthetic test faces, 344 KB in all. |
| `spikes/garment-engine/viewer/synthface*.{html,mjs}`, `src/synthFaceMain.ts` | Their generator: the mannequin's own head v2 geometry, painted per vertex (sclera, iris, brows, lips, hair, blush, freckles or stubble), three people, each with their own head proportions, under a warm side light, an even light and one turned 25°. Not photos of anybody. |
| `apps/web/scripts/face-on-head-shots.mjs` | The pictures and the timings in this report. |
| `docs/LICENSES.md` | Rows for the canonical mesh, the Face Landmarker model and the synthetic faces. |

Not touched: `packages/fit-engine`, `packages/schema/src/garment.ts`, the About-you form, `.github/`.
No `'userPhoto'`, no server route, nothing stored.

## Privacy: what the test proves

`apps/web/e2e/faceOnHead.spec.ts` runs the harness on its own Vite dev server (no HMR, so no
WebSocket) and goes through the whole flow: pick a swatch, switch "Use my face" on, say yes, choose
the picture, wait for the worker to load and bake, see the face, switch it off (C9 shown, face gone).

- In the page, `fetch`, `XMLHttpRequest`, `WebSocket` (and `send`), `navigator.sendBeacon`,
  `EventSource` and `RTCPeerConnection` are wrapped: **none is called** during the flow. Vite's dev
  client opens its own WebSocket at page load, and the module worker's dev client opens one more when
  the worker starts. Both are dev-server artefacts (not in a production build), and the test requires
  that **no frame is sent** on any socket during the flow.
- At the network level, every request of the flow is a same-origin GET or HEAD **with no body**
  (this is what caught MediaPipe's usage log; it passes since `sameOriginOnly.ts`),
  for a module, a font or a model file. This level also sees the worker's own requests: the test
  requires the face model and the WASM runtime downloads to appear there, which they only do from
  the worker. So a POST from the worker would be seen too. The segmenter and pose models are
  required **not** to be fetched.
- No file input exists before the yes press.
- The trap is self-tested at the end with a POST it must catch.
- With the flag off, the face row is not there at all.

Also `faceBake.test.ts` stubs the four network APIs to throw during a bake and checks that the result
holds the texture and six numbers, never the landmarks.

Limits of that proof: it covers this harness, not the embed (the embed does not wire the face yet;
see open issues). The worker keeps the landmarks only inside one function call; no test can see
the inside of the worker's heap.

## Measured

Setup: headless Chromium (Playwright), **SwiftShader** (software WebGL), page 412 × 915 CSS px at 2×,
DevTools CPU throttle 4×, Vite dev server on localhost (no network latency), container CPU Intel
Xeon 2.1 GHz, 4 cores. **Not a phone.** Raw numbers: `docs/screens/claude/face-on-head-spike/face-on-head.json`.

Time per step, landmarker on the CPU (XNNPACK), 3 runs per tone (run 1 with an empty cache), ms:

| Tone | decode | worker start + model load | detect | pixels | bake | picture → texture | picture → face drawn (wall) |
|---|---|---|---|---|---|---|---|
| Monk 2 | 30–56 | 416–473 | 248–286 | 5–16 | 311–361 | 1089–1110 | 1700–2020 |
| Monk 6 | 27–34 | 388–425 | 251–277 | 6–7 | 302–355 | 1006–1077 | 1400–1940 |
| Monk 9 | 29–40 | 441–469 | 253–335 | 6–7 | 295–319 | 1045–1160 | 1340–1480 |

With the "GPU" delegate (here SwiftShader, a software GPU) detection takes 2.2–2.3 s and the total
about 3 s. That number says nothing about a phone's real GPU; on a phone the GPU delegate should be
the fast one, but that is not measured.

**The 4× throttle did not slow the worker.** The bake took 311 ms both unthrottled and throttled,
while the main thread's decode went from 8 ms to 30–56 ms. So the worker columns (start, detect,
bake) are this container's unthrottled CPU. For a mid-range phone, assume roughly 3 to 5 times
longer: about 3 to 5 s from picture to face. That factor is assumed, not measured.

The bake itself (warp, two blurs, the quadratic fit, the edge gate) runs in one pass in JS. It can be
cut by baking at 384 px, or by moving the warp to WebGL.

Downloads for the face flow (the same files the capture step already uses; the service worker
caches `/models/` after the first time):

| File | Raw | gzip -9 |
|---|---|---|
| `wasm/vision_wasm_module_internal.wasm` | 14.6 MB | 4.1 MB |
| `wasm/vision_wasm_module_internal.js` | 334 KB | 81 KB |
| `face_landmarker.task` | 3.76 MB | 3.33 MB |
| `faceMeshUv.json` (in the worker chunk) | 18.1 KB | 7.8 KB |

Cold, that is about 7.5 MB over the wire if the server compresses (production serving of `/models`
is still gate G8). Skipping the segmenter saves 16.4 MB against today's face step.

Texture: 512 × 512 RGBA = **1,048,576 bytes** in memory (plus GPU mipmaps, about 1.4 MB). It is never
encoded; the PNGs in this folder (235–275 KB) were made only for this report, in the page.

Other numbers from the bake: the texture covers 56–58 % of its square. The yaw estimate read 30.8°
for the face rendered at 25°, so it overshoots by about a fifth; the "turned" warning (over 15°)
fired correctly. The de-light gain spread (5th to 95th percentile) was 0.84–1.48 on Monk 2 and
0.65–1.80 on Monk 6 and 9, hitting the 1.8 clamp on the shadowed side.

## Assumed, not measured

- Phone speed (the factor above), phone GPU behaviour, memory pressure on a phone, iOS Safari
  (`OffscreenCanvas` in workers, `createImageBitmap` options) and the embed iframe.
- Real faces. The synthetic faces have clean, painted features, a hard hairline and no glasses,
  beard volume, make-up, piercings, head covering, motion blur or JPEG noise. MediaPipe found all 7
  of 7 (and the plain mannequin at Monk 2, 6 and 9). Real photos will be worse, and the edge gate
  is tuned on these seven only.
- That recognisability survives the proportion normalisation. I could not test it: with
  synthetic people nobody can say whether a face "looks like them".
- Licences beyond the two MediaPipe sources read at source (rows in `docs/LICENSES.md`). Not a lawyer.

## The screenshots (docs/screens/claude/face-on-head-spike/), honestly

All carry the "Estimate · not measured" badge. Close-ups are the canvas at 2×.

- `prompt-face-row.png`, `prompt-face-ask.png`: the prompt with the live row. C6 and C7 read clearly;
  the yes and no buttons are equal; the Monk credit is under the swatches. Looks like the rest of the
  embed. The title wraps onto two lines at 412 px, as it already did.
- `phone-a-before.png` against `phone-a-face.png`, `phone-b-face.png`, `phone-c-face.png`: head and
  shoulders at phone size (a flattering framing; the embed shows the whole body). Monk 6 reads
  best: brows, eyes, stubble and lips are clearly the person's. Monk 2 looks greyish and cold around
  the nose and jaw, close to metallic: the photo's cool fill light survives the de-light. On Monk 9
  the features are visible but low in contrast, apart from the eye highlights, which are too bright
  and glassy against the deep skin. Under the canvas: "Your face on an estimated body" (C27).
- `body-b.png`: the whole figure, as the embed frames it. The face is about 25 px high; it reads as
  "a face", not as anyone.
- `close-{a,b,c}-standard.png` against `close-{a,b,c}-yaw0.png`: the plain head v2 next to the same
  head with the face. **Uncanny.** The doubled eyelids are the worst part (painted lids over sculpted
  lids, with the iris a little off the sculpted one). The photo's nose shadow darkens the right side
  of the 3D nose. A faint stepped seam runs across the forehead where the synthetic hairline was
  (much better than the hard strip of hair in the first try, but still visible up close). From the
  front there is no visible edge round the face, and the skin colour joins the body without a seam.
- `close-{a,b,c}-yaw30.png`, `close-c-yaw55.png`, `close-b-yaw80.png`: the face fades into plain
  skin as the head turns. It never shows as a flat sticker from the side. At 30° the near cheek has
  a soft but visible change from photo skin to plain skin; at 55° only the far half of the face is
  left; at 80° there is almost nothing, which is right for a single front photo.
- `close-b-turned.png`, `phone-b-turned-prompt.png`: a face turned 25° in the picture. The prompt
  shows "Your head is turned. A picture straight from the front works best." The result has one
  cheek stretched and the shadowed side clamped: it should be retaken, not shown.
- `close-{a,b,c}-even.png`: from pictures in even light. They look somewhat better than the side-lit
  ones (no cast), so the light in the photo still matters a lot; slice 4's light checks are needed.
- `texture-{a,b,c}.png`: the baked textures themselves, transparent outside the face.
- The synthetic inputs are in `apps/web/e2e/fixtures/synthetic-faces/`.

## Open issues

- The embed is not wired: `Garment3D` does not pass `look.face`, and `EmbedApp` does not pass the
  `faceOnHead` row (no garment bundle is in this checkout to test the 3D drape with). The viewer side
  (`mountGarmentView` with `look.face`) is built and unit-tested, not seen in a browser with a garment.
- The hero render must never take the face. `look.face` is a viewer-only value. When the embed is
  wired, the hero allowlist test needs a case with a face present (gate G3).
- The face is not kept anywhere (not even with "Remember me"); slice 7 territory.
- No real-phone run, no iOS run.
- `calmHead` widens the head by a few per cent with the bust; `faceUvOf` reads the widened head, so
  the face maps up to about 6 % narrower than drawn on large bodies.
- The yaw estimate overshoots by about 20 %.
- The worker's GPU path under SwiftShader is slow and was the first default; real phones need the
  GPU-vs-CPU choice measured, not assumed.

## Checks

`npm_config_workspace_concurrency=1 pnpm check` passes (one UI test, `avatarPrompt.test.tsx`, timed out once under
load and passed when run alone). The viewer chunk is 167.4 KB gzip of its 400 KB budget. The face-on-head e2e test
(not part of `pnpm check`, it needs the models) passes: 2 of 2.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
node apps/web/src/features/capture/scripts/fetch-models.mjs          # models into apps/web/public/models (git-ignored)
node apps/web/src/features/capture/scripts/build-face-mesh-uv.mjs    # rebuilds faceMeshUv.json (downloads the pinned OBJ, checks its hash)
node spikes/garment-engine/viewer/synthface-renders.mjs              # rebuilds the synthetic test faces
pnpm --filter @curtain/web exec vitest run src/features/capture/__tests__/faceBake.test.ts
pnpm --filter @curtain/garment-viewer exec vitest run src/faceOverlay.test.ts
pnpm --filter @curtain/mannequin exec vitest run src/faceUv.test.ts
cd apps/web && pnpm exec playwright test -c e2e/faceOnHead.config.ts --trace off   # the network trap
node apps/web/scripts/face-on-head-shots.mjs <out dir> --runs 3      # pictures + face-on-head.json
# by hand: VITE_AVATAR_FACE_ON_HEAD=1 pnpm --filter @curtain/web dev, then open /dev/face-on-head.html?skin=6&prompt=1
```

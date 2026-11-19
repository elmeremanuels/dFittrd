# Slices 4 and 5: skin tone from a face photo, and the shopper's own face in 2D, on the device

Branch `claude/face-2d-slice5` (from `claude/garment-engine`, with `claude/face-on-head-spike` merged
in), 19 Nov 2026. Written by an AI agent. Plan: `docs/research/photo-avatar-plan.md` slices 4 and 5,
read with the D19 update box, D20 and D21; copy: `docs/legal/avatar-consent-copy.md`, variant A
(nothing leaves the device). The spike's verdict (the 3D face is uncanny up close; build slice 5
first) is followed: the 3D view keeps the standard face.

## Bottom line

- **Built, behind the existing flag, off by default.** `VITE_AVATAR_FACE_PHOTO` now has three
  values: unset (every normal build: no face row), `1` (the disabled "coming soon" row, unchanged)
  and `live` (slices 4 and 5). Normal builds and the `1` build look and behave exactly as before;
  a test checks each. Counsel has not answered (D20.4), so nothing here reaches a shopper.
- **Slice 4:** "Match my skin tone" offers "Read it from my photo". After C26, the age line and an
  unticked age box, "Yes, use my photo" opens two equal buttons ("Take a photo", "Choose a photo").
  The photo is read in the scan worker; the row then marks the suggested swatch and its neighbours
  and says "Your photo points to colour N of 10, or one next to it." **The avatar's colour does not
  change until the shopper taps a swatch** (plan gate G4); a test checks the colour before and after.
- **Slice 5:** "Use my face" (C6, C7, the age line and box, "Yes, use my photo" / "No, keep the
  standard face" of the same size and weight) turns the photo into a **stylised face tile** in the
  worker. It is drawn on the 2D head, shown large in a round chip on the figure (the head is only
  about 28 CSS px wide on a phone), with "Your face on an estimated body" (C27) under the figure and
  the estimate label on it as always. It is recoloured to the confirmed swatch on the main thread.
- **Nothing is sent.** The e2e test runs the whole flow in a production build, in the embed framed by
  a shop page, with the real worker and the real Face Landmarker on a synthetic face: no fetch, XHR,
  WebSocket, sendBeacon, EventSource or RTCPeerConnection call in any frame, no postMessage to the
  shop page, and every request on the network (the worker's included) is a same-origin GET with no
  body for a script chunk or a model file.
- **Remembered only as D20 allows:** in memory by default; with "Remember my photo on this device"
  (C19, off at first) and "Remember me" on, the tile (never the photo, never a landmark) is stored
  per shop, AES-GCM with its own non-extractable key. "Delete my photo" (C20), switching the face off
  (C9), "Remember me" off and "Forget me" remove it; a returning shopper who said yes sees the face
  at once.

## What I built

| Where | What |
|---|---|
| `apps/web/src/features/capture/faceTile.ts` | Pure (no DOM, no network, no storage). `buildFaceTile`: eye line levelled, face oval (MediaPipe mesh boundary) scaled with one scale for both axes into a tile with the 2D head's aspect (the shopper's proportions are kept), each pixel averaged over a grid of photo pixels, soft oval edge, a fitted plane of side light taken out of the lightness, a small bilateral blur (two rounds), local contrast and soft lightness steps (a drawn look; eyes, brows and lips stay dark against the skin). `matchTileToSkin`: one Lab step for every pixel so the skin lands on the body's colour. `suggestSkin`: cheeks, forehead, nose bridge → `estimateSkin` (k-means, ITA, Monk). `photoNotices`: turned, small, bright, dark, side light, colour cast (first-guess thresholds; they warn, never block). |
| `scan.worker.ts`, `workerProtocol.ts`, `scanSession.ts` | A `faceLook` message: one bitmap in (transferred, closed in the worker), only what was asked for (`tile` and/or `skin`) out: the tile's RGBA and skin Lab, the suggested class and undertone, the notices, timings. **The 478 landmarks never leave the worker.** |
| `apps/web/src/features/capture/faceLook.ts` | Main thread: decode (≤ 1280 px) → a worker with the Face Landmarker only (no pose model, no 16 MB segmenter) → `faceLook` → the worker disposed. `tileObjectUrl`: the tile as a `blob:` URL of the page. Loaded with a dynamic import on the first photo, so the embed's first chunk does not grow. |
| `apps/web/src/embed/FacePhotoRows.tsx` | The live rows: `FaceRowLive` (switch, C6, C7, the start / on-no / switched-off lines, the ask, the photo buttons, the busy line, notices, the preview with C27, the match hint, C19 switch, C20 button) and `SkinPhotoOffer` (C26, "Read it from my photo", the ask, the suggestion, notices). A file input exists only from the press of a photo button until the file is chosen. |
| `apps/web/src/embed/AvatarPrompt.tsx` | With `facePhoto` (only the live flag passes it): the live face row; in the skin row C11 (both sentences) and C12 instead of C11's first sentence alone; the suggested swatch outlined in coral with "From your photo" under it, its neighbours dashed. |
| `apps/web/src/embed/EmbedApp.tsx`, `ResultScreen.tsx`, `deps.ts` | The state (tile, drawn URL, busy, notices, suggestion, "Remember my photo"), the handlers, the face chip and C27 on the result. A swatch tapped while a suggestion is on screen is a `photo` look (C20 deletes it with the face). Test seams `facePhotoLive`, `faceLook`, `tileUrl`. |
| `apps/web/src/components/AvatarView.tsx` | `media.faceStyle: 'tile'`: the tile is drawn inside the head ellipse, under the garment, without the white ring of the app's photo crop; the neutral face lines are then not drawn. |
| `apps/web/src/embed/storage.ts` | `loadFace` / `saveFace(shop, face, persist)` / `clearFace`, `face:<shop id>` rows with their own key `facekey` (deleted with the last row), `encodeFace` / `decodeFace` (strict). A colour read from a photo is never written to the C30 look row, even in the build that stores picked colours. |
| `apps/web/src/embed/look.ts` | `facePhotoMode` (`off` / `soon` / `live`), `FACE_PHOTO_MIN_AGE = 16` (the copy's `[16]` placeholder), `SkinLook.source: 'picked' \| 'photo'`, `parseAnyLook`. |
| `apps/web/src/embed/strings/en.ts` | `avatar.facePhoto.claims` (variant A, word for word) and `avatar.facePhoto.ui` (labels and hints that state nothing about data). English only (D21). |
| Tests | `features/capture/__tests__/faceTile.test.ts` (21: tile shape and edge, colour kept, roll levelled, side light reduced, features keep contrast, no request, landmarks not in the result, the match, Monk 1–10 suggestions within one class, each notice), `embed/__tests__/facePhotoFlow.test.tsx` (4: the whole flow with every way out trapped, no-face and failure, the returning shopper and Forget me, flag off), `embed/__tests__/faceStorage.test.ts` (8), `avatarCopy.test.ts` (+3: every live claim is in the document, the variant A cells exactly, no banned word, no data promise in a label; the three flag values), `e2e/facePhoto2d.spec.ts` (the real worker, framed; and on a normal build: no live row, no file input). |
| `apps/web/scripts/face-2d-shots.mjs` | The screenshots and the timings below. |
| Docs | This report, `docs/screens/claude/face-2d-slice5/` (44 pictures, two JSON files), a capture README section, the synthetic-faces row of `docs/LICENSES.md` extended to this use. |

Not touched: `packages/fit-engine`, `packages/schema` (the look and the face are not wire types),
`.github/`, the api, the hero render path (still built from the separate plain figure: standard
colour, no face; a test checks it has no `<image>` while a face is shown). No `'userPhoto'`, no
server route, no GPU run, no deploy.

## Measured

Setup: headless Chromium (Playwright), production build of `apps/web` with
`VITE_AVATAR_FACE_PHOTO=live` served by `vite preview` on localhost, page 390 × 844 CSS px at 2×,
no CPU throttle, container CPU (Intel Xeon 2.1 GHz, 4 cores). **Not a phone.** Each person in a
fresh browser context (empty HTTP cache, so the face step includes the WASM runtime and the face
model coming from localhost). Raw numbers: `docs/screens/claude/face-2d-slice5/face-2d.json` and
`face-2d-even.json`.

| Synthetic face (paint tone) | Light | Photo chosen → face tile on screen | Photo chosen → suggestion on screen | Suggested class | Notices |
|---|---|---|---|---|---|
| Person a (Monk 2) | warm side light | 2.48 s | 2.42 s | 3 | side |
| Person b (Monk 6) | warm side light | 2.43 s | 2.32 s | 6 | side, cast |
| Person c (Monk 9) | warm side light | 2.58 s | 2.37 s | 10 | side |
| Person a (Monk 2) | even | 2.51 s | 2.28 s | 1 | none |
| Person b (Monk 6) | even | 2.55 s | 2.40 s | 6 | cast |
| Person c (Monk 9) | even | 2.46 s | 2.28 s | 9 | none |

- All six suggestions are within one class of the paint tone; the side light moved the lightest and
  the darkest face by one class each, in the direction of the light. Six synthetic renders are not a
  test set: this says the pipeline is wired right, not how well it reads a real face (slice 9).
- The "cast" notice fired on person b under even light too: probably the warm render background
  pulls the whole-picture average. The thresholds are first guesses.
- Most of the 2.3–2.6 s is the worker start (WASM compile, model load); the spike measured detection
  at about 250 ms on this CPU. For a mid-range phone assume roughly 3 to 5 times longer; that factor
  is the spike's assumption, not measured here.
- Network over the whole flow (screenshot runs and the e2e test): no request off the page's origin,
  no request with a body, no `/v1/` call. The worker fetched `face_landmarker.task` and the WASM
  runtime; never the segmenter or the pose model.
- Size on screen: the 2D head is about 28 × 33 CSS px at 390 px wide; the chip is 64 px.

Unit and flow tests: 538 web tests before this branch's last two commits plus the new ones, all
green; `pnpm check` result is given at the end.

## Assumed, not measured

- That the stylised tile is recognisable to the shopper: judged by me on three synthetic renders only.
- Phone timings (see above), iOS Safari and Android Chrome inside a merchant iframe: not run. The
  plan's acceptance asks for a manual check on both; still owed.
- That `capture="user"` on "Take a photo" opens the front camera: it does on Android Chrome and iOS
  Safari according to their documentation; not tried on a device.

## Honest look

Pictures: `docs/screens/claude/face-2d-slice5/` (`a-` Monk 2, `b-` Monk 6, `c-` Monk 9; `*-head-closeup`
for the head and chip at 2×).

- **Readable at phone size: yes, mostly thanks to the chip.** On the 28 px head the eyes, brows and
  mouth read and the face is clearly a person's, not the neutral drawing; the 64 px chip is where it
  reads as *you*. It looks like a softened photo, not an illustration: the stylisation removes noise
  and pores but keeps the photo's shading. Less uncanny than the 3D face of the spike, because it
  is flat on a flat figure.
- **Before a colour is confirmed it looks like a mask** (`c-5-face-unmatched-*`): a dark face on the
  standard beige body. That is deliberate (G4: no colour from the photo is applied without a tap),
  and the row says "Pick your skin colour below, so your face and the avatar match." After the tap
  (`*-10-face-matched-*`) face and body are one colour and it looks finished.
- **Monk 9 and 10:** the eyes read (the whites), but dark brows and a beard lose contrast on dark
  skin. The tile's local contrast helps a little. Real dark irises and lashes may read less well
  than the render's. Worth checking first on real photos.
- **Monk 2:** the face goes slightly grey and cold, like in the spike; the match to the swatch takes
  most of it out.
- **The top of the head is bare** above the face oval (landmark 10 sits at the upper forehead). The
  figure has no hair on this branch; the plan's hair picker (slice 2) would cover it.
- **Synthetic faces only.** Real photos have hair over the forehead, glasses, beards, hands, other
  people and busy backgrounds; none of that was tried. The tile is a likeness of a real face: legally
  it is face data in memory (and, with C19 on, on the device), which is why the flag stays off.

## Open issues

1. **Counsel (G1, D20.4).** The flag stays off; nothing is live. Lines that are labels, not in the
   copy document, and should go to Naomi with it: the age box ("I am 16 or older"), "Take a photo",
   "Choose a photo", "Read it from my photo", "No, I will pick it myself", the suggestion sentence,
   "From your photo", the six photo hints, the match hint and the "Remember me first" hint.
2. **Age.** The copy's `[16]` placeholder is shown as 16 (`FACE_PHOTO_MIN_AGE`); counsel decides the
   number. The box is a self-declaration, not an age check.
3. **Kill switch (G7).** Only the build flag exists; no per-shop `photo` / `face` flag from the
   session endpoint. Needs a small `packages/schema` and `apps/api` change (plan: track E).
4. **No live selfie.** The plan's "median of 5 to 10 frames" from a live camera is not built;
   "Take a photo" is a file input with `capture="user"` (one frame from the system camera). A
   `getUserMedia` path would be the place for the light gates to work live.
5. **The measured hue is not kept** when the shopper picks another class (plan slice 4): the
   confirmed colour is always the swatch. Without white balance (slice 9) the measured hue follows
   the room light, so I left it out on purpose.
6. **Two "remember" switches (copy gap 6).** "Remember my photo" needs "Remember me on this shop" on
   (the row says so when it is off); "Remember me" off wipes the stored face. A colour read from the
   photo is stored only with the face, never in the C30 look row. Founder and counsel to confirm.
7. **"Deleted from this device"** means: the tile dropped from the page's state, its `blob:` URL
   revoked, the stored row and (with the last one) its key deleted. When the browser frees the memory
   is up to its garbage collector; no test can see that.
8. **"See it on me"** still sends the standard figure (no tone, no face). D20.1 allows the tone; it
   is not wired, so C13 and C28 are not shown. C29 is true as built.
9. **3D view and men's figure.** The 3D view keeps the standard face (spike verdict); the chip sits
   on the 2D figure only, not beside the 3D view. The tile on the male 2D figure is not tried (men's
   products need the 3D view, D20.3).
10. **Light notice thresholds** are untuned (the "cast" false alarm above); slice 9's test set is the
    place to tune them.
11. **The spike is merged into this branch** (all of it flag-off: the 3D face bake, the same-origin
    guard of the worker, the synthetic faces, the spike's harness). If the spike is not to be merged,
    this branch needs `sameOriginOnly.ts`, the `needSegmenter` option and the fixtures from it.
12. **A `connect-src 'self'` CSP** for the embed (the spike's second wall against the MediaPipe usage
    log) is still not added. The e2e test with the models present now covers the face path.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @curtain/web models                       # the MediaPipe models into apps/web/public/models

# unit and flow tests
cd apps/web
pnpm exec vitest run src/features/capture/__tests__/faceTile.test.ts src/embed/__tests__/facePhotoFlow.test.tsx \
  src/embed/__tests__/faceStorage.test.ts src/embed/__tests__/avatarCopy.test.ts

# e2e with the real worker (a live build), then the normal-build check
VITE_AVATAR_FACE_PHOTO=live pnpm exec vite build
FACE_PHOTO_LIVE=1 pnpm exec playwright test -c e2e/playwright.config.ts facePhoto2d --trace off
pnpm exec vite build && pnpm exec playwright test -c e2e/playwright.config.ts facePhoto2d avatar privacy --trace off

# screenshots and timings
VITE_AVATAR_FACE_PHOTO=live pnpm exec vite build --outDir /tmp/dist-live
pnpm exec vite preview --outDir /tmp/dist-live --port 4180 --strictPort --host 127.0.0.1 &
node scripts/face-2d-shots.mjs http://127.0.0.1:4180 ../../docs/screens/claude/face-2d-slice5
EVEN=1 node scripts/face-2d-shots.mjs http://127.0.0.1:4180 /tmp/even      # numbers under even light

# the whole repository
npm_config_workspace_concurrency=1 pnpm check
```

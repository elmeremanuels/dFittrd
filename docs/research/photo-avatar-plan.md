> **Update, 13 Nov 2026 (founder decision D19, after this plan was written).** The founder allows an opt-in
> server step for a **face photo** (head and neck only; never a body photo), chosen by the shopper in the
> prompt that opens when they tap the avatar. The prompt speaks plain language; the legal text sits behind a
> link. Body measurements are typed in by default. This plan still stands as the build order: slices 1 to 6
> run on the device first, because the device can do that work. Where the plan below says "no route accepts
> a photo" or "this plan uses no server route", read: no server route is built until the slice 6 spike shows
> the on-device face is not good enough; if so, the D19 face route is the next step (in-memory, deleted on
> return, nothing stored, its own abuse limits and a nothing-stored test). Question 1 in section 6 is
> answered by D19.

# Photo-fitted avatar: plan

Status: proposal, 13 Nov 2026. Target file: `docs/research/photo-avatar-plan.md`.

Nothing was built, run or measured for this plan. It is based on two code-reading reports, one research report and three candidate plans. I checked three things in the repo myself:

- `AGENTS.md` rule 1 and `docs/DECISIONS.md` D19 exist, both dated 13 Nov;
- three.js is pinned at 0.186.1, so `NeutralToneMapping` is available;
- `packages/garment-viewer/src/scene.ts` uses ACES tone mapping, a warm hemisphere ground colour and a shared grey body material.

Licences are as the research report states them. Each must be re-read at its source before the asset ships.

## Bottom line

- **Skin tone on the avatar ships first, without a photo**, in about 2.5 agent-days. It works for men and women and needs no legal sign-off.
- **Photo to skin tone and own face runs fully on the device**, using the two models the embed already loads. Nothing is uploaded.
- **The own face appears in 2D first** (on the flat figure and as a "you" chip), then on the 3D head as a face-mesh mask after a one-day spike on a real phone.
- **Men get the right figure, labels and charts in about 6 agent-days.** A correct 3D drape for men's garments is a further 10 to 12 days, because every garment bundle today is built on the female mannequin M.
- **One conflict needs the founder.** D19 allows an opt-in server route for a face photo; the brief for this plan forbids any photo leaving the device. This plan uses no server route.

## 1. What exists today

**Capture (`apps/web/src/features/capture`)**

- One face photo already gives a skin colour (Lab, hex, Monk class, undertone, hair colour) and a 320 px face tile, all computed in the worker.
- There is no lighting check and no white-balance correction, so the colour follows the room light.
- Adjusting the Monk swatch changes only the class, not the hex, so the correction never reaches the avatar.
- The photo upload is unreachable on a device without a camera, and `capture="user"` opens the camera instead of the gallery on phones.
- Body size needs the 8-second live video. A still photo cannot produce measurements.

**Embed (the plugin product)**

- The embed skips the face step and drops the skin estimate after a scan.
- The 2D figure is always default beige with a blank head. The 3D mannequin is always grey.
- `MountOptions` in the viewer has no skin, face, sex or height field.
- The 3.8 MB face model already loads in the embed, so enabling the face step adds no download.

**3D head and body**

- The head is an untextured egg with no UVs, face, ears or hair.
- Every body is female: the mannequin shapes, the 2D silhouette, the Anny bodies for server drapes and the canonical body that garment bundles are built on.
- Sex is collected in "About you" but only feeds the size prior.

**Men's garments**

- There is no audience field on a garment, no men's chart template and no "Chest" label.
- There is no neck or sleeve fit point, and the fit-engine eases are womenswear.

**Guards already in place**

- `PersonInput.kind` is only `'avatarRender'`.
- `assertNoColourData` keeps skin, face and hair out of the fit signature.
- The worker posts no frame.
- A Playwright privacy test checks for no image MIME and no body over 8 KB.

**Decisions on file**

- D19 (13 Nov) says every mannequin gets a neutral standard face.
- D19 also says tapping the avatar opens a plain-language prompt with one switch per item: "use my face", "match my skin tone", "scan my body".
- D19 and `AGENTS.md` rule 1 allow an opt-in server route for a face photo (head and neck only).

## 2. Decision and why

**Decision:** build skin tone, face and hair on the device, behind the D19 avatar prompt, and add a male body family. The base is the risk-first plan (candidate 3), with ideas from the other two.

### Why not each candidate as written

| Candidate | Where it fails |
|---|---|
| 1, smallest path | It was written without D19: it adds a separate "Your look" screen instead of the avatar prompt, and has no neutral face. |
| | The hero-render guard strips marked nodes, so a new photo layer that someone forgets to mark leaks. |
| | "Men in 3 days" shows men's garments in 3D on a male body although the bundle was draped on the female M. |
| | It stores the skin look in clear. |
| 2, most recognisable | Its first slice (4 days) bundles consent, camera, face, tone mapping and the hero guard, and ships a face before counsel has seen anything. |
| | It names its new decision "D19", which is taken. |
| | It rewords the shared `ESTIMATE_DISCLAIMER` schema constant, which is also a server default. |
| | It puts sclera white balance in slice 2, before any patent check or test set. |
| | It adds body size from still photos, which the findings say cannot beat a tape and would lower trust. |
| | It relies on Anny head UVs that nobody has verified. |
| | Its slice 8 (12 to 15 days) is not one shippable slice. |
| 3, risk-first | It is the only one that read D19 and resolves the conflict in favour of the stricter rule. |
| | Its first slice is too heavy at 3 days. |
| | It stores the face tile with "Remember me" in the same slice that first shows it. |
| | Its region kill switch needs IP geolocation, which is a privacy decision of its own. |

No candidate sends a photo to a server, adds `'userPhoto'`, or uses a non-commercial model. None puts skin or face in the fit signature, postMessage or a merchant DTO.

### What the synthesis takes

- **From candidate 3:**
  - the gates;
  - the allowlist hero render;
  - the neutral face and avatar prompt;
  - the rule that 3D shows only when the body family matches the bundle;
  - the spike before the 3D face.
- **From candidate 1:**
  - a small first slice;
  - face storage as a separate, later opt-in;
  - an embed-only disclaimer variant, leaving the schema constant alone;
  - keeping the measured hue when the shopper picks another lightness class.
- **From candidate 2:**
  - a flat "tone check" strip (skin swatch beside the garment's main colour, unlit);
  - releasing the scan worker before the viewer mounts;
  - an asset-size check for lazy assets.

### Why on-device and not the D19 server route

- D19 itself says the device does the work where it can. Skin tone, landmarks and a face texture can all be done there.
- A server route adds abuse limits, a nothing-stored proof and a larger legal surface, for a gain nobody has demonstrated yet.

## 3. Data flow and privacy

| Data | Where it lives | Stored | Sent |
|---|---|---|---|
| Photo, camera frames | `ImageBitmap` in the capture worker, closed after analysis | Never | Never |
| 478 face landmarks | Worker memory, discarded after the texture bake | Never | Never |
| Skin look (Lab, hex, hair hex, source, confidence) | Embed React state | Only with "Remember me": per shop, AES-GCM encrypted, cleared by "Forget me" | Never |
| Face tile (320 px) and face texture (512 px) | Embed memory, freed on close or "Delete my photo" | Not until slice 7, then opt-in and encrypted | Never |
| Hair shape choice | Embed state | With "Remember me" | Never |
| Body family (sex choice) | "About you", as today | As today | Only the existing `sizingSexF/M` flags |
| Hero render image | Built from a neutral figure: no media, default tone | No | Yes, as today |

**Rules the build must keep**

- No route accepts a photo. `PersonInput.kind` stays `'avatarRender'`.
- The look type is not defined in `@curtain/schema`, so it cannot drift onto the wire. It lives in the viewer's `MountOptions.look` and a local type in capture.
- The viewer receives the look as in-memory values and fetches nothing personal.
- The hero upload is built from a separate neutral `AvatarView`, not by stripping the on-screen SVG. A test fails on any `<image>`, blob href or non-default skin fill.
- No look key appears in `FitSignatureWire`, `embed/protocol.ts`, merchant DTOs or telemetry.
- Skin shown on the device is a look only. Server review renders and the D14 video stage keep the grey mannequin.
- Every figure keeps the estimate label. When a face is shown, the embed uses its own variant ("Your face on an estimated body"); the schema constant is unchanged.
- Prompt copy follows D19: one or two plain sentences per item, the legal text behind a link, and no promise beyond the legal text.

**Written decisions this reverses** (to be recorded as a new D20, since D19 is taken)

- "The identity tile is an app feature" in `CaptureStep.tsx`.
- The `curtain-embed` rule that no scan media is stored. This is reversed only in slice 7.
- The viewer's ACES tone mapping.

**Gates before anything with a camera or face is switched on**

| Gate | Must be true | Slices |
|---|---|---|
| G1 Legal | Counsel has signed off the consent wording, the retention statement, the controller question, a DPIA, minors and the BIPA position | 4, 5, 6, 7 |
| G2 Consent | A separate unticked step precedes the camera or file picker; "Continue without photo" has equal weight; each item has an off switch and a delete control | 4, 5, 6, 7 |
| G3 No leak | Hero allowlist test and the privacy e2e pass with a look and a face present | 1 onward |
| G4 Fairness | A photo tone is never applied without the shopper confirming a swatch; no accuracy claim is made before a consented Monk 1 to 10 test set | 4 |
| G5 Licence | Each new asset's licence is read at source and recorded in a new `docs/LICENSES.md` | 2, 6, 8 |
| G6 Budgets | SDK at or under 8 KB gzip (no SDK change planned); viewer chunk at or under 400 KB; face and hair data are lazy assets, not chunk code | all |
| G7 Kill switch | A per-shop flag (`photo`, `face`) can turn the feature off without a release | 4, 5, 6 |
| G8 Models served | Production serves `/models`; no deploy step that fetches them was found | 4 |

## 4. Slices, in order

Each slice ships alone. Effort is in agent-days and is an estimate from reading code.

| # | Slice | Days | Gates |
|---|---|---|---|
| 1 | Pick my skin tone | 2.5 | G3, G6 |
| 2 | Neutral standard face and hair picker | 3 | G5 |
| 3 | Men v1: figure, labels, charts | 6 | none |
| 4 | Skin tone from a photo | 4.5 | G1, G2, G4, G7, G8 |
| 5 | Own face in 2D | 2 | G1, G2 |
| 6 | Own face on the 3D head | 1 spike + 5 | G1, G5, G6 |
| 7 | "Remember my photo" | 1.5 | G1 |
| 8 | Men v2: real 3D drape for men's garments | 10 to 12 | G5 |
| 9 | Fairness validation and white balance | 4 + human data collection | G4 |

Slices 1 to 7 total about 25.5 days. Slices 1, 2 and 3 can ship before counsel replies. Slices 4 to 7 are built behind the flag and switched on after G1.

### Slice 1: pick my skin tone

**Scope**
- Tapping the avatar (or a "Make it yours" chip) opens the D19 sheet.
- "Match my skin tone" shows ten Monk swatches and a fine lightness and warmth slider. The other two rows are hidden behind the flag.
- The viewer gets a per-figure body material and `MountOptions.look.skinHex`, updatable without a remount.
- The viewer moves to neutral tone mapping with white lights and a neutral ground colour.
- The 2D figure in the embed and peek takes the same hex.
- The result shows the flat tone-check strip.
- The hero upload moves to the allowlist build.
- The existing swatch bug is fixed: a confirmed swatch updates the hex.

**Acceptance**
- A shopper picks a tone with no camera permission and sees it on both figures next to the garment.
- A unit test shows `setLook` changes only that figure's material.
- The hero allowlist test fails on any `<image>`, blob href or non-default fill.
- No look key is in the signature or any postMessage.
- Nothing is stored without "Remember me"; with it the row is encrypted, and "Forget me" clears it.
- `check-viewer-chunk.mjs` passes.
- Before and after screenshots of two existing garments go to the founder, because the lighting change alters every garment.

### Slice 2: neutral standard face and hair

**Scope**
- A simple neutral face on the head in 2D and 3D, so no avatar looks unfinished (D19).
- A hair colour and shape picker with 6 to 8 shapes plus "none / covered". Curly and coily hair and head coverings are explicit choices, never guessed.

**Acceptance**
- Every figure in the embed, peek and app shows the neutral face by default.
- Hair assets load lazily and are absent from every JS chunk, proven by a new asset-size check.
- Each hair asset's licence file is recorded in `docs/LICENSES.md`.
- The hero upload still passes the allowlist test.

### Slice 3: men v1

**Scope**
- Optional `audience: 'women' | 'men' | 'unisex'` on `GarmentPayload`, filled by the mappings with a merchant override.
- The stored fit point stays `bust`; the web layer shows "Chest" for men's and unisex garments.
- Men's chart templates: chest/waist/seat letter sizes, EU 44 to 58, and W/L jeans.
- A male reference body and path for the 2D figure.
- A male shape family in `packages/mannequin`, with values read from EN 13402-3 at source.
- `MountOptions.body` gains `family`, `heightCm` and shoulder width.
- Two men's fixture products.

**Which body is drawn**
- The garment's audience decides first.
- The shopper's choice decides for unisex garments.
- "Not specified" keeps today's figure.

**Honest limit, enforced in code**
- The 3D drape shows only when the drawn body family equals the family the bundle was built on.
- All bundles today are female M, so men's products get the male 2D figure, skin tone, face and size advice, but no 3D drape yet.

**Acceptance**
- The male mesh is closed and its ring girths match the table within tolerance.
- Label switching is tested.
- Men's templates parse and the audience mapping is tested.
- A men's product never mounts a female-built bundle on a male body.
- Fit-engine vectors are unchanged and green.

### Slice 4: skin tone from a photo

**Scope**
- A consent step, then two equal buttons: "Take a selfie" (median of 5 to 10 frames) and "Choose a photo" (gallery, works with no camera).
- Lighting gates for clipped highlights, underexposure, side light and colour cast. They warn and offer a retake or a manual pick; they never block.
- Review shows the estimate with its two neighbours and the slider. The shopper confirms.
- Picking another class keeps the measured hue and shifts lightness.
- The session runs face models only, not pose, and the worker is released before the viewer mounts.

**Acceptance**
- An upload-only desktop and a phone camera both reach a confirmed tone.
- No input mounts before consent.
- Unit tests cover the gates, the median and the pick-to-hex function.
- The privacy e2e runs the photo flow with no image MIME and no body over 8 KB.
- A manual check passes on iOS Safari and Android Chrome inside a merchant iframe; this path has never been run in a browser.

### Slice 5: own face in 2D

**Scope**
- The existing tile goes on the 2D head and appears as a round "you" chip beside the 3D view.
- It is held in memory only, with a "Delete my photo" control.

**Acceptance**
- Closing the iframe leaves no photo anywhere.
- The hero allowlist test passes with a tile set.
- The embed disclaimer variant shows.

### Slice 6: own face on the 3D head

**Scope**
- A one-day spike on a mid-range phone comes first. If the result looks like a pasted mask, the slice stops and slice 5 remains the answer.
- The worker bakes the selfie into a 512 px texture over the MediaPipe canonical face mesh, with crude de-lighting.
- The viewer feathers the edge into the confirmed skin tone and fades the mask to plain skin past about 45° yaw.
- Static UV and triangle data (about 30 KB) load as a lazy asset.

**Acceptance**
- The bake is unit-tested on a synthetic image.
- The landmarks are discarded after the bake.
- The canonical mesh licence is read at source.
- The viewer chunk stays within budget.

### Slice 7: "Remember my photo"

**Scope**
- Opt-in encrypted storage of the face tile and texture, using the capture key scheme.

**Acceptance**
- Nothing is stored without the opt-in.
- The stored row is encrypted.
- "Forget me" and "Delete my photo" both remove it.

### Slice 8: men v2

**Scope**
- A male canonical body in the garment pipeline, the anchors and the Blender drape constants.
- Anny bodies with the gender parameter and a men's chart.
- Men's eases plus neck and sleeve fit points in the fit engine, with a spec update and new vectors.
- The first men's bundle.

**Acceptance**
- One men's garment drapes in 3D on the male body.
- The new fit vectors are green.
- The Anny export is pinned so no non-commercial asset is pulled in.

### Slice 9: fairness validation and white balance

**Scope**
- A consented photo set across Monk 1 to 10 under three light types.
- A clamped white-balance vote from the background and the sclera, tuned on that set.

**Acceptance**
- The measured error per Monk class is published internally before any accuracy claim.
- A patent check on sclera-based correction is done before it is advertised.

## 5. Parallel tracks

Each directory has one owner. One contract is agreed before work starts: the shape of `MountOptions.look` and `MountOptions.body` (`family`, `heightCm`, shoulder), plus the props `AvatarView` takes.

| Track | Owns | Slices |
|---|---|---|
| A, viewer | `packages/garment-viewer/` | 1, 2 (3D), 3 (wiring `family`), 6 (mount) |
| B, capture | `apps/web/src/features/capture/` | 1 (pick-to-hex, swatch fix), 4, 6 (bake), 7 (crypto) |
| C, embed and 2D figure | `apps/web/src/embed/`, `apps/web/src/components/AvatarView.tsx`, `apps/web/e2e/` | 1, 2 (2D), 4 and 5 (UI), 3 (labels) |
| D, male body | `packages/mannequin/`, `packages/anchors/`, `apps/web/src/render/` | 3 |
| E, men's data | `packages/schema/` | 3 |
| F, garment pipeline and engine | `spikes/garment-engine/`, `packages/fit-engine/` | 8 |
| G, docs and legal | `docs/` | D20 entry, `LICENSES.md`, privacy text, counsel brief |

**What can run at once**
- Tracks A, B and C build slice 1 together once the contract is fixed.
- Tracks D and E build slice 3 alongside slice 1; they touch no file in A, B or C.
- Track G starts the counsel brief on day one. G1 is the longest lead time in the plan.

**Where tracks meet**
- Track D delivers the male shapes in `packages/mannequin`; track A then picks the family in the viewer's `body.ts`. D does not edit the viewer.
- Track C switches the "Chest" label after track E lands `audience`.
- If the kill switch is returned by the session endpoint, it touches `apps/api` and `packages/schema`. That is one small change, owned by track E.
- The app store (`apps/web/src/store/`) is touched only for the swatch fix, by track B.

## 6. Questions only the founder can answer

1. **Server route or not?** D19 allows an opt-in upload of a face photo. This plan keeps everything on the device. Do you want a server step at all? If so, for what the device cannot do well (for example a better 3D head)?
2. **Skin tone in "See it on me".** The hero upload uses a neutral figure, so that render shows a default skin tone. Sending the tone would put colour data on the wire, which D3 forbids. Keep it neutral, or allow the tone under the existing opt-in?
3. **Lighting change.** Neutral lighting makes every existing garment look different, usually flatter. Will you approve it from before and after screenshots?
4. **Face storage.** The default is memory only for the session. Should "Remember my photo" (slice 7) exist at all in a shop's iframe?
5. **Illinois and minors.** Should the face feature be blocked in Illinois at launch? That needs coarse IP location at session start. Is an age statement needed?
6. **Counsel.** Who reviews the consent text, the controller question and the merchant terms, and by when? Slices 4 to 7 wait on this.
7. **Men's products before slice 8.** Is it acceptable that men's products launch with the 2D male figure and size advice but no 3D drape?
8. **Test set.** Who recruits consented people across Monk 1 to 10 for slice 9? Agents cannot do this.
9. **Production models.** Who confirms that production serves `/models`?

## 7. What we will not build, and why

- **Any route that accepts a photo, or a `'userPhoto'` person input.** The hard rule forbids it and the device can do the work.
- **Body size from a still photo.** One or two photos cannot beat a tape, and clothing dominates the error.
- **Gaussian-splat, NeRF or generative faces.** They need a server GPU or minutes of on-device optimisation, and most build on non-commercial models.
- **Anything on FLAME, SMPL, SMPL-X, the Basel model, Anny-Fit, DECA, TRUST or Multi-HMR.** Their licences rule them out.
- **A camera-facing billboard head in 3D.** It breaks as soon as the shopper rotates the figure.
- **A fitted morphable 3D head, for now.** It needs several views and weeks of work; revisit it after slice 6 has been judged on real phones.
- **Sclera or screen-flash white balance before slice 9.** It is unvalidated and there are patents in the area.
- **Ethnicity, age or sex inference from the face.** Sex stays a typed choice; tone is never used to infer origin.
- **Stored landmarks or any face template.** This is the main biometric-law exposure.
- **Skin, face or hair in the fit signature, postMessage, merchant data or telemetry.** Rule 4 and D3.
- **Skin or face on server review renders.** The D14 video stage needs the grey mannequin.
- **A rename of the `bust` wire key.** It would break vectors and mappings; a label does the job.
- **Automatic hair style detection.** A wrong guess hurts recognition more than no hair; the picker decides.
- **A photoreal skin shader or facial animation.** Neither helps the judgement of skin against fabric.

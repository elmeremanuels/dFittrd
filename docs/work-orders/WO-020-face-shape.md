# WO-020: Face shape from a selfie on the realistic body (phase C)

**Tier** full · **Linear** CUR-34 · Iterations:
1. **Google** builds the prototype (`google/wo-020-face-shape`, from the latest `claude/realistic-body`).
2. **Claude** reviews privacy (D19) and the licences, and merges.

Each iteration ends with a handoff in `docs/handoffs/WO-020-iterN-<builder>.md` (`docs/handoffs/TEMPLATE.md`).

## Goal

The realistic body's face takes the **shape** of the shopper's face: jaw width, chin, cheekbones, nose length and width, eye spacing, brow height, lip width and the face height against the head. It stays **stylised**: no photo texture on the 3D face (D27). The photoreal face belongs to the AI layer, with consent (D19).

## What already exists (reuse it, do not rebuild it)

- `apps/web/src/features/capture/models.ts`: the self-hosted MediaPipe **Face Landmarker** (`face_landmarker.task`, Apache-2.0, same origin only via `sameOriginOnly.ts`).
- `faceOnHead.ts`, `faceBake.ts` and `scan.worker.ts`: the selfie is decoded on the main thread, and the landmarks are found in the Web Worker (478 points). The worker is disposed before the 3D view draws, and nothing is stored or sent.
- `faceSkin.ts`: the skin tone estimated from the selfie, on the device.
- The realistic body: the MakeHuman CC0 base mesh and its asset bake (`scripts/bake-realistic-body.ts`, `assets/realistic-body/`).

## What to build

1. **Face targets in the asset.** Add a small set of MakeHuman CC0 **face shape targets** to the realistic body bake: jaw, chin, cheeks, nose, eyes, brows, mouth and face proportions. Keep the asset growth small: report the bytes, and stay below +150 KB gzip.
2. **Fit, on the device.** Write `faceShape.ts`, a pure function. It takes the 478 landmarks (from the worker) and the realistic body's head, and returns target weights. Use a least-squares fit of the projected landmark distances. Normalise for head pose, scale and expression: a neutral face is asked for, and a smile is detected and refused. Clamp the weights, so the face can never go grotesque.
3. **Apply.** A `MountOptions.faceShape` option (the weights), applied to the realistic head when the body is drawn. Without it, the face is as before.
4. **Never store or send** the landmarks, the photo or the weights. Only the derived weights may be kept on the device, next to the skin tone, as a shopper choice that can be deleted. Extend the privacy e2e to prove that no request carries any of it.

## Done when

- A sheet of 8 or more varied faces: synthetic test faces, or generated landmark sets. **Use no photos of real people in the repo** (D19). Show the landmarks, then our stylised face (front, three-quarter and profile), and how similar the two are.
- There are tests that `faceShape` recovers known weights from synthetic landmarks (round trip), that the weights are clamped, and that a smile is refused.
- The girth and arm tests stay green. The head stays within its ring, and the fit and the sizes do not change.
- `pnpm check` and both demo e2e runs are green, frame time and asset size are reported, and the handoff is written.

## Never

- FLAME, BFM or any non-commercial face model (AGENTS.md rule 6).
- A photo or any landmark leaving the device.
- A photo texture on the live 3D face.

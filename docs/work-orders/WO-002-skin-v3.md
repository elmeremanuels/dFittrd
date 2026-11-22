# WO-002: Better skin on the realistic body

**Tier** full · **Builder** Google · **Branch** `google/wo-002-skin-v3`, cut from `claude/realistic-body` once WO-001
is done.

## Goal

The founder finds the current procedural skin not good enough. Bring it closer to the five references below, from
light to dark. **Do not use the references themselves.**

## References (look only)

1. https://www.blendkit.com/asset-gallery-detail/09b323ad-55a7-4442-8931-b7fdc6b3ca71/
2. https://www.blendkit.com/asset-gallery-detail/133f7fe6-994b-4585-8291-dd198b81a69a/
3. https://www.blendkit.com/asset-gallery-detail/bff63f2b-4bb1-480b-928c-a23404a6c9d6/
4. https://www.blendkit.com/asset-gallery-detail/28e68e53-73bb-4a12-ab3b-bc3807d50860/

These are BlendKit "Royalty Free" materials. Their textures may not ship in our web app, because the browser can
extract them. Rebuild the look in our own code, in `realisticSkin.ts` and `studioLight.ts`. Do not download, commit or
trace their textures.

## Files

- `packages/garment-viewer/src/realisticSkin.ts`
- `packages/garment-viewer/src/realisticSkin.test.ts`
- `packages/garment-viewer/src/studioLight.ts`
- `spikes/garment-engine/viewer/realistic-body-skin-*.mjs`
- `docs/screens/google/skin-v3/`
- `docs/reports/google/skin-v3.md`

## Done when

- Before-and-after sheets show three tones on five bodies, plus upper-body close-ups.
- The skin still comes from the one skin-tone value (D20). There are no new textures as files, and the viewer chunk
  stays within its limit.
- **Frame time is measured** for the body without skin, with the old skin and with the new skin. Use headless Chromium
  with SwiftShader, as in `docs/reports/claude/realistic-hair.md`. This was never measured.
- `pnpm check` is green.
- The report has the sections Done, Measured, Not verified and Open issues, and names the model or models used.

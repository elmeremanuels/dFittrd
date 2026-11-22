# WO-008: Seam at the hip line: the lower body looks glued to the torso

**Tier** full · **Builder** Google (diagnosis, and the fix if it is shading) / Claude (the fix if it is shape) ·
**Linear** CUR-21 · **Branch** `google/wo-008-hip-seam`, cut from `claude/realistic-body` (9a4fc62 or later).

## Goal

Find out why the realistic body shows a seam at the hip line, and remove it.

## Background

Founder, 22 Nov: "het onderlichaam lijkt vanaf de heupen aan de romp geplakt". On the hip line a horizontal band or
seam is visible, and below it the legs read as a separate piece. The founder's picture is on CUR-21.

Two possible causes:

- **Shape:** a jump in the per-ring scale between the waist and the hip, or in the vertical warp
  (`warpThrough`), or the conform step (`conformToField`) under a garment. All of these are in
  `packages/garment-viewer/src/realisticBody.ts`.
- **Shading and skin:** the normals, the triplanar projection of the skin detail tile, the redness mask or the studio
  light (`realisticSkin.ts`, `studioLight.ts`).

## Steps

1. **Diagnose first, change nothing.** Render the five test bodies at the hip line, front and three-quarter, in four
   versions:
   - procedural skin and studio light (`skinlook=procedural`);
   - the grey mannequin material (no `skinlook`);
   - with the hair off;
   - the body alone, and under the azure dress (`conform` on and `conform=0`).

   If the seam goes away with the grey material, it is shading. If it stays, it is shape. A shape cause should show
   in the mesh itself: a kink in the outline at the hip in a side view, or a step in the per-height scale. Use
   `spikes/garment-engine/viewer/avatar.html` (`mode=head`, `frame=body`, `body=realistic`).
2. **Post the diagnosis on CUR-21,** with the pictures, before fixing anything.
3. **If it is shading:** fix it within the skin files of CUR-6 (`realisticSkin.ts`, `realisticSkin.test.ts`,
   `studioLight.ts`). Fold it into CUR-6's branch, or use this branch with the same files, but not both at once.
4. **If it is shape:** do not change `realisticBody.ts`. Set CUR-21 to "Wacht op Claude" in a comment, and Claude
   fixes it in the fit.

## Files

- Google: `packages/garment-viewer/src/realisticSkin.ts`, `realisticSkin.test.ts`, `studioLight.ts` (shared with CUR-6:
  one branch at a time), `spikes/garment-engine/viewer/realistic-body-skin-*.mjs`, `docs/screens/google/hip-seam/`,
  `docs/reports/google/hip-seam.md`
- Claude, only if it is shape: `packages/garment-viewer/src/realisticBody.ts`, `realisticBody.test.ts`

## Done when

- The cause is in the report, with before and after pictures of the five bodies, front and three-quarter, at the hip
  line.
- The seam is gone in those pictures, with the procedural skin on.
- If it was shape: a test fails on the old fit (for example the per-height scale or the outline's slope jumping at
  the hip) and passes after the fix.
- The girth tests stay green (all 12 rings within 0.5 % on the five bodies).
- `pnpm install --frozen-lockfile` and `pnpm check` are green.

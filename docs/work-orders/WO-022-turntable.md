# WO-022: Slow turn ("rondje draaien") in the viewer (phase F)

**Tier** light · **Builder** Qwen · **Linear** CUR-37 · **Branch** `qwen/wo-022-turntable`, from the latest `claude/garment-engine`.

## Goal

The shopper taps "Turn around". The figure (or the camera) turns once slowly and evenly, about 8 seconds for 360°, then stops at the starting view (D30, `initialViewFor`). Nothing deforms.

## Details

- `scene.ts` already has OrbitControls with `autoRotate`. Build on that: one full turn with an ease-in and ease-out, then stop. If the shopper drags during the turn, the turn stops at once.
- `prefers-reduced-motion`: no automatic turn. The button then steps through front, three-quarter, side, back and three-quarter.
- While turning, draw only the frames needed (the viewer's draw-on-demand rule). Measure the frame time.
- The button sits in the embed next to the 3D view, in English (D21), keyboard accessible, and works at 360 px.

## Done when

- There are tests for the turn timing (a pure function of time to angle), the stop on drag, and the reduced-motion steps.
- A demo e2e step taps the button and checks that the angle comes back to the start.
- `pnpm check` and both demo e2e runs are green. You ran them yourself, and the real output is in `docs/reports/qwen/turntable.md`.

# WO-023: Skeleton, key poses and a looping pose pattern for the realistic body (phase F)

**Tier** full · **Builder** Google · **Linear** CUR-38 · **Branch** `google/wo-023-rig-poses`, from the latest `claude/realistic-body`. Start after CUR-33 (arms iteration 3) is merged, because the shoulders must be right first.

## Goal

The fitted realistic body moves calmly through a fixed pattern of mirror poses and loops:

1. rest (A-pose);
2. both arms slowly up;
3. hands on hips;
4. a quarter turn to the left, to see the side;
5. a quarter turn to the right;
6. back to rest.

The shopper can start and stop it. With the base layer on (CUR-22), nothing else is worn yet.

## What to build

1. **The skeleton in the asset.** Add MakeHuman's skeleton and its full per-vertex skin weights to the realistic body bake (`packages/garment-viewer/scripts/bake-realistic-body.ts`). Keep the asset growth small and report the bytes. **Check the licence of the rig data first** (MakeHuman and MPFB2 assets: CC0 or not?) and record it in `docs/LICENSES.md`. If it is not commercially usable, build our own skeleton on the joints we already have.
2. **Skinning after the fit.** The bind pose is the shopper's **fitted** mesh, so the girths stay exact in rest. Use dual-quaternion skinning, or add correctives, so the shoulders do not collapse with the arms up. The shoulder and arm quality of CUR-33 must hold.
3. **The key poses** as our own bone rotations, in code. No motion capture, no Mixamo and no third-party animation.
4. **The transitions:** quaternion slerp with ease-in and ease-out, about 1.5 to 2 s per transition and a pause of about 1 s on each key pose. It loops. With `prefers-reduced-motion` it steps between poses instead.
5. **The hair** follows the head bone.
6. `MountOptions.posePlayer`, off by default, plus a start and stop button in the embed.

## Done when

- The girths in rest are unchanged, and the girth tests stay green.
- There are tests that each key pose's joint angles are reached, that transitions are continuous (no pop), that the loop returns exactly to rest, and that the shoulder volume with the arms up stays within 10 % of rest.
- There are sheets of each key pose for five bodies (front, three-quarter, back), plus a short frame sequence or a GIF of one loop.
- The frame time is measured during the animation. `pnpm check` is green, and the report and the handoff are written.

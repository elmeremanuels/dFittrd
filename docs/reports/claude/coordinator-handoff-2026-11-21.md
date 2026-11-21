# Handoff, 21 Nov 2026: realistic body, skin and hair

This is for the agent that takes over the build work. The previous agent becomes the coordinator. Read `AGENTS.md`,
`docs/HANDOFF.md` and `docs/DECISIONS.md` first, D19 to D28 most of all.

## Branches (all pushed)

| Branch | What | State |
|---|---|---|
| `main` | Merged up to PR #1 | Nothing new. Open a PR only when the founder asks |
| `claude/garment-engine` | Integration branch: pre-launch merge, D27, D28, this handoff | Gates green at b172f5a |
| `claude/pre-launch` | Launch checks and runbook | Merged into garment-engine |
| `claude/realistic-body` | Realistic body spike (MakeHuman CC0 mesh fitted to the 12 rings) plus procedural skin and studio light | Not merged into garment-engine. Opt-in only (`bodyShape: 'realistic-spike'`) |
| `claude/realistic-hair` | Own hair (D28): 10 types × 4 lengths and 10 colours. Cut from `realistic-body` | Not merged into `realistic-body` yet |

Reports:
- `docs/reports/claude/realistic-body-spike.md`
- `docs/reports/claude/realistic-body-skin.md`, written by the coordinator because the skin agent stopped at the usage limit
- `docs/reports/claude/realistic-hair.md`, which also covers OI-170 onward

## Do next, in this order

1. **Merge `claude/realistic-hair` into `claude/realistic-body`.** Expect conflicts in `packages/garment-viewer/src/mount.ts`, `spikes/garment-engine/viewer/src/avatarMain.ts` and `docs/OPEN-ISSUES.md` (the open issue ids and the Counts line). The skin and the hair both hook into `show()` and the lazy chunk. Check that the hair still sits on the skinned body.
2. **The arms are too long (founder, 21 Nov).** The MakeHuman arm and hand follow the old mannequin's arm length and hang too low. The fingertips should end around the top of the thigh. Check the length against the ring table's arm length (shoulder to wrist), fix it in the fit or bake, and add a test that fails on the old length. Then make new pictures.
3. **Measure frame time with the skin on.** The skin agent never did this. Use the same method as the hair report (headless Chromium with SwiftShader, body alone as the baseline).
4. **Get an independent review of the skin and hair code.** The spike's first tests proved circular, so make the reviewer try to break them.
5. Send the sheets to the founder with a short report in Dutch.

## Known open items on this work

- Shoulder and long hair cost more frame time than the body itself (+38 to +63 ms on SwiftShader). This breaks D28's performance bound (OI-171), and no real phone was tested.
- The hair cards look like ribbons up close (OI-172). There is no hair picker or stored choice in the embed (OI-170).
- The body has self-crossings (OI-147) and wide, square shoulders (OI-149).
- Small patches of skin show through the skirt from behind (OI-143).
- The outline sits outside the collision field (torso 1.5 to 2.4 cm).
- Founder decisions:
  - Is this body the right direction?
  - Rebuild the women's garment bundles on the realistic mesh?
  - Tape or loop girth (OI-141)?
  - Nipples and navel visible?
  - OI-135 (the button text when a size is not drawn)?
  - The `.github/` steps (OI-130).

## Rules that bind every agent

- Gates are `pnpm check`, `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e`. Run `pnpm install --frozen-lockfile` after each merge. Push only on green, and report honestly what was not verified.
- No amend, rebase or force-push. Never edit `.github/`. Open no PR unless the founder asks. Make no paid API calls. GPU spend needs founder approval.
- Licences must allow commercial use. No SMPL, SMPL-X, FLAME or STAR. No CC BY-NC. No asset stores (see D25 and D26).
- Shopper data stays on the device (D19 and D20). The hair choice is never sent anywhere and never inferred from a photo (D28).
- The founder's reference photos are reference only. Never commit them or use them as textures.
- Never write a literal in a real token format.
- Every render is labelled an estimate.
- Commits end with the Co-Authored-By and Claude-Session lines.
- Report to the founder in Dutch, with as many pictures as possible.

## Working copies on the old container

These do not survive a new container. Clone fresh.

- `/home/user/dfittrd` is on `claude/realistic-body`.
- `/home/user/dfittrd-hair` is a worktree on `claude/realistic-hair`.
- `/home/user/dfittrd-merge` is a worktree on `claude/garment-engine`.

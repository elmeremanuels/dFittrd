# The real POM v2 bake under the import's bake check (branch `claude/pom-gate`, 19 Nov 2026)

## What was asked

The import's bake check (`checkDrapeBake`, `docs/reports/claude/bake-qa-gate.md`) refused the real POM v2 skirt bake after a
rebake with `bake-pom.ts`. Decide what is wrong (the drapes, the cloth, or the gate's tolerance), fix that layer, re-drape the
drape that had not come to rest, rebake, show that the check passes, and make `DEMO_SKIRT=pom pnpm demo:e2e` and `pnpm demo:e2e`
pass. Full write-up with every number: `docs/research/step3-serverdrape-spike.md` §10.9.

## Before: refused, 2 of 9 checks

`docs/screens/claude/pom-gate/bake-check-before.json` (the check's own report):

- `at_rest`: AU 10 on the 94 cm body did not come to rest (0.285 cm per frame at most over the last 24 of 144 frames).
- `tape_rings`: the hip-line ring was longer than the tape on AU 8 on the 104 / 109 cm bodies (116.7 / 120.0 cm, tape 112) and on
  AU 10 / 12 / 14 on the 114 cm body (126.8 / 127.7 / 128.6, tape 122 / 124 / 126).

## Diagnosis: the drapes (a)

Measured on all 24 drapes (`serverdrape/hoop_strain.py`, draped ring length against the size's rest length):

- **(a) the drapes: the cause.** All five ring failures are a size on a body whose hips its band cannot be pulled over, by the fit
  engine's own `pullOnCheck` (stretched band against hip; blocked when short by more than 2.5 cm, 0 for an extrapolated band).
  The hip ring's stretch grows with the shortfall: +4.0 / +7.1 % for AU 8 (band 10 / 15 cm short), +4.0 / +2.9 / +2.1 % for
  AU 10 / 12 / 14 on hip 114 (14 / 9 / 4 cm short). The 3D view was showing a skirt the size advice blocks, worn without trouble.
- **(b) the cloth: real, but second-order.** The cloth does not stretch under its own weight (edge strain p95 ≤ 0.65 % on every
  drape). On every combination the band can pass, the hip ring's total stretch is −0.7 to +0.3 %. The one exception is AU 16
  on hip 114 at +1.2 %, inside the fabric's stated 1.5 %. Single mesh segments do stretch far more than viscose where a body
  pushes them: 9-35 % on the blocked drapes, and up to 15.7 % on allowed ones. That is a solver limitation and is recorded as a
  caveat.
- **(c) the gate: not changed.** ±max(2 cm, 2 %) is already wider than the fabric's 1.5 % stretch. Loosening it would admit 7 %
  of stretch in a woven fabric.

## Fix

- `bake-pom.ts` plus `bakeTape.ts` (`pullOnRefusal`, `planSizeBodies`; unit test `viewer/src/bakePlan.test.ts`). A size is
  draped on the chart bodies (hip 94 / 104 / 114) only where the wear rule holds its band and `pullOnCheck` passes. Every body
  beyond is declared `notDraped`, with the reason in plain words, for example "its band cannot be pulled over 104 cm hips: 94 cm
  at full stretch, 10 cm short (the size advice allows 2.5 cm)". Where the chart body above a size is refused, the size's own
  chart body becomes its upper body (AU 10 on hip 99, a new drape; AU 14 on hip 109). The base drape is the one nearest t = 0.
  Result: AU 8 on 94; AU 10 on 94-99; AU 12 on 94-104; AU 14 on 94-109; AU 16 on 94-114.
- `run_pom2.py`: each job can now take its own frame count (`body:size:frames`). `pom-bundle.sh` lists the new grid. Re-draped
  at 288 frames: AU 10 on 94 (0.09 cm per frame at most) and AU 14 on 109 (0.071). New at 144 frames: AU 10 on 99 (0.11).
- `apps/web/e2e/garment3dBake.spec.ts` now expects the place the bake states for each size (drawn / not drawn). Its "past the
  draped bodies" cases are moved to the new refusals (hip 101, 112, 118). `BAKE_SIZES` and `BAKE_SIDE=0` let a run take only
  some pictures.

## After: passes, 9 of 9

`docs/screens/claude/pom-gate/bake-check-after.json`. Hip-line rings 111.9-129.7 cm against tape 112-128 cm. The largest
departure is AU 16 on hip 114, +1.7 cm, inside the 2.56 cm allowed. Hems are within 0.4 cm. No particle is inside the drawn body,
and every drape is at rest. `base.glb` is now 420,872 bytes (297,935 gzip); before it was 554,696.

## Renders (embed, phone 360 × 740 at 2×, front)

`docs/screens/claude/pom-gate/before-after-embed.png` (originals in the session scratchpad
`/tmp/claude-0/-home-user/45896997-2c70-517e-89a4-f66870da365e/scratchpad/pom-gate/embed-{before,after}/`). The top row is the
refused bake and the bottom row is the bake that passes. Shoppers are typed on the chart line (hip 94, 104, 109, 114), and only
the affected sizes are shown:

- hip 104, AU 8 and AU 10; hip 109, AU 8 and AU 12; hip 114, AU 10, 12 and 14: before, a skirt drawn over a band that cannot go
  on. After, the body alone, with "Size N is not drawn: … a body with 99.0 / 104.0 / 109.0 / 114.0 cm hips".
- hip 94, AU 10: the re-draped drape that is now at rest. The difference is not visible at phone size.
- hip 109, AU 14: before it was a blend of the 104 and 114 drapes; now it is its own direct drape. The folds are slightly sharper.

Honest read: the refusals read clearly, and the skirt that remains looks as it did. The sentence still says "the simulation could
not put it on", which is not the reason any more (it is the band). The size rings under the view are the chart's and still show,
for example, "Hips 8 cm room" for a size that is not drawn.

## Demo and check

- `DEMO_SKIRT=pom pnpm demo:e2e`: **3 flows passed.** The rebaked skirt imports through the api's bake check with no flag, opens
  in 3D at size 12 (the advice for the demo shopper), and carries the bake note and the estimate label. Five asset GETs and nothing
  else go to the api, and the skin tone step passes. Two earlier runs failed on the synthetic and azure 3D views ("Page crashed",
  and a Vite dev "Failed to fetch dynamically imported module EmbedRoute.tsx"). Neither view is the skirt. Both runs shared the
  machine with my embed e2e and other sessions' test runs. With the machine quieter, the plain run and then the POM run both passed.
- `pnpm demo:e2e` (photo bundle): **3 flows passed.**
- `apps/web/e2e/garment3dBake.spec.ts` ("every size" at hip 100, "past the draped bodies") on the new bake: **2 passed.** At hip
  101, AU 8 is not drawn (99 cm body), AU 10 is `between` (104 cm) and AU 12 is `within`. At hip 112, AU 12 is not drawn (109),
  AU 14 is `between` (114) and AU 16 is `within`. At hip 118, AU 14 is not drawn and AU 16 is `held`.
- `npm_config_workspace_concurrency=1 pnpm check`: **passed** (exit 0), including the new `bakePlan.test.ts`.

## Open issues

1. The cloth is locally too soft: single hip-ring segments stretch up to 15.7 % on drapes the band can pass. A strain-limited
   or stiffer cloth was not tried.
2. The refusal sentence in the embed (`embed/strings/en.ts` `refused` / `between`) still blames "the simulation". It could name
   the band.
3. The 2.5 cm gap: the size advice blocks AU 8 from hip 96.6, but the drape is refused only from the 99 cm body. Between the two,
   AU 8 is drawn on the 94 cm body with the `between` note.
4. The gate fixture (`packages/garment-viewer/fixtures/pom-v2-rest`) was not rebuilt. It still uses its own ring rule and drapes
   AU 8 on hip 104. It tests the gate, not this bake.
5. The gate does not itself check pull-on against the tape. The ring check caught every case here, and the bake now declares the
   refusals, but a future bake with a loose hip line could put a blocked size on a body and still pass the gate.

## Reproduce

```sh
cd spikes/garment-engine            # out/ with pom2, pom2-avatar, eval
serverdrape/pom-bundle.sh            # re-drapes only what changed (cached by frames), then bake-pom.ts
python3 serverdrape/hoop_strain.py out/pom2-avatar
node <checkDrapeBake runner> out/pom2-bundle/crimson-wildflower-maxi-skirt
pnpm exec vitest run --config viewer/vitest.config.ts src/bakePlan.test.ts
cd ../../apps/web && E2E_PORT=4231 BAKE_BODY=95,77.5,104 BAKE_SIZES=8,10 BAKE_SIDE=0 BAKE_SHOTS=<dir> \
  pnpm exec playwright test -c e2e/playwright.config.ts garment3dBake -g "every size"
```

# The device cloth solver holds length: hang lines, opt-in per bundle

Branch `claude/cloth-hang`, from `claude/garment-engine`, 20 Nov 2026. The dress-from-tape report ended on "the solver is too soft for a hanging garment: length +2 to 3 %" (`docs/reports/claude/dress-from-tape.md`, open issue 1). This is that issue.

Every garment here is SYNTHETIC or a stand-in. Every picture is an estimate and the embed labels it so.

## Verdict

- **The tape-built dress now hangs about 1 % long instead of 2 to 3 %.** Centre front against the tape, AU 8 to 16 on their own bodies: +1.55 to +2.11 cm before, +0.73 to +0.89 cm after. The same at 156 and 180 cm. It is calmer after the freeze on the bundle body (0.5 to 0.8 cm of residual motion, from 1.3 to 1.7).
- **It is not a new default.** The dress bundle asks for it (`anchors.json` `support.holdLength`). Every other bundle drapes bit for bit as before. The reason is in the numbers below: with length held, a free-hanging skirt shows less difference between sizes, and the men's tee gets a higher peak strain. Those are behaviour changes for garments I could not look at in the embed, so they stay off.
- **It does not remove the dress's three hints.** With length held the seam still opens from 86 to 98.6 cm without its loop, and the top edge still drops 3 cm without the held band. Those are girth and support problems, not length problems. So the dress now has four hints, not two.
- **The target of 1.5 % is met; "as cut" is not.** About 1 % of extra length remains, most of it between the seam and the hip.
- **Three of the five garments asked for could not be measured as asked.** The photo-reconstructed skirt, the azure dress and the palazzo live in the git-ignored `out/eval/` and are not in this checkout. I measured stand-ins (each product's committed payload on a synthetic mesh). They say what the solver does to a mesh of that kind; they say nothing about those bundles' own meshes.
- **The 15.7 % segment of the POM skirt is not this solver.** That number is from the Blender server drape's start shape (OI-54). The device does not drape that bundle; it blends the bake. Nothing here changes it.

## Why the cloth came out long (measured)

The centre front of the AU 12 dress, edge by edge, was 1.1 to 5.6 % long over its whole length, **including the lowest edges, which carry no weight** (1.1 to 1.9 %). So it is not cloth giving under load.

The solver holds length with tethers: every particle stays within its cloth distance of a pin, measured as a straight line. Where the cloth bends on its way down (over the bust, in at the seam, out over the hip, in folds) the straight line is shorter than the cloth, and the tether has slack. The edge constraints are soft (half of the error per projection, six projections a substep, 44 rows from top to hem) and never take that slack back. A flat sheet hung from its top row comes out exactly at length; the same sheet hung over a bar comes out 4.1 % long (`cloth.test.ts`).

Three things I tried first, with their results:

| Tried | Result |
|---|---|
| Collision after every projection instead of twice a substep | No change in length (73.89 against 73.90 cm), about a third more time. Not the cause. |
| A hard limit on every path edge, moving only the particle farther from the support ("follow the leader") | Unstable. A push on the upper cloth runs down the line like a whip: the sheet over the bar flew above its own pins, the dress's hem ring went from 168 to 237 cm, residual motion 39 to 57 cm. Also with the nearer particle at 0.1, 0.3 and 0.5 of the share. |
| The same limit with equal shares, in support order | Stable, barely helps (sheet +3.4 % from +4.1 %). A correction does not travel down 44 rows in six passes. |

## What was built

**Hang lines** (`packages/garment-viewer/src/cloth.ts`, `hangLines`, `addHangLines`, `projectHang`).

- Every particle has a shortest path along the cloth to the held particles (the tethers already compute it). A hang line is a pair of particles on one such path, 1, 2, 4, 8 … steps apart. It may not be longer than the cloth between its ends, plus a small allowance.
- Per stride only every stride-th particle of a path gets a line. That gives about two lines per particle (the dress has 6,160 particles and 18,158 edges; the line count on it was not printed, the unit test checks the ratio on a grid). The coarse lines carry a correction from the support to the hem in a few passes, as a tether does. The fine ones follow the bends, which a tether cannot.
- One way only: a line may always be shorter. The cloth still folds, gathers and wraps the body. Nothing is made stiff against bending or compression.
- Projected once per iteration, coarse to fine, by inverse mass, with the nearer particle counting 0.85 (`HANG_NEAR_WEIGHT`). Equal shares left +1.3 % on the dress, 0.85 leaves +1.1 %, 0.7 leaves +0.9 % but did not come to rest (still 1.4 to 3.3 cm of motion after 3 s), 0.5 was worse again. 0.85 settles like the solver of before (0.2 to 0.4 cm after 3 s).
- The allowance follows the bundle's `material.json` `stretchPct`: a fifth of it, held between 0.2 and 1 % (`hangStretchOf`). Viscose at 1.5 % gives 0.3 %. The fifth is **assumed**: a fabric's stretch value is what it gives when worn, and under its own weight it gives far less; I had no measurement of how much.
- Off unless `clothParams(…, { holdLength: true })`. Without it the parameters have no `hangStretch` key and the cloth no lines, so a drape job is the same object as before and the fork-parity test with `spikes/garment-engine/viewer` holds without touching the spike.

**The bundle hint.** `anchors.json` `support.holdLength: true` (`bundle.ts`, two lines in `prepareFit`). The tape-built dress sets it (`spikes/garment-engine/src/pomDressBundle.ts`).

**Small additions elsewhere.** `mount.ts`: the canvas gets `data-solve-ms`, the worker's solver time for the size on show (one line; a timing, nothing about the shopper). `scripts/demo-dress.mjs`: `--throttle <n>` and a log line with open-to-settled and solver time.

Not touched: `packages/fit-engine`, `.github/`, `trouser.ts`, the chino builders, the not-drawn logic, `Garment3D.tsx`, the spike viewer's `cloth.ts`. No new interface text.

## Measured

All numbers are from this branch, in node, with the viewer's own `prepareFit` + `relax` (`clothHangMetrics.test.ts`; "before" is the same code with the hint ignored). **Noise:** the solver is deterministic, so a garment whose settings do not change gives the same numbers to the last digit; I checked that (17 of 17 rows of the unchanged garments and all four of their spread tables are identical before and after). Time is the only noisy number: about ±10 % between runs on this shared machine. For the spread I also froze the unchanged solver at 1.4, 1.6 and 3 s instead of 1.5 s: the spread moved by at most 3 points on the dress and 7 on the skirt stand-in's hem.

### The dress (shipped behaviour: before → after)

Centre-front length is the builder's own vertex column, against the tape. "Path" is the cloth between the support and the farthest tenth of the particles, median, against its rest length. Strain is over all 18,158 edges. Residual is the largest distance any particle moves in one more simulated second after the freeze.

| Body, size | Length, cm (tape) | Over tape | Path | Strain p99 | Strain max | Residual, cm |
|---|---|---|---|---|---|---|
| AU 8, 8 | 71.55 → 70.73 (70) | 2.2 → 1.0 % | 1.8 → 1.1 % | 5.9 → 7.6 % | 17.6 → 16.4 % | 1.55 → 0.72 |
| AU 10, 10 | 72.74 → 71.78 (71) | 2.5 → 1.1 % | 1.9 → 1.1 % | 6.3 → 8.0 % | 18.7 → 16.6 % | 1.64 → 0.83 |
| AU 12, 12 | 73.90 → 72.82 (72) | 2.6 → 1.1 % | 2.0 → 1.2 % | 6.5 → 8.2 % | 19.7 → 17.6 % | 1.31 → 0.58 |
| AU 14, 14 | 74.91 → 73.85 (73) | 2.6 → 1.2 % | 2.1 → 1.2 % | 6.8 → 8.5 % | 21.1 → 18.6 % | 1.49 → 0.67 |
| AU 16, 16 | 76.11 → 74.89 (74) | 2.9 → 1.2 % | 2.2 → 1.3 % | 7.0 → 8.8 % | 21.7 → 19.6 % | 1.66 → 0.50 |
| AU 8, 156 cm | 71.61 → 70.76 (70) | 2.3 → 1.1 % | 1.8 → 1.1 % | 6.0 → 8.0 % | 17.9 → 17.3 % | 1.03 → 0.73 |
| AU 12, 156 cm | 73.81 → 72.83 (72) | 2.5 → 1.2 % | 2.0 → 1.2 % | 6.6 → 8.7 % | 20.4 → 18.3 % | 1.43 → 0.74 |
| AU 16, 156 cm | 76.00 → 74.90 (74) | 2.7 → 1.2 % | 2.2 → 1.3 % | 7.1 → 9.4 % | 22.4 → 20.2 % | 0.72 → 0.78 |
| AU 8, 180 cm | 71.61 → 70.63 (70) | 2.3 → 0.9 % | 1.7 → 1.0 % | 6.0 → 7.3 % | 17.1 → 18.3 % | 1.58 → 2.17 |
| AU 12, 180 cm | 73.80 → 72.71 (72) | 2.5 → 1.0 % | 2.0 → 1.1 % | 6.6 → 8.0 % | 19.6 → 17.0 % | 1.69 → 2.35 |
| AU 16, 180 cm | 76.03 → 74.76 (74) | 2.7 → 1.0 % | 2.1 → 1.2 % | 7.0 → 8.4 % | 21.2 → 19.3 % | 1.16 → 2.66 |

What got better: length, on every row; the largest strain on 10 of 11 rows; residual motion on the bundle body and at 156 cm.

What got worse, and it is real:

- **p99 strain rose by 1.3 to 2.3 points.** The share of edges more than 3 % long fell (AU 12: 7.6 → 4.8 %), but the share more than 10 % long rose (0.19 → 0.53 %). The strain is now concentrated at the gathering row under the seam instead of spread down the skirt. The gathering stitch on the centre front went from 2.5 to 9.3 % (one 0.8 cm edge).
- **The gathered row is compressed more**: skirt top 121.6 → 119.9 cm against a tape of 129 (AU 12); 1st-percentile strain −4.1 → −5.4 %. It was already 5 to 6 % short; it is now 7 %.
- **At 180 cm the cloth moves more after the freeze** (1.2 to 1.7 → 2.2 to 2.7 cm). Not looked into.
- **The seam is 0.2 to 0.3 cm wider** (AU 12: 87.32 → 87.61, tape 86, limit 87.29). The hang lines run after the seam's loop inside an iteration and pull it open by that much.

Unchanged: bust (the held band), hem sweep (within 0.1 cm), strap, bodice length.

### Size spread on the dress

AU 8 against AU 16, both on the AU 12 body: difference in hull girth, cm, of the graded mesh and after the drape.

| Height | Graded | Before | After |
|---|---|---|---|
| 4 cm under the underbust | 19.2 | 14.7 (77 %) | 14.3 (74 %) |
| Waist | 20.2 | 14.3 (71 %) | 12.8 (63 %) |
| Hip | 20.2 | 10.6 (52 %) | 4.3 (21 %) |
| 10 cm under the hip | 18.8 | 9.1 (48 %) | 4.2 (22 %) |

**Less of the spread survives below the waist, by more than half.** That is far outside the noise. The software renders show why: before, the skirt balloons out over the hip, more in the larger size; after, it hangs nearly straight in every size. The balloon was standing on the extra length (a cloth 2.5 % too long from seam to hem has room to stand off the hip). So part of the size difference a shopper saw on this dress was the solver's stretch. Whether the straighter skirt is closer to a real babydoll is not known: no real dress was compared. It does mean R3 ("sizes barely differ in the viewer") gets worse, not better, on any hanging skirt this is switched on for.

### The other garments (hold length forced on, NOT shipped)

Canonical body, sizes 8, 12 and 16 (tee: bodies S to XXL in their own size). "Path" as above. Shipped behaviour for all of these is the "before" column, unchanged.

| Garment | Path, before → forced on | Strain p99 | Strain max | Residual, cm |
|---|---|---|---|---|
| Azure dress, STAND-IN, 8 / 12 / 16 | 1.8 / 1.5 / 1.4 → 0.9 / 0.8 / 0.7 % | 20.3 / 17.2 / 14.3 → 20.2 / 17.2 / 14.7 % | 28.3 / 24.9 / 24.2 → 28.8 / 28.8 / 27.9 % | 2.2 / 2.5 / 3.2 → 3.3 / 2.4 / 5.7 |
| Photo skirt, STAND-IN | 1.8 / 1.6 / 1.3 → 0.8 / 0.8 / 0.7 % | 12.0 / 4.7 / 3.9 → 12.2 / 3.0 / 2.6 % | 20.2 / 10.1 / 6.6 → 20.2 / 12.4 / 11.4 % | 2.0 / 1.5 / 3.4 → 2.8 / 2.1 / 1.2 |
| Palazzo, STAND-IN | 0.45 / 0.40 / 0.31 → 0.30 / 0.29 / 0.24 % | 9.4 / 5.0 / 5.2 → the same | 17.3 / 11.5 / 31.3 → the same | 2.5 / 3.0 / 2.8 → 3.0 / 4.1 / 3.0 |
| Lofted dress (`aalter-studio-2`), XS / M / XL | 1.8 / 1.4 / 1.3 → 0.9 / 0.8 / 0.7 % | 10.2 / 7.9 / 6.7 → 10.0 / 8.0 / 7.0 % | 17.9 / 15.7 / 16.1 → 18.3 / 15.5 / 16.5 % | 2.6 / 1.9 / 2.3 → 3.0 / 2.1 / 1.5 |
| Men's tee on male v2, S to XXL | 1.8 to 3.0 → 1.2 to 1.8 % | 14.1 to 14.6 → 13.3 to 14.5 % | **25.8 to 30.2 → 38.0 to 64.6 %** | 0.3 to 1.6 → 0.7 to 1.8 |

Spread, smallest against largest size, share of the graded difference that survives, before → forced on:

| Garment | Hip | Thigh | Knee | 20 cm under the knee |
|---|---|---|---|---|
| Azure STAND-IN | 14 → 15 % | 56 → 42 % | 63 → 41 % | (no graded value: the base hem ends above it) |
| Photo skirt STAND-IN | 20 → 20 % | 31 → 33 % | 46 → 17 % | 53 → 14 % |
| Palazzo STAND-IN | 34 → 35 % | 58 → 58 % | 77 → 76 % | 75 → 78 % |
| Lofted dress | 11 → 13 % | 68 → 52 % | 88 → 48 % | (as azure) |

Read honestly:

- **The stand-ins were 1.3 to 1.8 % long, not 2 to 3 %**, and holding length halves that. So the dress was the worst case, as its report said.
- **The palazzo barely changes.** Its legs hang nearly straight under the band, where the tether already works. Nothing to fix there.
- **The tee's own length was never the problem**: front length against rest +0.3 to +0.5 cm before and +0.3 to +0.4 after. Forced on, its peak strain roughly doubles (at single edges; p99 does not move) and it no longer settles early (S, M and XL stopped at 0.9 to 1.0 s before, all five run to the 1.5 s cap). A clear loss for no gain: the tee must stay off.
- **Every free-hanging skirt loses spread below the hip** (the skirt stand-in's hem 53 → 14 %). The same effect as on the dress.

### Time

Node, the 13 dress drapes of 1.5 simulated seconds (90 frames) each, run one after another, twice: ms per frame, median (range) before 12.3 (11.6 to 13.0) and 12.0 (11.5 to 13.0), after 13.9 (13.0 to 14.8) and 13.8 (13.0 to 15.9). **About +14 % per frame.** A whole dress drape goes from about 1.1 s to about 1.25 s of solver time. The other garments' time is unchanged (nothing runs for them).

Real stack, headless Chromium on SwiftShader, 390 × 760 at 2×, DevTools CPU throttle 4× from the tap on "3D" until the view is settled (`scripts/demo-dress.mjs --throttle 4`). One run each, five bodies:

| Body | Open to settled, ms, before → after | Solver in the worker, ms, before → after |
|---|---|---|
| AU 8 | 3900 → 3936 | 1260 → 1412 |
| AU 10 | 4074 → 4186 | 1342 → 1454 |
| AU 12 | 4019 → 3967 | 1250 → 1304 |
| AU 14 | 4030 → 4040 | 1222 → 1337 |
| AU 16 | 3794 → 4058 | 1166 → 1390 |

Solver time +10 % on the mean (1248 → 1379 ms). Open to settled does not move outside its own scatter (3.8 to 4.2 s both ways): it is mostly loading, the body and the software renderer. **The worker is not slowed by the throttle** (its solver time equals node's), so this is not a phone's solve time; the throttle acts on the page's main thread only.

Not measured: frames per second while the drape runs, a main-thread fallback (no worker), any real phone.

## Measured versus assumed

**Measured**: everything in the tables above, on this branch. The cause (edge-by-edge strain of the centre front; the sheet over a bar). The instability of the follow-the-leader variant. That the unchanged garments are bit-identical.

**Assumed [A]**:

- The allowance: a fifth of `stretchPct`, 0.2 to 1 %. No fabric was hung and measured.
- The nearer-particle weight 0.85: picked from four values on one dress and one sheet. Not derived.
- That a tape-built hanging garment should hang at its tape length. For a woven viscose that is safe. For a heavy knit it is not: a real jersey maxi grows under its own weight, and this would hide that.
- The stand-ins stand in. The real photo-reconstructed meshes are denser in places, have baked folds and a different hem; none of that was measured.

**Not done**: no real garment was compared. No GPU, no phone. The spike viewer's copy of `cloth.ts` does not have the hang lines (it has no bundle that asks for them).

## How it looks, honestly

Pictures: `docs/screens/claude/cloth-hang/`, the real embed at 390 × 760, deviceScaleFactor 2, SwiftShader. Each sheet has the solver of before in the top row and hold length in the bottom row; all five were looked at.

- `sheet-front-before-after.png`, `sheet-side-before-after.png`, `sheet-back-before-after.png`: AU 8, 12 and 16 on their own bodies.
- `sheet-front-10-14-before-after.png`: AU 10 and 14.
- `sheet-close-before-after.png`: AU 12 zoomed in, front and side.

What changed, as seen:

- **The belly is gone.** Before, the skirt swells out between the seam and the hip, front and back, in every size, and its folds bend round that swelling. After, the folds run straight down from the seam and the skirt reads as hanging cloth. This is the clearest difference and I think it is an improvement.
- **The length difference itself is hard to see.** The hem is only about 0.1 cm higher on the body (AU 12: 3.3 → 3.4 cm above the knee), although the cloth is 1.1 cm shorter: before, the swelling used up the extra length.
- **The side view is a straighter column.** Before, the back swells out at the seat and the hem flares a little; after, front and back fall nearly vertically. Less shape, and less like an A-line.
- **New defect: thin slits between the folds under the seam.** In the close-up and on the back, narrow light or dark vertical lines show between neighbouring folds from the seam down to the hip. The folds are pulled straight and tight there and open up between them. Body pixels through the skirt in four software views went from 0 to 33 to 0 to 71 (of 180,000 per view; AU 12: 16 → 50). Small in pixels, visible in the close-up. It was not there before.
- **The sizes look more alike**, as the spread table says. Before, the larger sizes had the larger belly.
- Unchanged: the flat band bodice, the thin straps, the regular fold stripes, the plain colour.

It is not stiff like cardboard: the hem still waves, the folds are still folds, the hem outline is slightly larger than before (AU 12: 111.8 → 113.7 cm of hull). But it is plainer. A reviewer who liked the fuller skirt of before will find this one flat.

## Did it remove a hint?

No. Each hint dropped in turn with hold length on, AU 12 on its own body:

| Dropped | Result |
|---|---|
| nothing | seam 87.6 cm (tape 86), bust 102.0, top edge at 122.6 cm, length 72.82 |
| `seamsAtCm` | **seam 98.6 cm**; length 72.56. The seam takes the bust's girth exactly as before. A ring of soft edges does not close in six passes; that is a girth problem and needs a loop, or a solver that converges on rings. |
| `pinFromCm` | top edge drops 3.1 cm, bust ring 106.8 cm, seam 95.5. Four strap corners cannot hold a band. |
| `cling: false` | lengths and seam unchanged (72.82, 87.7). The hem's outline was not re-measured here; the dress report measured 87 cm of outline for a 180 cm hem with the pull on, and nothing in this change acts against that pull. |

## Open issues

1. **Size spread on hanging skirts.** Holding length removes the hip balloon and with it more than half of the visible size difference below the waist. R3 needs something that is not stretch: the real flare of the cut, or a calibrated drape. Until then, switching this on for the photo skirt or the azure dress makes the sizes look more alike.
2. **About 1 % is left**, most of it between the seam and the hip where the cloth lies on the body. A weight below 0.85 takes more but does not come to rest.
3. **Slits between the folds under the seam** (see the look section), and body pixels through the skirt up from 0 to 33 to 0 to 71. Comes with the next point.
4. **The gathering row** takes the load the skirt used to spread: stitch strain up to 9 %, the row compressed 7 %. A gathering stitch as a proper constraint (many-to-one) would be the fix.
5. **The seam loop and the hang lines pull against each other** by 0.2 to 0.3 cm of seam girth. The order inside an iteration could be changed; not tried.
6. **Residual motion at 180 cm** is higher with hold length on. Not looked into.
7. **The tee** gets worse with it. If a sewn top ever needs length held, the lines must stop at the armhole or leave the sleeves out.
8. **The real bundles** (photo skirt, azure, palazzo) were not measured. Run `clothHangMetrics.test.ts` where `out/eval/` exists before considering the hint for them.
9. **The allowance and the weight are assumed.** One hung strip of two fabrics would set both.
10. **OI-54** (the bake's 15.7 % segment) is untouched; it is the Blender start shape.
11. The spike viewer's `cloth.ts` has no hang lines. Add them when the spike is promoted or a spike bundle asks for them.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
# unit tests of the hang lines, and the dress through the viewer's drape at three statures
pnpm --filter @curtain/garment-viewer exec vitest run src/cloth.test.ts src/pomDressDrape.test.ts
# the tables: metrics-before.json, metrics-default.json (as shipped), metrics-hold.json (forced on everywhere)
for v in before default hold; do CLOTH_HANG=/tmp/hang CLOTH_HANG_VARIANT=$v pnpm --filter @curtain/garment-viewer exec vitest run src/clothHangMetrics.test.ts; done
# the real stack in Chromium, with open-to-settled and solver time under a 4x CPU throttle
pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts
node scripts/demo-dress.mjs /tmp/demo-dress --throttle 4
npm_config_workspace_concurrency=1 pnpm check
```

The "before" pictures: the same run after deleting `"holdLength": true` from `spikes/garment-engine/out/synthetic-tape-babydoll-dress/anchors.json`.

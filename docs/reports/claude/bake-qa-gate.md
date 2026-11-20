# Bake quality gate and its merchant review (branch `claude/bake-qa-gate`, 19 Nov 2026)

## What was asked

Until now a server drape bake (POM v2, step3-serverdrape-spike.md §9-10) declared itself in qa.json
(`chartAgreement.kind: 'tape-built'`). The import turned that into the flag `tape_built_no_chart_check`, and the demo seed
approved it. Nothing tested the bake. This branch adds automatic checks that run on import and need no person. A bake that
fails is refused with an English reason. A bake that passes is an ordinary asset for the merchant to approve, and the merchant
console shows where each size's tape comes from. It also fixes two pieces of shopper wording in the embed.

## What was built

### 1. The bake check (`packages/garment-viewer/src/bakeGate.ts`, `checkDrapeBake`)

It runs on the server only. The tsup build gives it its own entry, `@curtain/garment-viewer/bakeGate`, and the compiled api
imports that, as `node dist/scripts/import-asset.js` does in production. It is not in the package index, so the embed's viewer
chunk never carries it. It reads only the bundle's five files. For the body test it rebuilds the drawn body the same way the
embed does: `buildAvatar` with the bake's stated girths, `bodyField`, and the device collider. It runs nine checks, and each
one gives English reasons:

| Check | What it tests | Limit (gate-owned, `BAKE_CHECK_LIMITS` in @curtain/schema) |
|---|---|---|
| `readable` | base.glb decodes as a bake; qa.json has `tape`; the bake names `tapeRings` (hip line, hem) and `bodies`; each body's hip lies on the bake's axis | 0.05 cm |
| `file_size` | the five files together | `MAX_GARMENT_BUNDLE_BYTES` (3 MB) |
| `sizes_have_geometry` | grading.json, the bake and the tape list the same sizes; every drape is finite and hangs at least half its tape length | — |
| `refusals_declared` | every body beyond a size's draped range is declared `notDraped` with a reason; a refusal never sits between two drapes of the same size (the phone would blend through it) | — |
| `provenance` | measured / interpolated / extrapolated per size is the same in the tape, grading.json and the bake; it matches the worst source of that size's five tape numbers; an interpolated size lies between two measured sizes, an extrapolated one does not; at least 2 sizes measured | — |
| `at_rest` | every drape carries `atRest` and its movement, within the limits | max 0.25, mean 0.02 cm/frame (§9.5) |
| `tape_rings` | on every drape, the path length of the hip-line ring and of the hem ring against the tape's C and D for that size | ±max(2 cm, 2 %) |
| `inside_body` | no particle deeper than the tolerance inside the drawn body it was draped on | 0.1 cm (the 0.05 cm grid rounds by up to 0.04) |
| `size_order` | where the tape grows from one size to the next, the draped ring does not shrink on any body both sizes share | 1 cm |

If a check fails, the checks that depend on it are reported as `not run`, never as passed. The builder cannot loosen any limit.

### 2. The import (`apps/api/src/services/assets.ts`)

- For a bundle whose anchors.json names `drapeBake`, `readBundleDir` runs the check after the existing format gate. The report
  is stored with the asset as `qa.bakeCheck`. Only the importer writes it: a qa.json that already carries `bakeCheck` is refused
  (`format`).
- **Fail:** `AssetImportError('bake_check_failed', <English reason>)`. The version is recorded with the new status `refused`,
  carrying the reason and the report. No files are stored (`bundlePath: ''`), it cannot be approved (`asset_refused`), and if
  that version was live it is taken off the storefront.
- **Pass:** an ordinary `awaiting_approval` asset. `garmentQaFlags` drops `tape_built_no_chart_check` when `qa.bakeCheck` is a
  complete, valid pass (`passedBakeCheck`: all nine checks present and passed). A bake imported before the check still carries
  the flag, and its note now says how to run the check: import the bundle again. That re-import replaces the stored report.
- `MerchantGarmentAsset` gains `bakeCheck` (zod `BakeCheckReportSchema`) and the status `refused`. The status column is text,
  so no migration was needed.
- `checkGarmentBundle` now asks a bake for `kind: 'tape-built'` directly, not for the flag, so a bake that passed stays valid.
- Dockerfile: it builds anchors, mannequin and garment-viewer before the api, and checks that
  `node_modules/@curtain/garment-viewer/dist/bakeGate.js` is in the deployed image. **I could not run a docker build here
  (no docker).** The compiled api does load the gate: `node -e "import('./dist/services/assets.js')"` works after
  `pnpm --filter @curtain/api build`.
- Demo: `DEMO_SKIRT=pom` now expects no flag (demo.ts, demo-e2e.mjs). A bake in `out/` written before this branch lacks the
  tape, rings, bodies and at-rest flags, so the check refuses it. Re-run `bake-pom.ts`, the last step of `pom-bundle.sh`; it
  needs no Blender.

### 3. What a bake must now state (`bake-pom.ts`, shared helper `bakeTape.ts`)

- qa.json `tape`: `hipBelowBandCm` (null for the pilot skirt, because the shop did not state the distance) and, per size, its
  provenance and the five numbers, each with `{cm, source}`. The data is the rest.json of `pom_rest.py`, with the free-text
  sources normalised to a single word.
- base.glb `curtainBake`: `bodies` (the chart line bust 95 + 10t, waist 77.5 + 10t, hip 104 + 10t, as `avatar-bodies.ts`),
  `tapeRings` (rest.json `rings.hipRing` and the last ring), and per size `drapes[]`
  `{t, atRest, maxMoveCmPerFrame, meanMoveCmPerFrame}`, computed from each drape's settle trace with `pom2_measure.py`'s
  threshold.

### 4. Merchant console (`apps/web/src/merchant/AssetReview.tsx`, route `/merchant/products/:id/3d`)

- Each product has a "3D estimate" link. The review lists every version with its status (waiting / approved + live / rejected /
  replaced / refused by the automatic check), the nine checks (✓ / ✗ with reasons / not run), and the tape per size. Each size
  shows a provenance chip (Measured · your tape / Estimated · between two sizes you measured / Rough estimate · beyond the sizes
  you measured, the wording of MERCHANT-MEASUREMENTS.md), the hip C, hem D and stretched band B, and under each tape number
  what the 3D drape measured there across its bodies. It also shows which bodies a size is not drawn on and why, the hip
  distance ("you did not say"), and Approve / Reject. A refused version has no buttons.
- The strings are in a new catalogue, `merchant/strings.ts` (D21). The rest of the console still writes its English inline,
  as it did before.
- Demo mode (API unreachable, under the existing "demo data" banner): the pilot skirt is the first product and has three
  versions. The two check reports are **real output of the check**, regenerated by
  `spikes/garment-engine/viewer/scripts/serverdrape/bake-check-mock.ts`.

### 5. Shopper wording (apps/web, outside the About-you form)

- **Waist contradiction.** For a pull-on size whose band only just passes the hips (`pullOn: marginal`), the figure's waist chip
  now reads "Waistband · only just pulls on" (warning tone) instead of "Good fit · by the size chart". When the band does not
  pass (`blocked`) it reads "Waistband · too small to pull on" (bad tone). The "How size … fits you" waist row shows the same
  check, with "By the size chart: good fit, 2.5 cm less room than designed" kept as the line under it. The screen-reader
  sentence starts with the check. Sizes that pull on fine are unchanged. Files: `render/rings.ts`,
  `components/SizeRings.tsx`, `embed/ResultScreen.tsx`, `embed/strings/en.ts`.
- **A blocked size's score never shows.** `lib/fitScore.ts` (`shownSizeScore`, `shownFitScore`, `scoredSizeBlocked`) is now the
  only way a percentage reaches the screen. Every surface:
  - embed FitPanel, "No size fits": it said "Closest is 16 at 99%". It now says "Closest is 16, but its waistband does not
    stretch over your hips — we would not recommend it."
  - embed compare chips: these already said "too small to pull on"; they now go through the helper.
  - consumer app size chips (`routes/TryRoute.tsx`): these printed the raw score for every size. A blocked size now says "too
    small to pull on".
  - consumer app FitPanel: shared with the embed, so covered by the same change.
  - peek: it shows no score at all, and nothing changed.
  - merchant console: it shows no fit score anywhere. Its only percentage is product completeness.
- The fit engine was not touched. It still scores a blocked size from the chart (0.999 is possible). That is the engine's
  output and is now only filtered at display.

## Measured, assumed, not done

**Measured** (on the fixture, this container):

- The check takes 177 ms on the fixture: 18 drapes, 16,071 particles each, 4 bodies.
- Draped rings against the tape: the hip line is 112.0-114.1 (AU 8), 122.0-124.1, 124.0-125.1, 126.0-126.5 and 128.0 cm against
  tape 112 / 122 / 124 / 126 / 128. The hem is 230.1 / 248.1 / 254.0 / 260.1 / 266.0 against 230 / 248 / 254 / 260 / 266.
- 0 particles inside the drawn body on every drape.
- The fixture is 200,976 bytes of base.glb.

**The fixture is not a simulation.** `packages/garment-viewer/fixtures/pom-v2-rest/` is the POM v2 rest geometry of the real
skirt. It comes from the committed `pom_rest.py --profile tube --edge 1.0`, built from the shop's tape (AU 8, 10, 14 measured,
12 interpolated, 16 extrapolated). That geometry is laid on the device avatar of each chart body and pushed out by the device
collider (0.35 cm). There are no folds and no hang, the drapes are declared at rest with zero movement, and its `source` says
FIXTURE. Its AU 8 cannot go on the 109 and 114 cm bodies (the hip line would stretch to 117.0 / 120.4 cm), so it declares them
not draped. The real bake refuses only the 114 cm body. The real POM v2 bake needs Blender drapes in the git-ignored `out/`,
which this checkout does not have. Blender is not installed here.

*Later (19 Nov 2026, branch `claude/pom-gate`, `docs/reports/claude/pom-gate.md`):* the fixture is rebuilt with the real bake's
plan (11 drapes on 5 bodies; every refusal is the band, `rule: 'pull-on'`), and `refusals_declared` now recomputes the fit
engine's pull-on check against the drawn bodies. The numbers above are those of the first fixture.

**Not measured, and probably a refusal:** the real POM v2 bake under this check. §10.1 of the spike records that AU 10 on the
AU 8 body was **not at rest** (0.285 cm per frame against 0.25). The rebaked POM v2 should therefore be refused by `at_rest`
until that drape is re-run longer or the threshold is changed by a decision. I did not change the threshold. Its ring lengths on
the avatar drapes were also never measured. The direct drapes of §10.3 match the hem fabric to 0.1 cm, but the hip line under
the pinned seam is untested.

**Assumed:**

- The tolerances in the table above. ±max(2 cm, 2 %) is a judgement: Blender's direct hems matched within 0.1 cm, and the
  rest pushed onto a body adds up to 2.1 cm at the hip.
- That the bake's stated bodies are the bodies it was draped on. The check rebuilds them from their girths. It cannot see the
  Blender scene.
- The hip line is the ring the builder names (20 cm below the top edge, `pom_rest.py`'s ASSUMED depth). The shop never stated
  the distance, and the console says so.

**What the check cannot tell (still a person's job, D13):** whether the drape looks right (folds, hang, floor), the band level
(a rule of the builder), and how good the phone's blend is between bodies (§10.3).

## Screenshots (`docs/screens/claude/bake-qa-gate/`, 3.4 MB, PNG)

Shopper result: the production embed build, mocked api, 360×740 at 2×. Pilot pull-on skirt with the shop's tape; height 168,
weight 62.

- `before-hip100-full.png` / `after-hip100-full.png`: waist 73.5, hip 100. Before, the figure chip reads "Good fit / by the size
  chart / band 71-100 cm measured" while the panel above says "Only just pulls on", and the "How size 10 fits you" card says
  "Waist: Good fit". After, the chip reads "Waistband / only just pulls on" in amber and the card reads "Only just pulls on".
  The rest of the page is the same.
- `before-hip100-panel-figure.png` / `after-hip100-panel-figure.png`: crops of the same pages (panel, chips, figure).
- `before-hip100-points.png` (crop) / `after-hip100-points.png`: the waist row before and after.
- `before-hip120-top.png` / `after-hip120-top.png` and the `-panel` crops: waist 95, hip 120, every size blocked. Before:
  "Closest is 16 at 99%". After: "Closest is 16, but its waistband does not stretch over your hips". The compare chips say "too
  small to pull on" in both.
- `after-hip120-figure.png`: the waist chip "Waistband / too small to pull on" in red. The sticky action bar covers the lower
  part of the figure, as it did before this branch.
- `after-hip120-points.png`: the waist row "Too small to pull on".

Merchant console: production build, API unreachable, so demo data under the banner. Phone 360×740 at 2×, desktop 1180 wide at 2×.

- `console-desktop-products.png`: the products table with the new "3D estimate" link column. The phone version
  (`console-phone-products.png`) scrolls the table sideways, as the existing table already did.
- `console-desktop-review-full.png`: the whole review, three versions, newest first.
- `console-desktop-awaiting_approval.png` / `console-phone-awaiting_approval.png`: all nine checks ticked. The tape table shows
  provenance chips, the 3D numbers under the tape numbers, and the two declared AU 8 refusals. On the phone the provenance chip
  moves under the size and the band column is hidden, so hip and hem fit.
- `console-desktop-refused.png` / `console-phone-refused.png`: two failed checks with their reasons (AU 16 called measured
  while its numbers are extrapolated; AU 12's hem 254 cm on every body against a tape of 280 cm), and no buttons.
- `console-phone-approved.png`: after "Approve for shoppers", with Approved and Live for shoppers.
- `console-desktop-superseded.png`: a version imported before the check, with "Read before approving" and the updated flag
  sentence.

Honest read: the console reads clearly on desktop. On the phone the review is long but nothing is cut off. The checklist uses
plain words. Its reason lines are the gate's own sentences with the first letter capitalised, and some are technical ("hip-line
ring"). The shopper change is small and does what was asked. "Hips 8 cm room" next to "too small to pull on" at hip 120 is not
a contradiction (skirt fabric against body hip, as against the band), but a shopper might read it as one.

## Open issues

1. Expect the real POM v2 bake to be refused by `at_rest` (AU 10 on the AU 8 body, §10.1). Decide: re-drape longer, or change
   the threshold by a recorded decision.
2. The Docker image change is not built here. Run `docker build -f apps/api/Dockerfile .` once.
3. The swipe deck still sends the engine's score (`fitScore`) of the result with each swipe, including a blocked closest size.
   It is stored and exported back to the shopper and never shown to the merchant. The taste ranking may use it, and a blocked
   size scoring 0.999 can rank a garment that does not pull on. That is engine or taste-engine territory, which I did not
   touch.
4. The rest of the merchant console still has inline English. Only the new 3D review uses the catalogue.
5. The console review is not in the Shopify embedded admin. It is in the web merchant console only.
6. `refusals_declared` allows a size to skip a body inside its draped range, because the real bake does this for AU 10-16 at
   t = +0.5. The blend across that body is not checked (§10.3 measured it at 1.4-1.9 cm RMS).

## Reproduce

```sh
pnpm install --frozen-lockfile
# the fixture (from the committed scripts; no Blender)
cd spikes/garment-engine
python3 serverdrape/pom_rest.py /tmp/rest --profile tube --edge 1.0
pnpm exec tsx viewer/scripts/serverdrape/bake-pom-rest-fixture.ts /tmp/rest ../../packages/garment-viewer/fixtures/pom-v2-rest
pnpm exec tsx viewer/scripts/serverdrape/bake-check-mock.ts ../../apps/web/src/merchant/mockBakeChecks.json
cd ../..
# tests
pnpm --filter @curtain/schema build && pnpm --filter @curtain/garment-viewer build
pnpm --filter @curtain/garment-viewer exec vitest run src/bakeGate.test.ts
pnpm --filter @curtain/api exec vitest run src/bakeCheck.test.ts src/assets.test.ts
pnpm --filter @curtain/web exec vitest run src/merchant src/__tests__/fitScore.test.ts src/embed/__tests__/pullOnChips.test.tsx
npm_config_workspace_concurrency=1 pnpm check   # passed on this branch, 19 Nov 2026 (exit 0)
# screenshots: build the web app, `pnpm exec vite preview --port 4199` in apps/web, then drive /embed/<token> with a mocked
# /v1/try returning PILOT_PULL_ON_SKIRT (as apps/web/e2e/garment3dBake.spec.ts does) and /merchant/products with a
# session key (API unreachable → demo data)
# the real bake, where out/pom2-avatar exists: serverdrape/pom-bundle.sh, then
pnpm --filter @curtain/api asset:import --shop <shop> --product crimson-wildflower-maxi-skirt --dir spikes/garment-engine/out/pom2-bundle/crimson-wildflower-maxi-skirt
```

# Loose ends (branch `claude/loose-ends`, 19 Nov 2026)

From `claude/garment-engine` at `e7e0413`. Four tasks: one list of every open issue, the small engineering fixes, D21
completeness for `apps/web`, and `docs/STATUS.md` brought up to date. `packages/fit-engine`, `.github/`, `spikes/` and
`scripts/demo-men.mjs` are untouched; in `packages/garment-viewer` only `scene.ts`, its test and one README line changed.

## 1. `docs/OPEN-ISSUES.md`

100 open rows from the 18 reports, `docs/STATUS.md` and the men-m2 notes, deduplicated, each with the report it came
from: 17 needs-founder, 7 needs-counsel, 14 needs-real-device, 62 engineering (with a size guess). Issues a later report
or the code shows as fixed are in "Resolved since reported" with how that was checked ("not verified" where only a
report says so). Five engineering rows are closed by this branch (below).

## 2. Engineering fixes

Four of the six items named in the brief were already fixed on the base by the pom-gate review (`d59e1cd`, merged as
`a8c9946`). I checked each against the code instead of changing it again:

| Item | State on the base | Checked how |
|---|---|---|
| Refusal sentences say "the simulation could not put it on" | Already rewritten: with `rule: 'pull-on'` the note names the band | No such text in `apps/web` or `packages`; `garment3d.test.tsx` asserts "simulation" is absent. One stale README line in `packages/garment-viewer` corrected here |
| AU 8 drawn up to the 99 cm body although the advice blocks it from hip 96.6 | Already fixed: a size the advice blocks is not drawn (`adviceBlocked`) | Code read; unit test passes. The Playwright spec `garment3dBake.spec.ts` was not re-run here |
| Fixture `pom-v2-rest` drapes AU 8 on hip 104 | Already rebuilt | Read `base.glb`: AU 8 is draped on hip 94 only and declared `notDraped`, `rule: 'pull-on'`, on 99, 104, 109, 114 |
| The bake gate does not check pull-on against the tape | Already does: `refusals_declared` runs `pullOnCheck` with the tape's stretched band | Code read; `bakeGate.test.ts` passes |

Fixed here:

- **`Figure.setBody` put the grey material back on a skin-coloured figure** (`packages/garment-viewer/src/scene.ts`). The
  final `else` belonged to the wrong `if`: a new body with the same vertex-colour setting got the shared grey. Now a
  figure with a skin colour keeps its own material. `look.test.ts` fails on the old code (2 tests) and passes now.
- **The waist-only W/L wording gap.** No report describes it; found by reading the result screen. On a W/L chart whose
  leg cannot be checked, the heading said "Waist 34 fits you best" while the fit panel under it said "No size fits …
  we would not recommend it", the 3D label said "No size fits well" and the size peek said "No size fits well". All
  four now name the waist (`waistOnlyOf` in `aboutYou.ts`; new strings `result`/`view3d.waistOnly`,
  `peek.waistOnly`, `peek.waistOnlyNote`, `shared.fitPanel.waistOnly`, `waistOnlyText`). The peek has a new outcome
  kind `waist` (`data-outcome="waist"`). Tests in `aboutMen.test.tsx` and `garment3d.test.tsx`.
- **OI-92** (no spinner while a required 3D view loads) was already fixed on the base; marked so in the list.

Not done from the "small" engineering rows: the WooCommerce ones (OI-87, OI-89: need the real-WordPress run to be
safe), the flaky `avatarPrompt` test (OI-45: not seen in this branch's runs), the cohort double count (OI-47: changes
frozen analytics, wants a decision), and everything under `spikes/` (other sessions are working there).

## 3. D21: every interface string of `apps/web` in a catalogue

| Part | Catalogue | Strings moved (about) |
|---|---|---|
| Components the embed shares with the app (fit panel, estimate badge, size rings and their notes, avatar figure, number field) | `apps/web/src/strings/en/shared.ts` | 95 |
| Camera scan (`features/capture`) | `apps/web/src/strings/en/capture.ts` | 150 |
| Consumer app (routes, onboarding, deck, wardrobe, profile, legal chrome, client error fallbacks) | `apps/web/src/strings/en/app.ts` | 190 |
| Merchant console | `apps/web/src/merchant/strings.ts` | 128 |

- **One lookup, one locale.** `appStrings()` (`apps/web/src/strings/index.ts`) reads the locale the embed's entry names
  once; `setEmbedLocale` hands it on, so a shared component inside the embed follows the same pack as the screen around
  it. Nothing reads the browser language. `scripts/check-language-packs.mjs` now counts this catalogue as a fifth
  surface.
- **Guard tests.** `apps/web/src/strings/strings.test.tsx` scans every source file outside the embed and the console
  for JSX text, text attributes, sentences in strings and templates, and state setters given a sentence; it fails on
  the old `FitPanel.tsx`, `rings.ts`, `BodyStep.tsx` and `ProfileRoute.tsx` (each tried). `merchant/strings.test.ts`
  does the same for the console (it flagged about 90 lines of the old files). The embed's own test is unchanged.
- **A pure move.** Existing tests pass unchanged (they pin ring, chip and panel text word for word). The merchant
  console was also compared old against new by `innerHTML` over 115 renders. The shared components were not compared
  over generated inputs: imperial units and the clamped-hem path of the size rings are the least pinned.
- **The scan worker** has its own module instance, so it sends codes, not text: the one shopper-facing worker error
  travels as `code: 'no_front_frame'` and the page turns it into catalogue text.

Still not in a catalogue (also in `docs/i18n/README.md`): the fit engine's own sentences (only the consumer app prints
them; the engine was not touched), text printed from packages and data (taste engine labels, `@curtain/schema` setup
and plan texts, api step titles), developer messages of uncoded scan errors that can reach the screen, number and date
formats (`en-GB`, `en-IE`), `apps/site`, api errors, the Shopify admin page.

## 4. `docs/STATUS.md`

Rewritten for today: what the 19 merged branches added, a table of everything behind a flag with what each waits on,
the D21 state, the verification table with the branch each check last ran on, and the known gaps replaced by a short
"waits on whom" list that points to `docs/OPEN-ISSUES.md`. Two stale known gaps removed (analytics date ranges, the
Anny licence row).

## Screens (`docs/screens/claude/loose-ends/`, phone size, deviceScaleFactor 2, production build, mocked api)

- `embed-wl-waist-only-result.png`, `-full.png`: the synthetic men's W/L chino with no inside leg: heading and fit
  panel both name the waist. In the full-page shot the fixed action bar sits over the figure; that is the capture, not
  the screen.
- `embed-womens-result-unchanged.png`, `-full.png`, `app-onboarding-unchanged.png`, `app-privacy-unchanged.png`,
  `merchant-login-unchanged.png`: screens whose text moved to a catalogue, as they look now. No before pictures were
  taken; "unchanged" rests on the tests above.
- Not pictured: the 3D label and the size peek in the waist-only case (they need a 3D bundle and a remembered profile);
  both are covered by unit tests.

## Checks

- `npm_config_workspace_concurrency=1 pnpm check` on the branch with every code change in: **pass, exit 0** (build,
  typecheck, lint, tests, app builds, viewer chunk 182.5 KB gzip of 400 KB, secret scan, "language packs: en on all 5
  surfaces"). `apps/web`: 72 test files, 599 tests passed. No test failed or was skipped that was not skipped before.
  Only docs changed after that run.
- Not run: Playwright e2e, `pnpm demo:e2e`, anything needing a GPU, Docker or a real shop.

## Open issues

1. The shared components' move was not compared old against new over generated inputs (see above).
2. Developer messages of uncoded scan errors can still reach the screen in English; hiding them is a behaviour change.
3. The merchant console has no locale setting, so a console pack needs a lookup by locale as well as a catalogue.
4. Playwright e2e specs and `pnpm demo:e2e` were not run on this branch (they match on visible text, which did not
   change except in the waist-only case, which no spec covers).
5. `ColourChip.tsx` compares against the taste engine's English labels to pick a colour class; a translated engine
   label would break that. The engine should return a code.

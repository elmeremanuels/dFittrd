# `@paskamer/web` — the consumer PWA (and the merchant console)

React 19 + Vite 6 + Tailwind 4 + motion, react-router 7 (data router), zustand + Dexie, vite-plugin-pwa.
Product truth: `docs/HANDOFF.md`; decisions: `docs/DECISIONS.md`; the audit this rewrite closes: `docs/research/prototype-audit.md`.

```
pnpm --filter @paskamer/web dev        # http://localhost:3000 (VITE_API_URL in .env, defaults to same origin)
pnpm --filter @paskamer/web typecheck  # tsc --noEmit (strict)
pnpm --filter @paskamer/web test       # vitest (node + jsdom per file, fake-indexeddb)
pnpm --filter @paskamer/web lint       # eslint flat config: typescript-eslint, react-hooks, jsx-a11y
pnpm --filter @paskamer/web build      # icons → vite build → dist/ (+ sw.js, manifest)
pnpm --filter @paskamer/web e2e        # build + Playwright privacy spec (fake camera, Chromium)
pnpm --filter @paskamer/web models     # fetch the MediaPipe models into public/models (~50 MB, not committed)
node scripts/check-bundle-secrets.mjs  # from the repo root, after a build
```

## Routes

| Route | Screen |
|---|---|
| `/onboarding` | welcome → measurements (number + slider, per-field ranges, foot EU, "how did you measure") → style vibes (`applyOnboardingVibes`) → `CaptureStep` from `features/capture` (Next is owned by the capture step: complete or explicit skip) → done |
| `/deck` | the swipe deck: `dealNext`/`rankDeck` over the paired catalogue (bundled `MOCK_GARMENTS` until a shop is paired), on-device `computeFit`, mirror, fit panel (`aria-live`), four action buttons, Style DNA `<dialog>` |
| `/try/:token` | `GET /v1/try/:token` → shop banner + garment → fit + mirror, size preview chips, cohort bars; not onboarded → `pendingIntent` then resume. `mock:<garment id>` resolves a fixture (dev/e2e) |
| `/wardrobe` | saved items with size; saved → bought → kept / returned (feeds the fit engine history), cohort bars |
| `/profile` | measurements + confidence + remeasure, colour season (labelled estimate), Style DNA, render consent tier (`avatar` default / `heroOptIn` explained), privacy `<Ledger/>`, export, delete scan, delete everything (`DELETE /v1/me`) |
| `/pair` | pairing stub: paste a try link / code (QR is the phone camera), list of paired shops |
| `/merchant/*` | separate route tree (not in the phone frame) behind a `sk_…` key in `sessionStorage`: overview, products (completeness + missing fields), usage & plan, swipe aggregates, provider ledger. Falls back to typed demo data when the API is unreachable |

A dev-only Customer/Merchant switcher is rendered under `import.meta.env.DEV`.

## Module map (`src/`)

- `api/client.ts` — `ApiClient` typed from `@paskamer/schema` DTOs. `fetch`, base `VITE_API_URL`, device JWT in memory + IndexedDB (`POST /v1/devices` on first run; a token in its last 7 days is rotated with `POST /v1/devices/rotate` so the device id — and its server rows — survive; re-registers on 401 or after full expiry). **Every network write appends a client-side ledger entry `{ id, at, kind, method, path, bytes, fields, status }`** (field names, never values). `MerchantApi` for the console. No method accepts a Blob; `PersonInput.kind` is `'avatarRender'` by type.
- `db/db.ts` — `AppDb extends PaskamerDb` (capture's class), Dexie db **`paskamer` version 2**: capture's five v1 stores untouched + `taste, wardrobe, swipes, outbox, ledger, settings, pendingIntent, renders` (LRU 50 via `putRenderLru`). `getAppDb()` registers the instance with capture through `setDb()` so both share one connection/version.
- `store/store.ts` — `createAppStore({ db, client? })` (zustand). State: settings, profile (`BodyProfile`), `fitCtx` (`toUserBody` + `sigmaFromBodyProfile`), taste (`TasteState`), wardrobe, ledger, pendingIntent, catalog, deck. Actions: `hydrate`, `setProfile` (enqueues the fit signature), `completeOnboarding`, `dealNext`, `swipe(action, {garment, shopId, intentToken})` (applySwipe → outbox; swipes/saves on the bundled demo rail (`MOCK_SHOP_ID`) stay on the device and are never queued), `saveToWardrobe`, `setWardrobeState` (kept/returned → `profile.history`), `setPendingIntent`, `addPairedShop`, `setConsent`, `deleteScanLocal`, `deleteEverything`, `exportLocal`, `flushOutbox`. `store/index.ts` wires the singletons (`useApp`, `api`).
- `store/fit.ts` — memoised on-device `computeFit` per (user body, garment object) — not per id: `GarmentPayload.id` is shop-scoped. `store/media.ts` — face tile + decrypted base frame object URLs (external store).
- `sync/outbox.ts` — `OutboxSyncer`: durable `outbox` table → `POST /v1/swipes` (≤100/batch, one batch per shop so a 422 `unknown_shop` cannot drop other shops' swipes, `SwipeWireEvent` = event + shopId + clientId + intentToken), `PUT /v1/wardrobe/:id`, `PUT /v1/me/signature`; exponential backoff (1 s·2ⁿ, max 10 min, 12 attempts), permanent 4xx dropped; offline it does not poll — the `online` event resumes the drain; `stop()` resolves after an in-flight flush.
- `render/body.ts` — render path B v0 geometry: parametric body from measurements, garment outline per category from `fitGapsForRender` slack (tight → cling + strain creases, loose → folds), hem from `lengthCm` × height, `fabricLook(fabric)` → filter parameters (sheen/opacity/weight/drape), fixed `adjustColor`.
- `components/` — `Avatar` (mirror: arithmetic-composite fabric filter, clipped skin texture, `useId` ids, `h-full` SVG with `preserveAspectRatio`, face tile at the head, captured base frame as the body layer when present, persistent **Estimate · not measured** badge), `Card` (own motion values, fly-off, axis-priority resolution, `dragElastic 1`), `FitPanel`, `SwipeDeck`, `Onboarding`, `TasteRadial`, `StyleDnaDialog` (native `<dialog>`), `Ledger` (shared with the merchant console), `CohortBars`, `ColourChip` (`colourMatch` from the taste engine against the capture season/undertone), `EstimateBadge`/`EstimateDisclaimer`, `NumberField`.
- `lib/season.ts` — maps capture season names (`'warm autumn'`) to taste-engine keys (`'trueAutumn'`).
- `platform/download.ts` — file export + online events (swap for a Capacitor shell).
- `features/capture/**` — built by the capture agent; imported, not rewritten. One additive change: `setDb(db)` exported from `storage.ts` so the app can share the database.

## Privacy (D3) in this package

- Nothing uploads a photo: the only outbound bodies are `DeviceCreateRequest`, `FitSignatureWire` (80 floats, `vector[78] = 1`), `SwipeBatchRequest` and `WardrobePutRequest`. `e2e/privacy.spec.ts` runs onboarding with a fake camera and asserts: only same-origin requests, `/v1/*` JSON only, no image MIME, no body > 8 KB, no measurement field names on the wire, and that the signature went out as exactly `{version, vector[80], quality}`.
- Fonts (`@fontsource-variable/fraunces|inter`) and models (`/models/*`) are same-origin; `index.css` has no Google Fonts import. The service worker caches `/models/*` CacheFirst on first use and precaches the app shell.
- `vite.config.ts` refuses to build when a `VITE_*` variable contains `KEY`/`SECRET` — in the shell **or** in the `.env*` files Vite loads itself (`config/envGuard.ts` + `loadEnv`); `eslint.config.js` forbids provider key names in source; `scripts/check-bundle-secrets.mjs` greps `dist/`.

## Tests

`src/__tests__/`: `store.test.ts` (persistence round trip through fake-indexeddb, history from wardrobe states, delete scan / delete everything), `client.test.ts` (device registration, ledger entries with at/path/bytes/fields, failure classification, compile-time `avatarRender` guard), `SwipeDeck.test.tsx` (four actions → `applySwipe` with size/score at swipe time, fit panel content in a live region, "no size fits", end of deck, no measurements), `Onboarding.test.tsx` (step order + gating, aria-pressed vibes, capture step owns Next, pending intent resume), `render.test.ts` (S/M/L read tight/fits/loose, six categories, hem from lengthCm × height, fabric looks differ). Capture's own tests still run from the same `vitest run`.

## Known limitations / next

- Path B v0 draws the garment as a parametric SVG overlay (not a warp of the flat-lay photo) over the captured base frame; the mesh warp onto the silhouette atlas is the next renderer step (D4). The base frame is placed full-height, so a frame where the person is small will not line up perfectly with the overlay.
- Hero renders: consent tier + API method exist; the UI flow (compose avatar render → `POST /v1/renders/hero` → poll → re-composite face → `renders` LRU) is not built yet.
- "Abandoned opens" in the merchant console need a try-session open count that the usage DTO does not expose yet; live mode shows "—".
- Models are not committed; run `pnpm --filter @paskamer/web models` before using the camera path.

## Accessibility notes

- Text colours are tokens checked by `src/__tests__/tokens.test.ts` (WCAG AA 4.5:1 on cream and white). Coral as **text** is `text-coral-ink` (#B8381F); plain `coral` / `coral-deep` are fills and decorative icons only. Text on a filled coral surface is `text-ink` (white on coral is 3.1:1).
- The mirror's accessible name states whose body it is (your measurements / reference body / your capture) and "not measured", matching the visible estimate badge.


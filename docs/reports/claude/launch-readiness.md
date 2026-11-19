# Launch readiness (branch `claude/launch-readiness`, 19 Nov 2026)

Goal: get the Bohohippychic pilot ready up to the founder's decisions, without deploying, buying, merging or touching
secrets. Base: `claude/garment-engine` at `8658d21` (the head of PR #1 to `main`).

## What I did

1. **Security and privacy review** of the whole branch against AGENTS.md hard rules 1–6. Three findings fixed with
   tests, one found by the real-WordPress run and fixed, three left open (below).
2. **Deploy-side check** of `infra/`, `scripts/`, `apps/api/Dockerfile`, the env example and the launch docs, and a new
   **`docs/LAUNCH-RUNBOOK.md`**: 15 numbered steps from "buy the VPS" to "the pilot shop sees the button", every step
   marked FOUNDER or MECHANICAL, a table of where each secret lives, and today's dry-run results.
3. **Dry run** of everything that can run in this container (table below).
4. **`docs/STATUS.md` rewritten** to today's state. The old page (dated 6 Nov, with branch entries up to 9 Nov, including
   the en+nl and PHP 8.2 statements) moved verbatim to `docs/STATUS-HISTORY.md` with a note on what is out of date.

I did not touch `packages/fit-engine`, `packages/schema/src/garment.ts`, the About-you form or `.github/`.

## Review: method

- Every route registered in `apps/api` (`grep app.get|post|put|delete`, 60 handlers), read for what it accepts and
  what it returns, with extra attention to the only image route (`POST /v1/renders/hero`), try/peek/fit-shown, every
  merchant route and the analytics services.
- Every outbound request from the browser surfaces (`fetch`, `sendBeacon`, `XMLHttpRequest`, `WebSocket`,
  `postMessage`) in `apps/web`, `packages/sdk`, `packages/garment-viewer`, the Shopify extension; every hard-coded
  https host in the api and the provider package; third-party analytics or font hosts (none).
- Every log call in the api (`app.log`/`req.log`/`console`) and the Fastify logger configuration; PHP logging in the plugin
  (none).
- Camera and file input only in `features/capture`; the hero render's person image (`assertNeutralPerson`, rasterised
  neutral figure, `kind: 'avatarRender'` literal with the compile-time guard); provider registry banned list; mannequin
  and spike sources for SMPL/FLAME/NC assets.

## Review: findings

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| L1 | medium | The api request serializer logged `req.url` verbatim. Try-token JWTs (`/v1/try/:token`), signed hero-render URLs (`?exp&sig`, valid up to 24 h, they show the shopper's render), Shopify `id_token`/`hmac` and the peek query sat in the docker log for about 7 days. Rule 1/D3 spirit: a log reader could open a shopper's render | `apps/api/src/lib/logUrl.ts`: the matched route pattern and query parameter **names**, values `[redacted]`; unmatched paths keep only short plain segments | `apps/api/src/launch-review.test.ts` (unit + a running app that writes to a captured stream; fails on the old serializer, checked). Confirmed again in the production image: the compose log showed `/v1/try/:token`, `/v1/renders/:jobId/:kind?exp=[redacted]&sig=[redacted]`, `/shopify/admin?shop=[redacted]&id_token=[redacted]` |
| L2 | low | `K_ANON` had `min(1)`: a production typo could hand merchants single shoppers' sizes | the api refuses `K_ANON < 5` in production (`apps/api/src/env.ts`), and `infra/scripts/write-env.sh` stops the deploy with the reason before the api would crash-loop | same file (env + a run of the real `write-env.sh`); the production image refused `K_ANON=1` |
| L3 | low | `scripts/check-bundle-secrets.mjs` (rule 2) only walked the plugin's `assets/` and never read `.php`, so a key in `curtain.php` or `includes/` would ship | the scan walks `packages/woocommerce-plugin` (tests, e2e, dist skipped) and reads `.php`/`.txt` | same file: a fake key (built by concatenation) in `includes/` fails, in `tests/`/`e2e/` is skipped |
| W1 | low | WordPress Plugin Check 2.2.0: four ERROR `EscapeOutput.ExceptionNotEscaped` in `class-garment-tape.php` (code from `claude/merchant-tape`, new since 9 Nov). An ERROR blocks WP.org review | `esc_html()` around the message (the exception is caught internally; its text is never shown) | real-WordPress e2e, PHP 8.1: Plugin Check 0 errors |

Also changed because of L1: the WordPress e2e looked for the concrete `/v1/merchant/products/<id>` URL in the api log.
It now looks for the route pattern and checks the id is **not** there; the signed GET before it still proves which
product arrived.

**Confirmed clean (no change):** no route accepts a body photo or video; the hero render is the only image route and
takes only the neutral avatar figure (no `<image>`, no data/blob refs, standard skin colour), re-encoded without metadata,
deleted after the job; no face route exists (D19 allows an opt-in one; not built, the flag is off in builds); capture
only in `apps/web/src/features/capture` with a worker; the web app has no third-party request (and the CSP forbids one);
the embed posts to the parent only `ready`, `size-selected` (product id + size), `close` and the peek's fixed height;
merchants get k-floored aggregates, ledger entries without device ids, and never a signature, measurement or photo;
fit signatures are written and exported only to their own device; webhook payloads for GDPR topics are redacted before
storage; secrets read only in `apps/api/src/env.ts`; banned VTON and body models refused by the registry; the mannequin
heads and bodies are hand-built (no SMPL/FLAME); every render and size result carries the estimate label (seen in the
screenshots).

**Open (not fixed, need a decision or later work):**

1. **Analytics differencing (medium).** `/v1/merchant/analytics/*` accept any `from`/`to`. A merchant can subtract
   `[d1, d2]` from `[d1, d3]` and see a group (e.g. the recommended sizes of one day) that is below the k floor on its
   own. The robust fix is floored, fixed, disjoint periods (ISO weeks or months), summed for a range; that hides more
   data for a small shop, so it is a product call. Low practical risk at pilot volume (one shop, the founder's own
   merchant), but it should be fixed before a second shop.
2. `docs/LICENSES.md` does not list Anny (Apache-2.0 code, CC0 assets), used by the server-drape spike. Allowed by
   rule 6 and the task's list; a documentation gap only.
3. `infra/.env.example` still defaults `MEN_3D_GATE=0`, while D20 point 3 says no men's product goes live with 2D only.
   I left the default (its comment calls it a founder switch) and put `MEN_3D_GATE=1` in the runbook as decision F6.

## Dry run: what passed

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `npm_config_workspace_concurrency=1 pnpm check` (baseline before any change, and final) | both exit 0. Final: schema 527, tryon-providers 71, demo-shop 9, anchors 53, sdk 105, taste-engine 95, fit-engine 155, mannequin 111, shopify-app 170, api 319 + 1 skipped (308 before: +11 in `launch-review.test.ts`), garment-viewer 121, woocommerce-plugin 99 (PHP), garment spike 449 + 75 + 41 Python, web 447. SDK 8,057 B gzip of 8,192; viewer chunk 165.9 KB of 400 KB; secret scan clean (now including the plugin PHP); language packs: en on all 4 surfaces |
| `docker build -f apps/api/Dockerfile .` | pass, 48 s, 97 MB content. Docker Hub answered 429 to the first attempt; the base images came from `mirror.gcr.io` (tagged locally to the pinned names), and the base got this container's proxy CA through the Dockerfile's `NODE_IMAGE` override, as in the 9 Nov rehearsal. Not committed |
| `infra/scripts/write-env.sh` with a production-shaped `curtain.env` (generated values, fake Shopify key, `SHOPIFY_DISTRIBUTION=custom`) | 64 keys written; notes `BACKUP_AGE_RECIPIENT is empty` |
| the real `infra/docker-compose.yml`, services postgres + api, `NODE_ENV=production`, in a scratch copy of `infra/` | `node dist/migrate.js` (one-off, as `deploy.sh` does): migrations applied; api `healthy`; `/healthz` 200, `/readyz` 200, `/v1/openapi.json` 200 (146 KB), `/sdk/v1.js` 200 (20 KB); `POST /v1/devices` 201; log lines `shopify app configured` `distribution: custom`, `jobs started` `order: fashn,mock`, `api listening`; URLs as patterns only. The same image refuses `K_ANON=1` and an empty `SHOPIFY_DISTRIBUTION` at start. Caddy was not started (no certificates here; the rehearsal ran it with internal TLS) |
| `infra/scripts/caddy-validate.sh curtain.fit` (Caddy 2.9, the pinned image) | Valid configuration |
| `configure prod --dry-run` (shopify-app) with `DOMAIN=curtain.fit` and a fake client id | application_url `https://api.curtain.fit/shopify/admin`, redirect `/shopify/auth/callback`, webhooks + the three compliance topics on `/shopify/webhooks`, scopes `read_products,write_products`, API 2026-10 |
| theme extension size | Liquid 8,307 B (limit 100 KB); `sdk.v1.js` 8,057 B gzip |
| `pnpm --filter @curtain/woocommerce-plugin build` + `test` | 40/40 PHP files lint, zip 113,815 B (35 files), 99 PHP tests pass |
| `pnpm --filter @curtain/woocommerce-plugin e2e:wp -- --php=8.1 --skip-build` (official `wordpress:php8.1-apache`, WordPress 7.1.4, WooCommerce 11.2.2, MariaDB 11; images via `mirror.gcr.io`) | first run 14 pass / 1 fail (the log-URL check, L1 side effect); second 37 pass / 1 fail (Plugin Check W1); after both fixes **40 checks pass**, Plugin Check 0 errors, 2 warnings (`load_plugin_textdomain` discouraged, a trademarked term in the readme). PHP 8.2 and 8.3 not re-run today |
| `pnpm demo:e2e` | 3 flows pass (WooCommerce, Shopify Dawn with peek privacy checks and returning shopper, pull-on skirt desktop + phone). The 3D sub-steps for the azure and skirt bundles are skipped: the bundles are git-ignored and not in this container |

**Not run here:** Let's Encrypt, GHCR, the GitHub workflows, ssh/rsync to a real host, `scripts/deploy-bootstrap.sh`
(it was rehearsed on 9 Nov), `shopify app deploy`/`build` (no CLI credential), anything on a real store or phone,
shellcheck (not installed).

## Measured versus assumed

- **Measured here:** every row of the dry-run table; image size; bundle sizes; the log contents of the production
  image; the refusal messages.
- **Taken from earlier runs, not re-measured:** VPS sizing (2 vCPU / 2 GB / 40 GB, from the 9 Nov rehearsal), the
  bootstrap and rollback behaviour, PHP 8.2/8.3 results, the Shopify schema validation of 9 Nov.
- **Assumed:** VPS prices ("roughly USD 12–24 a month", to be checked on the provider page), that Shopify's dashboard
  and CLI 5.0.1 behave as `docs/LAUNCH-SHOPIFY.md` describes (written 9 Nov from shopify.dev), and that the founder's
  GitHub account can create the `production` environment with required reviewers (a plan-dependent GitHub feature for
  private repositories; check before step 6 of the runbook).

## Screenshots (`docs/screens/claude/launch-readiness/`, 1.4 MB)

Phone shots are 390×844 at deviceScaleFactor 2 against `pnpm demo` (the Shopify Dawn demo storefront, product
aalter-studio-1, 168 cm / 62 kg / Regular).

| File | What it shows, honestly |
|---|---|
| `phone-1-dawn-product-button.png` | Dawn product page on a phone: size pills XS–L, Add to cart, the coral **Try it on** button directly below, and the one-line privacy note ("Your measurements stay on this device. Every render is an estimate."). Demo price in EUR; the pilot shop shows AUD |
| `phone-2-about-you.png` | The overlay, step 1 of 2: height and weight, fit preference, optional age and body type, "I know my measurements", the scan button with its on-device note, Remember me / Forget me. Clean; the footer sits at the very bottom edge of the viewport |
| `phone-3-result-estimate.png` | "We recommend M", fit score 73 %, "Confidence 30 % · estimate", compare sizes S/M/L, the avatar with the neutral face and size rings, the "Estimate · not measured" chip, a sticky **Choose size M**. The rings' labels are cut by the sticky button at this scroll position, which is expected (the e2e scrolls to them) |
| `phone-4-size-selected.png` | Back on the product page with **M** selected in Dawn's pills and the confirmation "Curtain selected size M for you. Add it to your bag when you are ready." |
| `phone-5-privacy-draft.png` | `app.<domain>/privacy` as a shopper reaches it: the draft banner "DRAFT for legal review. Not in force." and the `[DATE OF PUBLICATION]` placeholder. This is the reason legal review is decision F7 |
| `woo-php81-storefront-size-advice.png` | Desktop, real WordPress on PHP 8.1 with Storefront: the overlay recommends 12 (AU chart), per-point fit table, estimate label. From the e2e run, not a phone |

## Open issues

- Founder decisions F1–F8 in `docs/LAUNCH-RUNBOOK.md` §0 (custom app, Sydney VPS and purchase, merge PR #1, approve
  the first deploy, PHP 8.1, `MEN_3D_GATE=1`, legal review, pilot price arrangement).
- The three open review items above (analytics periods, LICENSES.md Anny entry, MEN_3D_GATE default).
- The rehearsal's 46 edge checks were never committed (noted on 9 Nov); runbook step 9 lists a short manual smoke set
  instead. A committed go-live smoke script would be better.
- Docker Hub rate limits hit again here; the runbook recommends `docker login` on the server.

## Reproduce

```sh
git checkout claude/launch-readiness
pnpm install --frozen-lockfile
npm_config_workspace_concurrency=1 pnpm check
pnpm --filter @curtain/api exec vitest run src/launch-review.test.ts

# api image (on a host without a proxy CA: drop --build-arg NODE_IMAGE)
docker build -f apps/api/Dockerfile -t curtain-api:dryrun .

# production-shaped compose run in a scratch copy of infra/
cp -r infra /tmp/dry && cd /tmp/dry
printf 'POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nSHOP_KEY_PEPPER=%s\nENCRYPTION_KEY=%s\nACME_EMAIL=ops@curtain.test\nSHOPIFY_DISTRIBUTION=custom\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > curtain.env
bash scripts/write-env.sh --domain curtain.test --image curtain-api:dryrun --secrets "$PWD/curtain.env"
docker compose -p curtaindry up -d postgres
docker compose -p curtaindry run --rm --no-deps -T api node dist/migrate.js
docker compose -p curtaindry up -d --no-deps api
docker compose -p curtaindry logs api | grep -E 'api listening|"url"'
docker compose -p curtaindry down -v
cd - && bash infra/scripts/caddy-validate.sh curtain.fit

SHOPIFY_API_KEY=0123456789abcdef0123456789abcdef DOMAIN=curtain.fit node packages/shopify-app/scripts/configure.mjs prod --dry-run
pnpm --filter @curtain/woocommerce-plugin build && pnpm --filter @curtain/woocommerce-plugin test
pnpm --filter @curtain/woocommerce-plugin e2e:wp -- --php=8.1 --skip-build
pnpm demo:e2e
```

The phone screenshots came from a small Playwright script around `startDemo` from `scripts/demo.mjs` (390×844, DSF 2);
it is not committed.

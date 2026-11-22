# Launch runbook: from "buy the VPS" to "the pilot shop sees the button"

Written 19 Nov 2026 on branch `claude/launch-readiness`, against the files as they are on that branch.
Pilot: the Shopify shop **Bohohippychic** (Australia, AUD, AU sizes 8–16), one plan at **USD 8.99 per month**
(D17). This page puts the existing guides in order and marks who does each step. The detail stays where it is:
`docs/DEPLOY.md` (server, GitHub, backups), `docs/LAUNCH-SHOPIFY.md` (Shopify dashboard, dev-store script),
`docs/GOLIVE-REHEARSAL.md` (what the rehearsal proved), `docs/LAUNCH-WOO.md` (WooCommerce, not on the pilot path).

**Who does what**

- **FOUNDER**: a decision, a purchase, a dashboard click under the founder's account, or typing a secret.
  Secrets go into GitHub (Settings → Environments → `production` → secrets) or into `/etc/curtain/curtain.env`
  on the server, typed by the founder. **Never paste a secret into a chat, an issue, a commit or a PR**.
- **MECHANICAL**: a command or a check with a known expected result. The founder can run it, or hand the
  terminal output (never the secrets file) to an assistant to read.

Nothing on this page has been run against the real VPS, GitHub's runners or a real Shopify store yet. What was
dry-run on 19 Nov 2026 is listed at the end ("Dry run"). Steps marked ⚠ cannot be undone.

---

## 0. Decisions first (FOUNDER)

| # | Decision | Advice | Why it matters / what it changes |
|---|---|---|---|
| F1 | Shopify app: **custom** or **public** distribution ⚠ | **Custom** for the pilot | Shopify fixes the method once chosen. Custom = install link for one store, no Shopify review, but **no Shopify billing**: the USD 8.99 is invoiced outside Shopify (or waived for the pilot); the api grants the plan on install (`SHOPIFY_DISTRIBUTION=custom`). The App Store app is a second app later (`docs/LAUNCH-SHOPIFY.md` A1, A2, F). |
| F2 | VPS provider and region | **Sydney** (Vultr, DigitalOcean, Linode/Akamai or AWS Lightsail; Hetzner has no AU region), **2 vCPU, 2 GB RAM, 40 GB SSD, Ubuntu 24.04, IPv4** | Measured in the rehearsal: under 0.8 GB with cache, disk under 5 GB. Sydney keeps the api near Australian shoppers. Roughly USD 12–24 a month at those providers (check the provider's own price page on the day). |
| F3 | Merge PR #1 (`claude/garment-engine` → `main`) | Merge once this branch and the other open branches are in it and its CI is green | The deploy workflow runs only from `main` or `release`; the `shopify-deploy` **Run workflow** button only appears once that file is on the default branch. |
| F4 | Approve the first deploy | Approve after steps 1–7 are done | The `production` environment's required reviewer is the gate in front of the deploy key. |
| F5 | WooCommerce minimum PHP 8.1 | Accept 8.1 (8.0 is end of life since Nov 2023; the plugin passed the real-WordPress e2e on 8.1, 8.2, 8.3) | Not on the Shopify pilot path. Only matters when the Woo plugin is published. |
| F6 | `MEN_3D_GATE` | Set `MEN_3D_GATE=1` in `/etc/curtain/curtain.env` | D20 point 3 says no men's product goes live with a 2D figure only; the default in `infra/.env.example` is still `0`. Bohohippychic sells women's clothing, so `1` costs the pilot nothing and keeps D20 true for any later shop. |
| F7 | Legal text before real shoppers | Naomi reviews `docs/legal/privacy.md`, `terms.md` and the consent copy (D20 point 4) | The privacy page in the app (`app.<domain>/privacy`, terms at `/terms`) is the **draft** ("Not in force"). The face photo stays off in production builds (`VITE_AVATAR_FACE_PHOTO` unset) and hero renders stay hidden (the api does not send `heroRenders`), so neither needs a decision for the pilot. |
| F8 | Pilot price arrangement | Write down with the merchant: free pilot, or USD 8.99 per month invoiced outside Shopify | A custom app cannot charge through Shopify. Your lever to stop the plan later is in `docs/LAUNCH-SHOPIFY.md` A1. |

The marketing site on `curtain.fit` stays a 404 until its own launch gates close (`docs/SITE.md`); that does not
block the pilot. The deploy skips it with a warning.

---

### 0b. Disconnect Qwen (FOUNDER and CLAUDE, before the first production deploy; D29)

- [ ] Claude: confirm no open `qwen/*` branch is waiting to be merged, and record the last merged Qwen commit in `docs/OPEN-ISSUES.md`.
- [ ] Founder: remove the Model Studio key from the cloud environment (environment menu, Edit, Network secrets) and delete the key in Alibaba Cloud Model Studio.
- [ ] Founder: cancel the Model Studio plan.
- [ ] Claude: remove Qwen from `docs/COORDINATION.md`, from the environment's setup script (if it was added there) and from the Linear labels (retire `Qwen`).

## 1. Buy the VPS (FOUNDER)

1. Create the server per F2: Ubuntu 24.04 LTS, the provider's **Sydney** region, 2 vCPU / 2 GB / 40 GB, IPv4.
   Add your own ssh key for `root` at creation (the provider's form). Skip the provider's backups and firewall
   add-ons: the bootstrap sets up ufw and encrypted nightly dumps.
2. Write down the **IPv4 address**. Leave IPv6 off in DNS for now (`docs/DEPLOY.md` §2).
3. Check: `ssh root@<server-ip> 'lsb_release -ds; nproc; free -m | head -2; df -h /'` shows Ubuntu 24.04, 2 CPUs,
   about 2 GB, about 40 GB.

## 2. DNS at Hostinger (FOUNDER)

hPanel → Domains → curtain.fit → DNS records. Note what is there first, then remove the default `A`/`CNAME`
for `@` and `www` (parking page). **Leave every mail record alone** (`MX`, SPF `TXT`, DKIM, DMARC, `mail`, `webmail`).

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | server IPv4 | 300 |
| A | `www` | server IPv4 | 300 |
| A | `app` | server IPv4 | 300 |
| A | `api` | server IPv4 | 300 |

MECHANICAL check (wait a few minutes): `dig +short curtain.fit www.curtain.fit app.curtain.fit api.curtain.fit`
prints the IPv4 four times. A CAA record, if one exists, must allow `letsencrypt.org`.

## 3. Deploy key (MECHANICAL, on the founder's laptop)

```sh
ssh-keygen -t ed25519 -N '' -C curtain-deploy -f ~/.ssh/curtain_deploy
```

`~/.ssh/curtain_deploy.pub` goes to the server in step 4; the private file goes into GitHub in step 6.

## 4. Bootstrap the server (MECHANICAL, run by the founder as root)

From a checkout of `main` (or of this branch before the merge):

```sh
ssh root@<server-ip> 'bash -s' -- --pubkey "$(cat ~/.ssh/curtain_deploy.pub)" < scripts/deploy-bootstrap.sh
```

Expected: Docker Engine and compose installed, ufw on (22, 80, 443/tcp, 443/udp), unattended upgrades, user
`deploy`, `/opt/curtain`, `/var/backups/curtain`, the 03:17 backup cron, and
`/etc/curtain/curtain.env` created with generated `POSTGRES_PASSWORD`, `JWT_SECRET`, `SHOP_KEY_PEPPER`,
`ENCRYPTION_KEY` and `SHOPIFY_DISTRIBUTION=custom`. The script prints the server's ed25519 host key fingerprint:
keep it for step 6.

Then:

```sh
ssh -i ~/.ssh/curtain_deploy deploy@<server-ip> 'docker ps'      # must work (empty list)
ssh root@<server-ip> 'bash -s' -- --harden-ssh < scripts/deploy-bootstrap.sh   # password logins off
ssh root@<server-ip> timedatectl | grep 'Time zone'             # UTC expected (backup cron time)
```

Recommended (lifts Docker Hub's anonymous pull limit, which hit twice in the rehearsal and once in this dry run):
`ssh root@<server-ip> sudo -u deploy docker login` with a free Docker Hub account (FOUNDER types the password).

## 5. Fill in the server secrets (FOUNDER, on the server only)

```sh
ssh root@<server-ip>
nano /etc/curtain/curtain.env
```

| Key | Value | Needed for |
|---|---|---|
| `ACME_EMAIL` | an address you read (Let's Encrypt expiry mail). Not `@example.com`: the deploy refuses it | first deploy |
| `BACKUP_AGE_RECIPIENT` | on your laptop `age-keygen -o curtain-backup.key`; paste the `age1…` **public** line. The private key goes to your password manager and one offline copy, **never** on the server | backups |
| `MEN_3D_GATE` | `1` (decision F6) | D20 |
| `BACKUP_RCLONE_REMOTE` | optional offsite copy, e.g. `b2:curtain-backups` (`sudo -u deploy rclone config`) | offsite backups |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | leave empty now; step 10 | Shopify |

Leave the generated secrets as they are. Do not edit `/opt/curtain/infra/.env`: every deploy rebuilds it from
`infra/.env.example` + this file. `K_ANON` may be raised but not set below 5 (the deploy and the api refuse it).

## 6. GitHub settings (FOUNDER)

Exactly as `docs/DEPLOY.md` §5. Check first: required reviewers on an environment of a **private** repository need a
paid GitHub plan (Pro, Team or Enterprise). Without it the deploy key has no approval gate; upgrade before adding it.


1. Settings → Environments → **New environment** `production`: **Required reviewers** = you;
   **Deployment branches and tags** = selected: `main` and `release`; administrators may **not** bypass.
2. `production` → **Environment secrets**: `VPS_HOST` (IPv4), `VPS_USER` (`deploy`), `VPS_SSH_KEY` (the whole
   `~/.ssh/curtain_deploy` file), `VPS_SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <server-ip>`; compare its
   fingerprint, `ssh-keygen -lf <(ssh-keyscan -t ed25519 <server-ip>)`, with the one from step 4).
3. Settings → Secrets and variables → Actions → **Variables**: `DOMAIN` = `curtain.fit`.
4. If any `VPS_*` exist as **repository** secrets, delete them.

## 7. Merge PR #1 into `main` (FOUNDER, decision F3)

PR #1 "Curtain v1: plugin, API, web, site and deploy pipeline to main for go-live" (`claude/garment-engine` →
`main`). Before merging: the integration branch holds this branch and the other parallel branches, `ci.yml` is green,
and the PR's own check passes. After the merge `ci.yml` runs on `main` (MECHANICAL: wait for green).

MECHANICAL, before the merge, on a checkout of the branch that is about to be merged (about five minutes; needs
Chromium for Playwright and the ports 3000, 4173, 5180 and 8787 free):

```sh
pnpm install --frozen-lockfile
pnpm check            # build, types, lint, unit tests, app builds, secret scan
pnpm check:launch     # the checks that need a browser and a running stack
```

`pnpm check:launch` must end with `check:launch: all 5 steps passed`. Its steps: the MediaPipe models are fetched
when missing; the privacy e2e runs with the **real** models on the production build under the production security
headers (it fails without the models, it does not skip); the post-deploy check of step 9 runs against the local
demo stack with its negative controls; the demo shop flows run with the embed under the production policy; every
page of the marketing site is opened under the policy Caddy sends for it. `ci.yml` does not run this yet: the job
to add is written out under "CI job for `pnpm check:launch`" at the end of this page.

## 8. First deploy (FOUNDER approves, the workflow does the rest)

Actions → **deploy** → Run workflow → branch `main` → action `deploy` → **Approve** when GitHub asks.

Expected run (`docs/DEPLOY.md` "Run a deploy"): guard → check → web → site (**skipped with a warning**: launch gates
open) → image (pushes `ghcr.io/<owner>/curtain-api:git-<sha12>`) → deploy: write-env, pull, migrations in a one-off
container, api up, web published, `/readyz` and `https://api.curtain.fit/healthz` answer, the external check from
GitHub passes. The first deploy takes about a minute longer (certificates). A failure rolls back by itself; there is
nothing to roll back to on the first one, so read the job log.

## 9. Post-deploy check (MECHANICAL, after this deploy and after every later one)

One command, from the laptop, in a checkout of the commit that was deployed (Node 22; it makes plain web requests
only, no ssh and no secret):

```sh
node scripts/post-deploy-check.mjs https://curtain.fit --commit "$(git rev-parse HEAD)"
```

It prints one line per check and ends with a `RESULT:` line. Right after the first deploy, with no shop installed
yet, this is what a working stack prints (exit code 0):

```
 1  PASS         The api is up: version 0.1.0, commit <sha12>
 2  PASS         The api reaches its database and its job queue: database yes, jobs yes
 3  PASS         The "Try it on" script for shop pages is served: 20 KB, loadable from any shop page
 4  PASS         The merchant routes refuse a caller without a key: 401 without a key (read and write), 401 with a made-up key
 5  PASS         The app is served with its security headers: policy on, never framed, cross-origin isolated, HTTPS enforced
 6  PASS         The app’s code loads as a browser loads it: 23 files, 2232 KB, each served as what it is; the build calls https://api.curtain.fit
 7  PASS         The api and the app are the same release: both are commit <sha12>, the one you expected
 8  PASS         A shopper’s phone can register: an anonymous test shopper was created, and the app’s origin may ask for one
 9  NOT CHECKED  "Try it on" opens a session for the product: no shop given: run again with --shop … --product …
10  PASS         The embed page loads with its security headers: policy on, framable by https shop pages only, not cached, not indexed (on a made-up link: no shop given)
11  NOT CHECKED  The product arrives with its size chart: no shop given: …
12  NOT CHECKED  A shown size is accepted and not billed: no shop given: …
13  PASS         A made-up try link is refused: answered 401
14  PASS         The test shopper is deleted again: deleted, and its token no longer works

RESULT: what was checked works (11 passed), but 3 checks were NOT run: the try session needs --shop and --product. Whether a shopper can try a product on is not known from this run.
```

**Exit code 0 here does not mean a shopper can try a product on.** The three NOT CHECKED lines are the try path
itself, and a wrong `PUBLIC_APP_URL` on the server (every try link pointing at a dead address) is only seen by
line 9. A person reading the lines is told; a script or a workflow step that only reads the exit code is not. So
this form of the command is for the first deploy only, while no shop exists. From step 12 on, always give the
development store and `--require-shop`, which turns a run without a shop into FAIL and exit 1.

What the lines stand on, since the half of the product that runs in the shopper's browser cannot be seen from
`/healthz`:

- Line 6 fetches every script and stylesheet the build names (the page's own, then whatever each script names:
  lazy chunks, workers) and requires each to come back as JavaScript or CSS under the policy. A file missing from
  the published build comes back as the app page (`try_files {path} /index.html`), with status 200; that fails
  here. It also requires the api's address to be in the build: a web build made with a wrong `VITE_API_URL` fails.
- Lines 5, 6 and 10 fail on a policy that is too loose and on one that is too tight for the app to run (the api
  missing from `connect-src` or `img-src`, no `'wasm-unsafe-eval'`).
- Lines 8, 11, 12 and 13 also ask the api what a browser asks before the app may call it from `app.curtain.fit`
  (the CORS preflight). An api whose `PUBLIC_APP_URL` or `CORS_ORIGINS` does not name the app fails there.
- Line 10 reads the embed's headers on a made-up link when no shop is given, so framing and caching are checked
  from the first deploy.
- It does not run the app: no page is rendered. `pnpm check:launch` (step 7) does that, on the same build,
  before the deploy.

Any `FAIL` line says what was asked and what came back; the command then exits 1 and the result line reads
`RESULT: NOT WORKING`. Line 7 is the one that catches a deploy that swapped the api but not the web app (or an
older release still being served): the api reports its commit on `/healthz`, the web build on `/version.json`.
Lines 9, 11 and 12 are run in step 12, once the development store exists.

Two things the command does not look at, still by hand:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://curtain.fit/                                 # 404 until the site gates close
echo | openssl s_client -connect api.curtain.fit:443 -servername api.curtain.fit 2>/dev/null | openssl x509 -noout -issuer   # Let's Encrypt
```

On the server (`ssh deploy@<server-ip>`, `cd /opt/curtain/infra`):

```sh
docker compose -p curtain ps                                  # caddy, api (healthy), postgres (healthy)
docker compose -p curtain logs api | grep -E 'api listening|jobs started'
docker compose -p curtain logs api | grep -c 'id_token=ey'     # 0: URLs are logged as route patterns only
sudo -u deploy /opt/curtain/infra/scripts/backup.sh nightly    # one encrypted dump in /var/backups/curtain
```

Then once, on the laptop that holds `curtain-backup.key`: the restore drill (`docs/DEPLOY.md` "Restore drill"),
and write the date and result in `docs/STATUS.md`.

## 10. Create the Shopify app (FOUNDER)

`docs/LAUNCH-SHOPIFY.md` part B, steps 1–8, in the Dev Dashboard under the **Partner organisation**:

1. Create the app manually (do not run `shopify app init`). Handle `curtain`.
2. **Client ID** → GitHub secret `SHOPIFY_API_KEY` **and** `SHOPIFY_API_KEY` in `/etc/curtain/curtain.env`.
3. **Client secret** → **only** `SHOPIFY_API_SECRET` in `/etc/curtain/curtain.env`. Never GitHub, never chat.
4. Service account with *App development* → GitHub secret `SHOPIFY_SERVICE_ACCOUNT_TOKEN`
   (or the older `SHOPIFY_CLI_PARTNERS_TOKEN`). Recommended: move both Shopify GitHub secrets into a `shopify`
   environment with you as required reviewer (`docs/DEPLOY.md` "Harden").
5. Emergency developer contact e-mail (Partner Dashboard → Settings).
6. A development store with a few dresses in S/M/L or AU 8–14.
7. **Do not choose the distribution yet** (step 13).

Then run the **deploy** workflow again on `main` (approve it): it rebuilds `infra/.env` with the Shopify keys and
restarts the api. MECHANICAL check on the server: `docker compose -p curtain logs api | grep 'shopify app configured'`
shows `"distribution":"custom"`.

## 11. Deploy the Shopify app config and theme block (FOUNDER starts, MECHANICAL to read)

1. Actions → **shopify-deploy** → Run workflow on `main`, *release* **unticked**. Expected: green, a version
   `git-…` listed in the Dev Dashboard as not released. This is the first run on Shopify CLI 5.0.1 with a service
   account (row D0 of `docs/LAUNCH-SHOPIFY.md`). If the CLI itself fails, use `SHOPIFY_CLI_PARTNERS_TOKEN` (CLI 4.9.5).
2. Run it again with *release* **ticked**. Expected summary: application_url `https://api.curtain.fit/shopify/admin`,
   webhooks `https://api.curtain.fit/shopify/webhooks`.

## 12. Dev store test (FOUNDER clicks, MECHANICAL checks; about 60 minutes)

`docs/LAUNCH-SHOPIFY.md` part D, rows D1–D14 (D15 is a 48-hour wait, optional). Keep
`docker compose -p curtain logs -f api` open. Every row must pass before step 13. Write the results into that table.
After row D4 (a product has a size chart), run the post-deploy check with the development store, so its lines 9, 11
and 12 run too: open a product page of the dev store, view the page source, search for `pk_` (the shop's publishable
key, in the small script of the "Try it on" block) and for `data-curtain-product="…"` (the product id). Both are
public: they are in every shopper's browser.

```sh
node scripts/post-deploy-check.mjs https://curtain.fit --shop <pk_…> --product <product id> --require-shop --commit "$(git rev-parse HEAD)"
```

Expected: `RESULT: the deployed stack works. All 14 checks passed.` Use the development store for this, not
Bohohippychic: the check opens one try session in the shop (surface `api`, never billed; line 12 fails if it
were) and deletes its test shopper again, but the session row stays in the shop's records.

Key ones: D1 (install lands in the app, plan `curtain`/`ARRANGED`), D4 (assigning the AU chart makes products
**Try-able**), D7–D8 (button on a Dawn product page, "We recommend …" labelled an estimate, size selected in the
product form, add to cart works, on an iPhone and an Android phone), D12 (compliance webhooks 200, bad secret 401),
D13–D14 (uninstall and reinstall).

## 13. Custom distribution and the install link (FOUNDER) ⚠

`docs/LAUNCH-SHOPIFY.md` part E:

1. Get Bohohippychic's **`<handle>.myshopify.com`** domain from the merchant (not `bohohippychic.com.au`).
2. Dev Dashboard → the app → Distribution → **Custom distribution** → confirm (irreversible, decision F1).
3. Manage custom install link → the myshopify domain → untick multi-store unless they run several → Generate link.
4. E-mail the link to the store owner with the short note in part E step 4.

## 14. Pilot setup with the merchant (FOUNDER, on a call, about 10 minutes)

1. MECHANICAL check once they installed: on the server
   `docker compose -p curtain exec postgres psql -U curtain -d curtain -c "SELECT domain, plan, paused, settings->>'subscriptionStatus' FROM shops;"`
   shows their domain, `curtain`, `false`, `ARRANGED`.
2. In their Shopify admin → Apps → Curtain: keep the AU template, untick sizes they do not sell, assign it to
   Dresses (and Tops, Skirts), **Preview**, then **Assign**.
3. "Add the block" → the theme editor opens on the product template → place **Try it on** under the size picker → Save.
4. **Done when:** a real Bohohippychic product page, on a phone, shows the **Try it on** button, the overlay gives a
   size labelled an estimate, and choosing it selects that variant. Check one dress and one skirt
   (part E step 6).

## 15. First week (MECHANICAL, daily)

- `SELECT topic, status, count(*) FROM webhook_log WHERE received_at > now() - interval '1 day' GROUP BY 1,2;`
  no row stuck in `failed` or `received`.
- `docker compose -p curtain ps` all healthy; `/var/log/curtain/backup.log` shows a nightly dump.
- After every deploy: the post-deploy check **with the development store**, as in step 12
  (`node scripts/post-deploy-check.mjs https://curtain.fit --shop <pk_…> --product <product id> --require-shop --commit …`).
  Without the shop the command exits 0 with the try path unchecked (step 9); `--require-shop` makes that a FAIL.
- The emergency-contact inbox (Shopify webhook warnings).
- Levers: pause the button (`UPDATE shops SET paused = true WHERE domain = '<handle>.myshopify.com';`), roll back a
  release (Actions → deploy → `rollback`), or the merchant removes the block.

---

## CI job for `pnpm check:launch` (not in `.github/` yet)

`pnpm check:launch` is a command a person runs (step 7). To have GitHub run it on every pull request, add this
job to `.github/workflows/ci.yml`, after the `check` job (same indentation as `check:` and `api-image:`). It has
not been run on a GitHub runner; the commands in it were run on 20 Nov 2026 in a cloud container (see "Dry run").

```yaml
  launch:
    name: browser checks (privacy e2e with the real models · post-deploy check · security policies)
    runs-on: ubuntu-latest
    needs: check
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: build packages (apps import their dist)
        run: pnpm -r --filter './packages/**' build
      - name: MediaPipe models (about 50 MB, not in git; check:launch fetches what the cache does not hold)
        uses: actions/cache@v4
        with:
          path: apps/web/public/models
          key: mediapipe-models-${{ hashFiles('apps/web/src/features/capture/scripts/fetch-models.mjs', 'pnpm-lock.yaml') }}
      - name: Chromium for Playwright
        run: pnpm --filter @curtain/web exec playwright install --with-deps chromium
      - run: pnpm check:launch
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: launch-check-results
          path: |
            apps/web/test-results
            test-results
          if-no-files-found: ignore
```

And to have every deploy run the post-deploy check of step 9 by itself, add this step to the `deploy` job of
`.github/workflows/deploy.yml`, directly after the step `health check from outside`, and change the `if:` of the
step `roll back (external health check failed)` to
`failure() && (steps.health.outcome == 'failure' || steps.postdeploy.outcome == 'failure')`. `POST_DEPLOY_SHOP` and
`POST_DEPLOY_PRODUCT` are repository variables (the development store's publishable key and a product id, both
public). Before step 12 they do not exist yet, and the step then leaves lines 9, 11 and 12 unchecked and still
passes: for that time only. **As part of step 12, set both and set `POST_DEPLOY_REQUIRE_SHOP` to `1`**: from then
on a deploy whose try path was not checked (a variable deleted or emptied) fails and is rolled back, as one whose
try path is broken is.

```yaml
      - name: post-deploy check (line by line; a FAIL rolls the release back)
        id: postdeploy
        env:
          SHOP: ${{ vars.POST_DEPLOY_SHOP }}
          PRODUCT: ${{ vars.POST_DEPLOY_PRODUCT }}
          REQUIRE_SHOP: ${{ vars.POST_DEPLOY_REQUIRE_SHOP }}
        run: |
          args=("https://$DOMAIN" --commit "$GITHUB_SHA")
          if [ -n "$SHOP" ] && [ -n "$PRODUCT" ]; then args+=(--shop "$SHOP" --product "$PRODUCT"); fi
          if [ "$REQUIRE_SHOP" = "1" ]; then args+=(--require-shop); fi
          set -o pipefail   # the step fails when the check fails, not when tee does
          node scripts/post-deploy-check.mjs "${args[@]}" | tee -a "$GITHUB_STEP_SUMMARY"
```

---

## Where every secret lives

| Secret | Lives in | Entered by |
|---|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SHOP_KEY_PEPPER`, `ENCRYPTION_KEY` | `/etc/curtain/curtain.env` (generated by the bootstrap) | the bootstrap; nobody types them |
| `SHOPIFY_API_SECRET` | `/etc/curtain/curtain.env` only | FOUNDER |
| `SHOPIFY_API_KEY` (client id, not secret) | `/etc/curtain/curtain.env` and GitHub secret | FOUNDER |
| `SHOPIFY_SERVICE_ACCOUNT_TOKEN` | GitHub secret (ideally the `shopify` environment) | FOUNDER |
| `VPS_SSH_KEY`, `VPS_SSH_KNOWN_HOSTS`, `VPS_HOST`, `VPS_USER` | GitHub `production` environment secrets | FOUNDER |
| backup private key `curtain-backup.key` | password manager + one offline copy; never the server, never GitHub | FOUNDER |
| `FASHN_API_KEY`, `XAI_API_KEY`, `STRIPE_*` | not needed for the pilot (no hero renders, no WooCommerce billing); `/etc/curtain/curtain.env` when they are | FOUNDER, later |

---

## Dry run on 19 Nov 2026 (this branch, in a cloud container; no VPS, no GitHub runner, no Shopify store)

| What | Result |
|---|---|
| `npm_config_workspace_concurrency=1 pnpm check` (every package build, typecheck, lint, test, app builds, secret scan, language packs) | pass; final numbers in `docs/reports/claude/launch-readiness.md` |
| `docker build -f apps/api/Dockerfile .` | pass (48 s, 97 MB content). Docker Hub answered 429 for the base image, so the images came from `mirror.gcr.io` and the base got this container's proxy CA through the documented `NODE_IMAGE` override, as in the rehearsal |
| `infra/scripts/write-env.sh` with a production-shaped `curtain.env` (fake values) | pass: 64 keys; refuses `K_ANON` below 5 |
| real `infra/docker-compose.yml`: postgres 16 + the api image, `NODE_ENV=production` | migrations applied; api healthy; `/healthz`, `/readyz`, `/v1/openapi.json`, `/sdk/v1.js` 200; `POST /v1/devices` 201; log shows `shopify app configured` with `distribution: custom` and URLs as route patterns only; the container refuses `K_ANON=1` and an empty `SHOPIFY_DISTRIBUTION` |
| `infra/scripts/caddy-validate.sh curtain.fit` (Caddy 2.9) | Valid configuration |
| `configure prod --dry-run` for `curtain.fit` | renders the app config: application_url, redirect, webhooks, compliance topics, scopes `read_products,write_products` |
| theme extension | Liquid 8.3 KB (limit 100 KB), `sdk.v1.js` 8,057 B gzip (budget 8,192) |
| WooCommerce build + PHP tests | zip built (113,804 B, 35 files); 99 PHP tests pass |
| WooCommerce on real WordPress 7.1.4 + WooCommerce 11.2.2, PHP 8.1 (`e2e:wp -- --php=8.1`) | 40 checks pass after two fixes on this branch (an e2e check that read concrete URLs from the api log; four Plugin Check errors in `class-garment-tape.php`). Plugin Check: 0 errors, 2 warnings. PHP 8.2 and 8.3 not re-run today (passed on 9 Nov) |
| `pnpm demo:e2e` | 3 flows pass (WooCommerce demo, Shopify Dawn incl. peek and returning shopper, pull-on skirt on desktop and phone). The 3D sub-steps for the founder's azure and skirt bundles are skipped: the bundles are git-ignored and not in this container |

Not run here: Let's Encrypt, GHCR, the GitHub workflows, ssh/rsync to a real server, `shopify app deploy` or
`shopify app build` (no Shopify CLI credential), anything on a real store.

## Dry run on 20 Nov 2026 (branch `claude/pre-launch`, in a cloud container; no VPS, no GitHub runner, no Shopify store)

| What | Result |
|---|---|
| `docker build -f apps/api/Dockerfile .` on the branch as it was | **failed**: `@curtain/garment-viewer`'s bake check imports `@curtain/fit-engine`, which the Dockerfile copied but did not build. The `api-image` job of `ci.yml` would have failed the same way |
| the same after the fix | pass: 447 MB image; it holds `dist/scripts/import-asset.js` and `@curtain/garment-viewer/dist/bakeGate.js`; the bake check run inside the image on the fixture `packages/garment-viewer/fixtures/pom-v2-rest` passes all nine checks. Base image through the documented `NODE_IMAGE` override (this container's proxy CA) |
| real `infra/docker-compose.yml` and `infra/Caddyfile` in a scratch copy: postgres + the image + Caddy 2.9, `DOMAIN=curtain.localhost` (Caddy's local CA), the web build published into the `web` volume | migrations applied, api healthy, no error line in the api log |
| `node scripts/post-deploy-check.mjs https://curtain.localhost --shop … --product … --commit …` against that stack | first run: 13 pass, **line 3 failed**: `/sdk/v1.js` carried `Cross-Origin-Resource-Policy` twice (Caddy and the api both set it; HSTS too). Fixed in the Caddyfile (`>` in the api block); second run: all 14 pass |
| the embed in Chromium against that stack, from a page on another https origin | the app is cross-origin isolated; "Try it on" → About you → "We recommend L", labelled an estimate → "Choose size L" selects L on the shop page; requests went to the shop page, the api and the app only. One console error: the service worker's script fetch was refused because the browser does not trust Caddy's local CA (OI-132) |
| `pnpm check:launch` | `check:launch: all 5 steps passed` (about 3 minutes with the models already fetched): privacy e2e with the real models on the production build under the production headers (3 specs), the post-deploy check on the demo stack (29 tests, 21 of them negative controls), the demo shop under the policy (3 flows and no reported violation), the site under its policy (31 checks). An earlier run failed once in the body scan (OI-131) |
| `apps/web` e2e suite under the production headers | pass, except `aiRealism.spec.ts` "flag on", which fails the same way under the old headers (OI-129); the ten-picture 3D bake spec was not run to the end (an hour on a software GPU) |

Not run here: the real VPS, Let's Encrypt, the GitHub workflows (the `launch` job and the post-deploy step above
have never run on a runner), a real Shopify store, a real phone.

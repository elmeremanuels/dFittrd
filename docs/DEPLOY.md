# Deploy: one VPS, one click

How Curtain gets from a commit to `https://app.<domain>`, `https://api.<domain>` and the marketing site
on `https://<domain>` (decision D9). One GitHub Actions workflow (`.github/workflows/deploy.yml`) builds
the api image, the static web app and the static site, ships them to the founder's VPS over ssh,
migrates, swaps, checks health and rolls back by itself when the new release is unhealthy. The site is
published only when its release build passes its launch gates; otherwise the deploy skips it with a
warning and app and api still go out (the site never blocks the plugin).

```
GitHub Actions                                     VPS (/opt/curtain, user deploy)
guard ─┬─ check (typecheck · lint · test)
       ├─ web   (vite build, bundle secret scan) ──► web/releases/git-<sha12>/
       ├─ site  (build:release; skipped with a warning while launch gates are open) ──► site/releases/git-<sha12>/
       └─ image (docker build → GHCR) ─────────────► docker pull (one-time registry login)
deploy: scripts/deploy.sh ──ssh──► infra/scripts/deploy.sh
          write-env.sh: infra/.env = .env.example + /etc/curtain/curtain.env + DOMAIN/API_IMAGE
          pre-deploy backup → migrate (one-off container) → swap api → publish web into the caddy volume
          → publish the site into the site volume (a failure only warns)
          /readyz in the container + https://api.<domain>/healthz → keep, or put the previous release back
        external health check from GitHub → on failure: scripts/deploy.sh rollback
```

Secrets never leave the server and never enter the repository: GitHub holds only the ssh key, the
pinned host key and the address. Everything the api needs (database password, JWT secret, Shopify
client secret, …) lives in `/etc/curtain/curtain.env` on the VPS.

## Set once

### 1. A server

A VPS with **2 vCPU, 2 GB RAM and 40 GB SSD** runs the whole stack (Caddy, the api, Postgres) with room to
spare; 4 GB RAM is fine too if it costs little more. Measured in the go-live rehearsal (`docs/GOLIVE-REHEARSAL.md`, §4):
the stack peaks under 0.8 GB with page cache, and even 1 vCPU / 1 GB served 1,400 req/s; disk use is under 5 GB. Use
Ubuntu 24.04 (rehearsed end to end) or Debian 12. For the Australian pilot shop a Sydney region keeps the api close to its
shoppers (Hetzner has no AU region; Vultr, DigitalOcean, Linode and AWS Lightsail do). The api never
runs models, so no GPU.

### 2. DNS records

Point four names at the server, at your DNS provider. For `curtain.fit` that is Hostinger, which stays
DNS only (no Hostinger hosting): hPanel → Domains → curtain.fit → DNS / Nameservers → DNS records.

| Type | Name (Hostinger) | Full name | Value | TTL |
|---|---|---|---|---|
| A | `@` | `<domain>` (the site) | the server's IPv4 | 300 |
| A | `www` | `www.<domain>` (redirects to `<domain>`) | the server's IPv4 | 300 |
| A | `app` | `app.<domain>` | the server's IPv4 | 300 |
| A | `api` | `api.<domain>` | the server's IPv4 | 300 |
| AAAA | `@`, `www`, `app`, `api` | | the server's IPv6: leave these out at first (see below) | 300 |

IPv6 has not been tested. When AAAA records exist, Let's Encrypt validates over IPv6, so a server that does not answer
on IPv6 gets no certificates. Add them later, once `curl -6 https://api.<domain>/healthz` works from an IPv6 network.

Remove the `A`/`CNAME` records for `@` and `www` that Hostinger adds by default (parking page or
Hostinger hosting) first; note what was there. Leave the mail records alone (`MX`, the SPF `TXT`, the
DKIM/DMARC records and any `mail`/`webmail` names): the `hello@` mailbox needs them. The site sends HSTS
without `includeSubDomains` from the apex for the same reason (those hosts are Hostinger's, not ours). Check with
`dig +short curtain.fit www.curtain.fit app.curtain.fit api.curtain.fit`: all four must give the
server's address. Caddy requests the Let's Encrypt certificates on the first request, so the records
must resolve before the first deploy. A CAA record is optional; if you have one it must allow
`letsencrypt.org`. The subdomains are fixed to `app` and `api`, the site to the apex with a `www`
redirect (the Caddyfile and its tests in `apps/api/src/caddy-*.test.ts` pin them).

### 3. A deploy key

On your laptop:

```sh
ssh-keygen -t ed25519 -N '' -C curtain-deploy -f ~/.ssh/curtain_deploy
```

`~/.ssh/curtain_deploy.pub` goes to the server (step 4). The private file goes to GitHub (step 5).
Use this key for deploys only.

### 4. Bootstrap the server (once, as root)

```sh
ssh root@<server-ip> 'bash -s' -- --pubkey "$(cat ~/.ssh/curtain_deploy.pub)" < scripts/deploy-bootstrap.sh
```

`scripts/deploy-bootstrap.sh` installs Docker Engine and the compose plugin (from Docker's own apt
repository), enables ufw (22, 80, 443/tcp, 443/udp), turns on unattended security upgrades with a
04:30 reboot when a kernel update needs one (the containers restart by themselves), installs age,
rclone and rsync, creates the `deploy` user (docker group, key login only), `/opt/curtain`,
`/var/backups/curtain`, the nightly backup cron (03:17 UTC) and `/etc/curtain/curtain.env` with
freshly generated `POSTGRES_PASSWORD`, `JWT_SECRET`, `SHOP_KEY_PEPPER` and `ENCRYPTION_KEY`. It is
safe to re-run; it never overwrites existing secrets.

Once you have checked that `ssh -i ~/.ssh/curtain_deploy deploy@<server-ip>` works, run it again
with `--harden-ssh` to turn off password logins.

Then fill in the rest of the secrets file **on the server**:

```sh
ssh root@<server-ip>
nano /etc/curtain/curtain.env
```

| Key | Where it comes from | Needed for |
|---|---|---|
| `ACME_EMAIL` | your address (Let's Encrypt expiry mails) | the first deploy |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Partner Dashboard → the app → Client credentials | the Shopify pilot |
| `BACKUP_AGE_RECIPIENT` | `age-keygen -o curtain-backup.key` on your laptop, the `age1…` line it prints | backups (see below) |
| `BACKUP_RCLONE_REMOTE` | optional: `sudo -u deploy rclone config` on the server, e.g. `b2:curtain-backups` | offsite copies |
| anything else from `infra/.env.example` | only to change a default (for example `K_ANON`, `TRYON_ORDER`, `FASHN_API_KEY`) | |

Do not edit `infra/.env` on the server: every deploy rebuilds it from `infra/.env.example`, this file
and the deploy's `DOMAIN` and image. A required key that is missing stops the deploy before anything
changes and names the key.

### 5. GitHub settings

First the environment, then its secrets. The deploy key must only be readable by a job that has
passed the environment's protection rules; a **repository** secret is readable by any workflow on
any branch, so anyone who can push a branch could use the key without approval.

1. Settings → Environments → **New environment** `production`.
   - **Required reviewers**: add yourself. Every deploy, rollback and status run then waits for your
     click. This is required, not optional: it is the gate in front of the deploy key.
   - **Deployment branches and tags** → *Selected branches and tags* → add `release` and `main`.
     A run from any other branch cannot enter the environment, so it never sees the secrets.
   - Leave *Allow administrators to bypass* off.
2. In that environment, **Environment secrets**:

| Kind | Name | Value |
|---|---|---|
| environment secret | `VPS_HOST` | the server's IP or host name |
| environment secret | `VPS_USER` | `deploy` |
| environment secret | `VPS_SSH_KEY` | the whole private key file `~/.ssh/curtain_deploy`, header lines included |
| environment secret | `VPS_SSH_KNOWN_HOSTS` | the output of `ssh-keyscan -t ed25519 <server-ip>`; compare the fingerprint with the one the bootstrap printed (`ssh-keygen -lf` on the line) |

3. Settings → Secrets and variables → Actions → **Variables** (repository variables, not secret):

| Kind | Name | Value |
|---|---|---|
| variable | `DOMAIN` | the bare domain, e.g. `curtain.fit` |
| variable | `APP_SUBDOMAIN`, `API_SUBDOMAIN` | optional; only `app` / `api` are supported today |
| variable | `VPS_PORT` | optional, default `22` (then the known-hosts line reads `[host]:port`) |

If you set `VPS_*` as repository secrets earlier, delete them there once the environment secrets
exist. The workflow's guard job reads no secret: it checks the branch (release or main only) and the
variables. The deploy and operate jobs run in `production` and check the secrets as their first step.

The api image goes to `ghcr.io/<owner>/curtain-api`. The deploy job logs the server into GHCR with the
workflow's own short-lived token for the pull and logs out right after, so the package can stay
private. Rollbacks use images already on the server and need no registry access.

## Run a deploy

Actions → **deploy** → Run workflow → branch `release` (or `main`) → action `deploy`. Or push to the
`release` branch. Any other branch stops at the guard, and GitHub would not let it into the
`production` environment anyway. One deploy runs at a time; a second one waits.

1. **guard** stops a run from another branch and prints which variables are missing. The deploy job
   prints which production environment secrets are missing.
2. **check** runs typecheck, lint and tests for the api and web (and the packages they import).
   `skip_tests` skips it for an emergency fix (still only on release or main, still behind the
   reviewer); the bundle secret scan always runs.
3. **web** builds `apps/web` with `VITE_API_URL=https://api.<domain>`, fetches the self-hosted
   MediaPipe models and runs `scripts/check-bundle-secrets.mjs` (D3).
4. **site** runs `pnpm --filter @curtain/site build:release`. While a launch gate in
   `apps/site/src/data/site.ts` is open (company identity, mailbox, legal review of the waitlist
   notice: docs/SITE.md) the release build refuses; the job then still succeeds, shows a warning and
   lists the open gates in the run summary, and no site is uploaded.
5. **image** builds `apps/api/Dockerfile` and pushes `:git-<sha12>` and `:release`.
6. **deploy** syncs `infra/` (never `.env`), the web bundle and, when the site job built one, the site, then runs `infra/scripts/deploy.sh`
   on the server: writes `infra/.env`, pulls, takes a pre-deploy backup, runs the migrations in a
   one-off container (a failure stops here with the old api untouched), swaps the api, publishes the
   web release (hashed assets first, `index.html` last, the previous release's files kept for open
   tabs), publishes the site release (every file except the pages first, then each HTML page through a
   rename, the previous release's files kept) and waits for `/readyz` and `https://api.<domain>/healthz`.
   If either fails it puts the previous image, web release and site release back and the job fails.
   GitHub then checks `https://api.<domain>/healthz` and `https://app.<domain>/` from outside and rolls
   back the same way if they do not answer. A site that fails to publish, or `https://<domain>/` not
   answering, is only a warning: the previous site stays and app and api are deployed.

The first deploy takes a minute longer: Caddy fetches the certificates.

Docker Hub limits anonymous pulls per IP. The deploy pulls the new api image (required) and then `caddy` and
`postgres`; when Docker Hub refuses (429) or is down and those images are already on the server, it warns and goes on.
To lift the limit for good, log the server in once with a free Docker Hub account: `sudo -u deploy docker login`.

### Rollback

Actions → deploy → action `rollback` returns to the previous release (image, web and site). Running it
twice swaps back. A deploy without a new site (launch gates open) keeps the site that is up, so a
rollback across it does not touch the site either. `status` prints the current and previous release. On the server:

```sh
/opt/curtain/infra/scripts/deploy.sh --domain <domain> --status
/opt/curtain/infra/scripts/deploy.sh --domain <domain> --rollback
```

Migrations only go forward. A rollback runs the previous image on the newer schema, which is safe
while migrations stay additive (new tables, new nullable columns, new indexes). A migration that drops
or renames something must ship in two releases (stop using it, then drop it), or a rollback needs a
restore from the pre-deploy backup.

### From a laptop

`scripts/deploy.sh` is what the workflow runs. With the same variables (`VPS_HOST`, `VPS_USER`,
`DOMAIN`, `IMAGE_REPO`, `TAG`, optional `WEB_DIST`, optional `SITE_DIST` (= `apps/site/dist` after
`pnpm --filter @curtain/site build:release`. Only a release build with every launch gate closed writes `dist/curtain-release.txt` (the sha256 of `index.html` and `404.html`); `scripts/deploy.sh` and, again, the server (`infra/scripts/site-release-check.sh`) publish no site without a matching marker. A preview build, such as the one `pnpm check` leaves in `apps/site/dist`, is skipped with a warning and app and api deploy as usual), `GHCR_USER`/`GHCR_TOKEN`) it deploys from any machine
that has ssh and rsync. Without `SITE_DIST` the site on the server stays as it is. `scripts/deploy.sh status` and `rollback` need only the first three.

## Backups

`infra/scripts/backup.sh` runs every night at 03:17 server time (UTC on Ubuntu cloud images; check `timedatectl`) as `deploy` (`/etc/cron.d/curtain-backup`,
log in `/var/log/curtain/backup.log`) and before every deploy. It streams `pg_dump | gzip | age` to
`/var/backups/curtain/curtain-<label>-<UTC time>.sql.gz.age` with a `.sha256` next to it, keeps
`BACKUP_KEEP_DAYS` (14) days locally and, when `BACKUP_RCLONE_REMOTE` is set, copies the nightly dump
offsite and keeps `BACKUP_REMOTE_KEEP_DAYS` (30) days there. Pre-deploy dumps stay local.

The dumps are encrypted to `BACKUP_AGE_RECIPIENT`. The matching private key (`curtain-backup.key`)
never goes on the server: keep it in your password manager and one offline copy. Without it the
backups cannot be read, by anyone.

What is in a dump: shops, products, devices, fit signatures, swipes, the ledger and usage. Renders are
deleted within 24 h and are not backed up. Caddy's certificates are re-issued on their own.

### Restore drill (monthly, and after any change to backups)

On the machine that holds the private key (docker and age installed):

```sh
scp deploy@<server>:/var/backups/curtain/curtain-nightly-<time>.sql.gz.age* .
infra/scripts/restore-drill.sh curtain-nightly-<time>.sql.gz.age ~/secure/curtain-backup.key
```

It checks the sha256, restores into a throwaway `postgres:16-alpine` container with no network,
checks the migration journal and the core tables, prints row counts and deletes the container.
Write the date and the result in `docs/STATUS.md`.

### Real restore (data loss)

```sh
# on the server, as deploy; the key is copied up for this and shredded after
cd /opt/curtain/infra
docker compose -p curtain stop api
docker compose -p curtain exec -T postgres psql -U curtain -d postgres -c 'DROP DATABASE curtain' -c 'CREATE DATABASE curtain'
age -d -i /tmp/curtain-backup.key /var/backups/curtain/<file>.sql.gz.age | gunzip \
  | docker compose -p curtain exec -T postgres psql -U curtain -d curtain -v ON_ERROR_STOP=1
shred -u /tmp/curtain-backup.key
docker compose -p curtain start api
```

## Garment assets (optional 3D estimate, D16)

The `assets` volume holds approved garment bundles: the api writes it at `ASSET_DIR=/data/assets`,
Caddy serves it read-only at `https://api.<domain>/assets/*` (immutable, CORP cross-origin, ACAO the
app origin, no access log). The nightly backup archives it next to the database dump
(`curtain-*.assets.tar.gz.age`). Import a bundle (it stays `awaiting_approval` until the merchant
approves it, D13):

```bash
docker compose -p curtain cp ./azure-palm-baby-doll-dress api:/data/import-azure
docker compose -p curtain exec api node dist/scripts/import-asset.js --shop <pilot>.myshopify.com --product <external id> --dir /data/import-azure
```

The api image creates `/data/assets` owned by `app` (pinned by `apps/api/src/assets.test.ts`), so the
fresh named volume is writable by the import. Importing the same bundle again after the merchant
rejected it puts that version back to `awaiting_approval`. The `/assets` block of the Caddyfile is
pinned by a unit test, and every deploy validates the whole Caddyfile (`infra/scripts/caddy-validate.sh` in
CI, again on the server; "What was verified" below).

Shoppers see nothing until the merchant approves and the shop's `settings.garment3d` is `true`
(set by hand while D17 decides 3D pricing). See `docs/PLUGIN.md`.

## Shopify pilot after the first deploy

With `https://api.<domain>/healthz` green:

1. Deploy the Shopify app with the `shopify-deploy` workflow ("Shopify app deploy" below). It
   renders the app config for `https://api.<domain>` and runs `shopify app deploy`, which publishes
   the theme block, the webhooks and the GDPR topics. By hand: `packages/shopify-app/README.md`,
   "Dev store install flow", with `DOMAIN=<domain> pnpm configure prod`.
2. Partner Dashboard → the app → Distribution → **Custom distribution** → the pilot shop's
   `*.myshopify.com` domain → send the install link (README, "Pilot: custom distribution").
3. After install: the theme editor deep link adds the "Try it on" block; check one product page.

The public App Store listing comes later and needs the checklist in `packages/shopify-app/README.md`.

## What was verified, and what not

**Go-live rehearsal (9 Nov 2026, `docs/GOLIVE-REHEARSAL.md`).** On a simulated fresh Ubuntu 24.04 VPS (systemd, sshd,
ufw, Docker from Docker's repo) with the unchanged Caddyfile and compose file: the bootstrap (three runs, idempotent,
`--harden-ssh`), first deploy, upgrade with a site release, a release that rolled itself back, an invalid Caddyfile,
manual rollbacks, the nightly backup from the cron line, the restore drill, a real restore, compose restarts, a reboot
and a power cut, 46 edge checks after each, and a capped load test. Every workflow `run:` step was run by hand. Fixed on
the way: a Docker Hub rate limit (429) no longer blocks a deploy when Caddy and Postgres are already on the server;
`DOMAIN=app.curtain.fit` is refused; a refused site release build leaves nothing to publish. Still not run: Let's
Encrypt, GHCR, the workflow on GitHub, rclone, IPv6. Each deploy has about 3 s of api 502s while the container swaps.

Earlier:


Verified on a Docker host (Nov 2026): the api image builds from `apps/api/Dockerfile`; a local
"server" ran first deploy, upgrade, a failing release that rolled itself back, a manual rollback, the
pre-deploy and nightly backups and the restore drill, against the real compose file and Caddyfile
(internal TLS on `*.localhost`). `caddy validate` accepts the Caddyfile, actionlint accepts the
workflow, shellcheck passes every script.

Not yet run: the workflow on GitHub itself, the ssh/rsync leg against a real VPS, Let's Encrypt
issuance, the bootstrap script on a fresh Ubuntu/Debian, and the rclone offsite copy.

The site on `<domain>` (Nov 2026, later change) was not run on a Docker host: there was no Docker daemon
and no Caddy binary in that session. Covered by `apps/api/src/caddy-site.test.ts` (site and www blocks,
CSP, caching, 404, the site volume, the deploy script and workflow wiring, release state written before
the site existed) and `bash -n`. `caddy validate` was not run in that session; it now runs on every deploy
twice: in the workflow's check job (`infra/scripts/caddy-validate.sh`, the image `docker-compose.yml` pins)
and on the server before migrations (`infra/scripts/deploy.sh`), which stops without touching the running
stack if the file does not validate. The server keeps the Caddyfile of the last good deploy in
`infra/.deploy/Caddyfile.good` (seeded from the running one on the first deploy with this change): a changed
Caddyfile recreates the caddy container, and a failed health check puts `Caddyfile.good` back before the
rollback. A first site deploy whose api health check fails leaves the new site files in the volume while the
release state records no site; harmless, because the site only ships after its launch gates pass, and the next
good deploy records it. The site volume is not in the backups: every release is in
`/opt/curtain/site/releases/` and can be rebuilt from git.

## Shopify app deploy

`.github/workflows/shopify-deploy.yml` runs `shopify app deploy` without a person at the keyboard. It
renders `packages/shopify-app/shopify.app.toml` into `shopify.app.prod.toml` for your domain, builds
the "Try it on" theme app extension with the bundled SDK, and creates a new **app version**. A version
is the app's config (URLs, scopes, webhooks) plus the extension. Merchants only get it once it is
**released**.

Run the VPS deploy first: the app's admin page and webhooks live on `https://api.<domain>`, so that
address must answer before Shopify sends anything to it.

### Set once: Partner Dashboard

1. **Partner account.** Sign up at partners.shopify.com and create the organisation that will own
   the app.
2. **Create the app manually.** Partner Dashboard → **Apps** → **Create app** → **Create app
   manually**. Name it `Curtain: Fit & Size Finder` (it must match `name` in `shopify.app.toml`; see
   checklist E1 for the trademark question). Do not use `shopify app init`: the repository already
   has the config.
3. **Client credentials.** The app → **Client credentials** (in newer dashboards: the app →
   Settings).
   - **Client ID** (32 hex characters). Goes into the GitHub secret `SHOPIFY_API_KEY` and into
     `SHOPIFY_API_KEY` in `/etc/curtain/curtain.env` on the server. It is not a secret, but it stays
     out of the repository (the toml is a template for that reason).
   - **Client secret**. Goes **only** into `SHOPIFY_API_SECRET` in `/etc/curtain/curtain.env`. It
     never goes into GitHub: the api uses it for webhook HMACs, session tokens and token exchange,
     and the CLI does not need it.
4. **CLI credential for CI.** shopify.dev now documents a **service account** for CI
   (https://shopify.dev/docs/apps/launch/deployment/deploy-in-ci-cd-pipeline): create one with the
   **App development** permission (Dev Dashboard → the app → Settings, or the organisation's
   Settings → Users → Security) and store its token as the GitHub secret
   `SHOPIFY_SERVICE_ACCOUNT_TOKEN`. Only Shopify CLI 5.x reads that variable, so the workflow then
   installs `SHOPIFY_CLI_VERSION_SERVICE_ACCOUNT` (5.0.1) instead of 4.9.5. The older Partner
   Dashboard **CLI token** (`SHOPIFY_CLI_PARTNERS_TOKEN`) still works with both CLI lines, if your
   dashboard still offers it. Either credential can deploy apps in the organisation, so treat it like
   the deploy key (see "Harden" below) and renew it before it expires.
5. **Development store.** Partner Dashboard → **Stores** → **Add store** → **Create development
   store** (for testing apps). Use it for the dry run before the pilot. Charges on development stores
   are always test charges (D17, `shop.plan.partnerDevelopment`).
6. **Distribution for the pilot (bohohippychic.com.au).** The app → **Distribution** → **Custom
   distribution**.
   - Enter the shop's **`*.myshopify.com` domain**, not `bohohippychic.com.au`. The merchant finds it
     in their Shopify admin under Settings → Domains, or in the admin address
     (`admin.shopify.com/store/<handle>` means `<handle>.myshopify.com`).
   - **Generate link** and send the install link to the merchant. The merchant opens it while logged
     in to their store admin and approves the scopes (products only, D7).
   - The distribution method cannot be changed once chosen. This custom app serves the pilot shop
     (and other stores in the same Plus organisation, if any). The public App Store listing will be
     a separate app with its own client id; point `SHOPIFY_API_KEY` at that app when the time comes
     (docs/LAUNCH-SHOPIFY.md, "App Store listing later", explains what does not carry over).
   - Custom apps are not reviewed by Shopify and the expiring-token deadline does not apply to them
     (checklist, Summary). They **cannot** charge through Shopify's billing system
     ("Can't charge merchants through Shopify's app billing system",
     https://shopify.dev/docs/apps/launch/distribution). Set `SHOPIFY_DISTRIBUTION=custom` in
     `/etc/curtain/curtain.env` (the bootstrap writes it): the api then grants the plan on install and
     the admin shows the plan as arranged with Curtain instead of a Subscribe button. With
     `SHOPIFY_API_KEY` set, the api will not start in production without this line, and
     `infra/scripts/write-env.sh` stops the deploy if it is missing or not `custom`/`public`.
     Preflight after the first deploy: `docker compose logs api | grep 'shopify app configured'`
     shows `"distribution":"custom"`.

### Set once: GitHub

| Kind | Name | Value |
|---|---|---|
| repository secret | `SHOPIFY_SERVICE_ACCOUNT_TOKEN` (or `SHOPIFY_CLI_PARTNERS_TOKEN`) | the CI credential (step 4) |
| repository secret | `SHOPIFY_API_KEY` | the client id (step 3) |
| repository variable | `DOMAIN` | the same bare domain the VPS deploy uses, e.g. `curtain.fit` |
| repository variable | `SHOPIFY_APP_HANDLE` | optional, default `curtain`; the app's handle (its admin URL) |

The deploy job runs in a GitHub environment called `shopify`. GitHub creates it on the first run,
with no rules, so the repository secrets above work as they are.

**Harden (recommended before the pilot goes live).** A repository secret can be read by a workflow on
any branch. To put the CLI token behind your approval, as §5 above does for the VPS key:

1. Settings → Environments → `shopify` → **Required reviewers**: add yourself.
2. Add the CI credential (and `SHOPIFY_API_KEY`) as **environment secrets** there, then
   delete the repository secrets.
3. Optional: **Deployment branches** → `release` and `main` only. This also turns off the
   `claude/**` trigger below (those runs would stop at the environment), so leave it open while
   agents still deploy from work branches.

### Run it

The workflow only appears under Actions → **Run workflow** once it is on the default branch. Until
then, and for work branches, there are two triggers:

- **Push to `release`.** Deploys and **releases** when the push changes `packages/shopify-app`,
  `packages/sdk`, `packages/schema`, the workflow or `.github/shopify/deploy.txt`. A push that
  changes none of these does not create a version.
- **Change `.github/shopify/deploy.txt` on a `claude/**` branch** (the same pattern as
  `.github/modal/run.txt`). Creates a version and does **not** release it, unless the file says
  `release = true`. Any change to the file triggers a run, a comment line included. Other pushes to
  `claude/**` branches end green at the plan job.
- **Run workflow** (once on the default branch): pick the branch, tick **release** to release.

`deploy.txt` holds optional `key = value` lines; `#` starts a comment:

```
# pilot block, second try
release = false
message = pilot: peek on product pages
version = pilot-2
```

`release` (true or false) overrides the branch default; `message` is a note shown only in the Partner
Dashboard; `version` names the version (default `git-<sha12>-r<run>-<attempt>`, unique per run). An
unknown key or a bad value stops the run at the plan job. The dispatch inputs override the file.

What the run does:

1. **plan** (`packages/shopify-app/scripts/deploy-plan.mjs`, unit-tested) decides whether to deploy
   and whether to release, and writes it to the run summary.
2. **guard** (first step of the deploy job) lists every missing secret and variable at once and
   checks that `DOMAIN` is a bare domain. It sees only whether a secret is set, not its value.
3. Installs, builds `@curtain/shopify-app` and what it imports (the SDK included), copies
   `sdk.v1.js` into the extension, runs the package tests (which include a dry run of the config
   rendering), checks the SDK file is there and runs the bundle secret scan (D3).
4. `pnpm configure prod` with `DOMAIN` and the client id renders `shopify.app.prod.toml`:
   `application_url` = `https://api.<DOMAIN>/shopify/admin`, redirect URL
   `https://api.<DOMAIN>/shopify/auth/callback`, every webhook and GDPR topic to
   `https://api.<DOMAIN>/shopify/webhooks`. It validates the result against the api's topic list,
   scopes and managed install before anything is sent.
5. Installs the Shopify CLI at the pinned version (`SHOPIFY_CLI_VERSION`, `4.9.5`, the last 4.x;
   with a service-account token `SHOPIFY_CLI_VERSION_SERVICE_ACCOUNT`, `5.0.1`, because 4.x does not
   read that variable) and runs
   `shopify app deploy --config prod` with `--allow-updates` (release) or `--no-release` (version
   only). `--allow-deletes` is never passed: removing an extension or a webhook needs a person.
6. Deletes the rendered config.

To release a version that was not released: Partner Dashboard → the app → **Versions** → the version
→ **Release**. To go back, release the previous version the same way.

To check the rendering locally, without writing anything:

```sh
pnpm --filter @curtain/shopify-app build
SHOPIFY_API_KEY=<client id> DOMAIN=<domain> pnpm --filter @curtain/shopify-app configure prod --dry-run
```

### After the first released version

1. In the Dev Dashboard, check the app's URLs: the app URL is `https://api.<domain>/shopify/admin`
   (`shopify app deploy` always pushes the configuration from the toml; the old
   `include_config_on_deploy` key is no longer supported and has been removed from the template).
2. Install on the development store (Distribution → the install link, or Test your app), open the app
   in the admin once (this runs the token exchange), add the "Try it on" block on a product page
   with the onboarding deep link, and check one product.
3. Then send the custom distribution link to the pilot shop.

Not yet run: the workflow on GitHub, and the CLI against a real Partner organisation. The config
rendering, the plan logic and the workflow's references are covered by
`packages/shopify-app/src/deployConfig.test.ts`.

# Deploy: one VPS, one click

How Curtain gets from a commit to `https://app.<domain>` and `https://api.<domain>` (decision D9).
One GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the api image and the static web
app, ships both to the founder's VPS over ssh, migrates, swaps, checks health and rolls back by itself
when the new release is unhealthy.

```
GitHub Actions                                     VPS (/opt/curtain, user deploy)
guard ─┬─ check (typecheck · lint · test)
       ├─ web   (vite build, bundle secret scan) ──► web/releases/git-<sha12>/
       └─ image (docker build → GHCR) ─────────────► docker pull (one-time registry login)
deploy: scripts/deploy.sh ──ssh──► infra/scripts/deploy.sh
          write-env.sh: infra/.env = .env.example + /etc/curtain/curtain.env + DOMAIN/API_IMAGE
          pre-deploy backup → migrate (one-off container) → swap api → publish web into the caddy volume
          /readyz in the container + https://api.<domain>/healthz → keep, or put the previous release back
        external health check from GitHub → on failure: scripts/deploy.sh rollback
```

Secrets never leave the server and never enter the repository: GitHub holds only the ssh key, the
pinned host key and the address. Everything the api needs (database password, JWT secret, Shopify
client secret, …) lives in `/etc/curtain/curtain.env` on the VPS.

## Set once

### 1. A server

Any VPS with 2 vCPU, 4 GB RAM and 40 GB disk runs the whole stack (Caddy, the api, Postgres). Use
Ubuntu 24.04 or Debian 12. For the Australian pilot shop a Sydney region keeps the api close to its
shoppers (Hetzner has no AU region; Vultr, DigitalOcean, Linode and AWS Lightsail do). The api never
runs models, so no GPU.

### 2. DNS records

Point two names at the server, at your DNS provider:

| Type | Name | Value |
|---|---|---|
| A | `app.<domain>` | the server's IPv4 |
| A | `api.<domain>` | the server's IPv4 |
| AAAA | `app.<domain>`, `api.<domain>` | the server's IPv6 (optional, only if the server has one) |

Caddy requests the Let's Encrypt certificates on the first request, so the records must resolve
before the first deploy. A CAA record is optional; if you have one it must allow `letsencrypt.org`.
The subdomains are fixed to `app` and `api` (the Caddyfile and its CSP test pin them).

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
4. **image** builds `apps/api/Dockerfile` and pushes `:git-<sha12>` and `:release`.
5. **deploy** syncs `infra/` (never `.env`) and the web bundle, then runs `infra/scripts/deploy.sh`
   on the server: writes `infra/.env`, pulls, takes a pre-deploy backup, runs the migrations in a
   one-off container (a failure stops here with the old api untouched), swaps the api, publishes the
   web release (hashed assets first, `index.html` last, the previous release's files kept for open
   tabs), and waits for `/readyz` and `https://api.<domain>/healthz`. If either fails it puts the
   previous image and web release back and the job fails. GitHub then checks
   `https://api.<domain>/healthz` and `https://app.<domain>/` from outside and rolls back the same way
   if they do not answer.

The first deploy takes a minute longer: Caddy fetches the certificates.

### Rollback

Actions → deploy → action `rollback` returns to the previous release (image and web). Running it
twice swaps back. `status` prints the current and previous release. On the server:

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
`DOMAIN`, `IMAGE_REPO`, `TAG`, optional `WEB_DIST`, `GHCR_USER`/`GHCR_TOKEN`) it deploys from any
machine that has ssh and rsync. `scripts/deploy.sh status` and `rollback` need only the first three.

## Backups

`infra/scripts/backup.sh` runs every night at 03:17 UTC as `deploy` (`/etc/cron.d/curtain-backup`,
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

## Shopify pilot after the first deploy

With `https://api.<domain>/healthz` green:

1. Render the app config for production and push it with the Shopify CLI, using
   `PUBLIC_API_URL=https://api.<domain>` and `PUBLIC_APP_URL=https://app.<domain>`
   (`packages/shopify-app/README.md`, "Dev store install flow", with `pnpm configure` for a `prod`
   config). `shopify app deploy` publishes the theme block and the webhooks.
2. Partner Dashboard → the app → Distribution → **Custom distribution** → the pilot shop's
   `*.myshopify.com` domain → send the install link (README, "Pilot: custom distribution").
3. After install: the theme editor deep link adds the "Try it on" block; check one product page.

The public App Store listing comes later and needs the checklist in `packages/shopify-app/README.md`.

## What was verified, and what not

Verified on a Docker host (Nov 2026): the api image builds from `apps/api/Dockerfile`; a local
"server" ran first deploy, upgrade, a failing release that rolled itself back, a manual rollback, the
pre-deploy and nightly backups and the restore drill, against the real compose file and Caddyfile
(internal TLS on `*.localhost`). `caddy validate` accepts the Caddyfile, actionlint accepts the
workflow, shellcheck passes every script.

Not yet run: the workflow on GitHub itself, the ssh/rsync leg against a real VPS, Let's Encrypt
issuance, the bootstrap script on a fresh Ubuntu/Debian, and the rclone offsite copy.

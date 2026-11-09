# Go-live rehearsal: the production server stack on a fresh Ubuntu 24.04 (9 Nov 2026)

Goal: before the founder buys the dedicated VPS for `curtain.fit`, `app.curtain.fit` and `api.curtain.fit`, run the
real production path (bootstrap, deploy, edge, backups, failure handling) end to end on a machine that looks
like that VPS, measure what the stack needs, and fix what breaks. Branch `claude/golive-prod`.

Short version: the path works. The bootstrap, four deploys, three rollbacks, an invalid Caddyfile, backups, the
restore drill, a real restore, reboots and a power cut all behaved as `docs/DEPLOY.md` describes. Two real
defects and two guard gaps were found and fixed (section 5). The measured footprint supports a **2 vCPU / 2 GB /
40 GB** VPS (section 4); 1 vCPU / 1 GB also held the load test.

## 1. Set-up: how close to production this was

| Production | Rehearsal | Same? |
|---|---|---|
| A fresh Ubuntu 24.04 VPS, root ssh | `ubuntu:24.04` with **systemd as PID 1** and sshd, privileged container on its own network (`10.77.0.10`), fresh host keys, real ext4 for `/var/lib/docker` and `/var/lib/containerd` | Close: real systemd, apt, ufw (iptables), Docker Engine, cron. It is not a VM and shares the host kernel |
| GitHub `ubuntu-latest` runner | `ubuntu:24.04` + openssh-client + rsync + curl, mounting the worktree | Same tools |
| `scripts/deploy-bootstrap.sh` over `ssh root@ 'bash -s'` | exactly that | Same |
| `scripts/deploy.sh` → `infra/scripts/deploy.sh` over ssh/rsync as `deploy` with the pinned host key | exactly that, from the runner | Same |
| api image from `apps/api/Dockerfile` (CI: docker/build-push-action) | `docker build -f apps/api/Dockerfile .` with `NODE_IMAGE` = the pinned `node:22.23.4-alpine3.24` plus this sandbox's proxy CA (the override the Dockerfile documents) | Same Dockerfile and stages; the rehearsal image also trusts the proxy CA |
| GHCR | `registry:2` on the VPS's loopback (`localhost:5000/curtain-api`), so `compose pull` really pulls | Pull path same; the GHCR login/logout with `GHCR_TOKEN` was not exercised |
| Docker Hub for `caddy:2.9-alpine`, `postgres:16-alpine` | real Docker Hub, through the sandbox proxy (daemon proxy drop-in) | Real; it rate-limited us (finding D1) |
| `infra/Caddyfile`, `infra/docker-compose.yml` | **unchanged**, no override file. `DOMAIN=curtain.localhost`: Caddy issues `*.localhost` names from its internal CA by itself. That CA's root was pre-seeded in `caddy_data` and trusted on the VPS and the runner, so the deploy's own `https://api.<domain>/healthz` check ran without `-k` | Same config; Let's Encrypt not exercised |
| Public DNS | `curl --resolve` (edge checks), `*.localhost` resolves to loopback on the VPS itself | Hairpin check equivalent |
| Direct internet on the VPS | apt over https through the session proxy (apt proxy file, proxy CA, `/etc/environment`) | Rehearsal plumbing only, written by the simulator image, not by any repo script |

The simulator's Dockerfiles, the relay, the keys, the edge-check, probe and load scripts live in the session
scratchpad, not in the repository. Every key was throwaway; nothing reached a real shop or service.

## 2. What ran, in order, with the result

### Bootstrap (`scripts/deploy-bootstrap.sh`)

| Step | Result |
|---|---|
| First run (`--pubkey`) | exit 0 in about 40 s: packages, Docker 29.9.3 + compose 5.7.0 from Docker's apt repo, `daemon.json` (log rotation, live-restore), ufw active with 22/80/443tcp/443udp, unattended-upgrades with 04:30 reboot, deploy user in the docker group, directories, `/etc/curtain/curtain.env` (mode 640 root:deploy, four generated secrets), cron file, logrotate |
| Second run (same args) | exit 0, "exists; left unchanged", secrets file md5 unchanged, one line in `authorized_keys` |
| Third run (`--harden-ssh`) | `sshd -T`: passwordauthentication no, kbdinteractiveauthentication no, permitrootlogin without-password. A password login as deploy is refused, the key login works |
| Printed host-key fingerprint | equals `ssh-keygen -lf` of `ssh-keyscan -t ed25519` from the runner (what goes into `VPS_SSH_KNOWN_HOSTS`) |
| systemd units after boot | docker, cron, unattended-upgrades, ssh: active |

Everything in the bootstrap ran, including the systemd and ufw parts. One thing only showed up in a container: Docker's
`ubuntu` image ships `/usr/sbin/policy-rc.d` (exit 101), which stopped `cron` from starting at install. It is not
on a real VPS; the simulator removes it, and cron is enabled so it starts at boot anyway.

The founder then fills in `ACME_EMAIL` and `BACKUP_AGE_RECIPIENT` (the age key pair was made on the "laptop" side;
only the `age1…` line went to the server). `SHOPIFY_API_KEY/SECRET` were left empty: `write-env.sh` notes it and
the api starts.

### Deploys and rollbacks (`scripts/deploy.sh` from the runner)

| Run | What | Result |
|---|---|---|
| 1 | First deploy, site gates open (no `SITE_DIST`) | ok in **29 s**: rsync of `infra/` and the web bundle, `write-env.sh`, real pull of all three images, `caddy validate` (real Caddy 2.9.1), postgres healthy, migrations in a one-off container (6 applied), api up, caddy recreated, web published, `/readyz` and `https://api.<domain>/healthz` ok. The pre-deploy backup is skipped on a first deploy, as designed |
| 2 | A release whose api migrates but never serves (`git-badbadbad000`) | pre-deploy backup ran, migrations ran, `/readyz` failed after 40 tries, the previous image and web release came back by themselves, exit 1, `--status` unchanged, edge checks green afterwards (2 min 17 s in total; the api answered 502 for about 2 min of that) |
| 3 | A Caddyfile that does not validate (`encode zstd gzip bogus_encoder`) | stopped at `validating infra/Caddyfile` with Caddy's error and line, put the last good Caddyfile back (same md5), no container touched |
| 4 | Upgrade to `git-2301a064eb22` (this branch) + a site release | first attempt: **Docker Hub 429 on `postgres:16-alpine`, deploy stopped** (finding D1). After the fix: ok in **14 s**, site published, `https://<domain>/` ok |
| 5 | `scripts/deploy.sh rollback` twice, `status` | each rollback about 5 s; the second swaps back; the site release stays across the rollback (documented behaviour) |
| 6 | Docker Hub unreachable (daemon proxy pointed at a dead port), images on the host | warns for caddy and postgres, deploys ok |
| 7 | Docker Hub unreachable, `postgres:16-alpine` deleted from the host | "could not pull postgres:16-alpine and it is not on this host", exit 1 before any change, `infra/.env` back on the running image |
| 8 | Plain redeploy | Docker Hub gave a real 429 again; the fallback warned and the deploy went through. Housekeeping removed the leftover broken image (only current and previous api images stay) |

**Downtime during a normal deploy**, measured by probing `https://api…/healthz` and `https://app…/` every 0.2 s
from the runner: the api answered 502 for **about 2.6 s** (11 of 346 probes) while the container was swapped; the
app stayed 200 throughout. A single api replica cannot avoid this; deploy outside Australian shopping hours.

### Edge checks (from the runner, 46 assertions, all pass after every deploy and every restart)

- api: `/healthz` `{"ok":true}`, `/readyz` 200, HSTS with includeSubDomains, nosniff, referrer policy, no `Server`, no `X-Powered-By`.
- CORS: preflight from `https://app.<domain>` allowed; from another origin no allow-origin; `/v1/sdk/*` answers `*`.
- SDK: `/sdk/v1.js` 200, JavaScript, `Cache-Control: public, max-age=3600`, CORP cross-origin, ACAO `*`, 20,646 bytes
  (8,333 gzip) and **byte-identical to `packages/sdk/dist/sdk.v1.js`**, the file the theme block ships. The theme block's
  own assets (`sdk.v1.js`, `curtain-try.css`) are served by Shopify's CDN (`asset_url`), not by this server.
- `/assets` (3D bundles): a correctly shaped path written by the api user into the fresh `assets` volume is served 200 with
  `immutable`, CORP cross-origin, ACAO `https://app.<domain>`, no cookie; the same path with a query string, a bad name and
  `../` traversal answer 404. (A real bundle import needs a shop row and a bundle; not in the repo, not run.)
- app: `/` is the PWA, COOP same-origin, COEP require-corp, CSP connects only to `https://api.<domain>`, frame-ancestors none,
  the bundle points at `https://api.<domain>`; `/try/<token>` falls back to the SPA; hashed assets immutable, `sw.js` no-cache,
  the self-hosted MediaPipe models are served.
- `/embed/<token>`: frame-ancestors `https:`, COEP credentialless, CORP cross-origin, `no-store`, `noindex`, no COOP, no X-Frame-Options.
- http → https 308 on every host; `www.<domain>/pilot/?a=1` → 301 `https://<domain>/pilot/?a=1`.
- site gates open: `https://<domain>/` 404 and app/api deployed normally. With a site release: 200, HSTS **without**
  includeSubDomains, X-Frame-Options DENY, same-origin CSP, HTML no-cache, unknown path 404, `/pilot` → 308 `/pilot/`.
- TLS verifies on all four names (HTTP/2).
- Rate limits are keyed on the real client: 75 requests to `/v1/try` with 75 different spoofed `X-Forwarded-For` values
  still got 15 × 429 (Caddy overwrites the header; the api's `trustProxy: true` is safe behind it).

### Backups and restore

- The nightly job, run as `deploy` with the exact command and environment from `/etc/cron.d/curtain-backup`: encrypted dump
  + `.sha256`, encrypted assets archive + `.sha256`, pruning, the "no rclone remote" note. Exit 0.
- Restore drill (`infra/scripts/restore-drill.sh`) on the "laptop" with the private key: checksum ok, restored into a throwaway
  `postgres:16-alpine` with no network in 1 s, 18 tables, 6 migrations, `devices` 50 rows = 50 live. **Passed.** The assets
  archive decrypts and lists the bundle file.
- The "Real restore (data loss)" commands from DEPLOY.md, verbatim on the server: a row added after the backup (51 rows)
  is gone after the restore (50), the key was shredded, the api came back and the edge checks pass.
- The pre-deploy backup ran before every deploy once `BACKUP_AGE_RECIPIENT` was set.

### Restarts

| Event | Result |
|---|---|
| `docker compose restart` | all healthy, edge checks pass |
| api node process killed (SIGKILL) | restarted by the restart policy (RestartCount 1), edge checks pass |
| Postgres restarted under a running api | `/readyz` 200 and a device mint (a DB write) works right after |
| Clean reboot of the VPS (systemd shutdown) | `https://api…/healthz` back **5 s** after the reboot started; docker, cron and ssh active |
| Power cut (SIGKILL of the whole VPS) | back in **4 s**; Postgres crash recovery ("redo done"), no rows lost |

### The workflow (`.github/workflows/deploy.yml`)

Read end to end. `act` is not installed. Every `run:` block was cut out of the YAML and run by hand, under GitHub's own
invocation `bash --noprofile --norc -eo pipefail`, with fake `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY` and `GITHUB_ENV`:

| Step | Cases | Result |
|---|---|---|
| guard | release, main, a `claude/*` branch, empty DOMAIN, `https://…`, `Curtain.fit`, `APP_SUBDOMAIN=shop`, `app.curtain.fit` | all as intended **except `app.curtain.fit`, which passed** (finding D3, fixed) |
| plan | owner with capitals | `ghcr.io/<lower-case owner>/curtain-api`, `git-<sha12>` |
| site build:release | gates open | exit 0, `built=false`, the summary lists the four open gates |
| ssh key and pinned host key | missing secrets, a public key pasted as `VPS_SSH_KEY`, the real throwaway key | names every missing secret; refuses the public key; writes the key (600) and `SSH_OPTS`, which `scripts/deploy.sh status` then used over ssh |
| ship | `scripts/deploy.sh deploy` | the runs in the table above |
| health check from outside | api up; api stopped | exit 0 "healthy after 1 tries"; exit 1, which triggers the rollback step |
| site check from outside, rollback health check, summary | | exit 0, summary rendered |

Not run: the `uses:` actions (checkout, setup-node, upload/download-artifact, build-push-action with the GHA cache), the
`production` environment approval, and the workflow on GitHub itself. `actionlint` 1.7.7 passes `deploy.yml`,
`shopify-deploy.yml` and `ci.yml`; `shellcheck` 0.10.0 passes every script in `scripts/` and `infra/scripts/`.

## 3. Image and bundle sizes

| Artifact | Download (compressed) | On disk |
|---|---|---|
| api image `curtain-api` | 96.9 MB | 412 MB |
| `postgres:16-alpine` | 117 MB | 420 MB |
| `caddy:2.9-alpine` | 18.7 MB | 68.9 MB |
| web release (`apps/web/dist`, with the MediaPipe models) | | 65 MB per release (up to 5 kept) |
| site release (`apps/site/dist`) | | 6.3 MB per release |
| api image build, cold, on this 4-core sandbox | | 1 min 32 s |

## 4. Measured resource use and the VPS it supports

Load: 20 concurrent clients for 60 s from outside the VPS, a mix of what a product page with the "Try it on" block and a
shopper opening the embed cause: `/sdk/v1.js`, `/embed/<token>`, a hashed app chunk, `/healthz`, and `POST /v1/sdk/sessions`
without a key (rejected and rate-limited by the api). Plus 50 device mints (DB writes). Zero errors in every run. For the
caps, the inner Docker was pointed at the VPS's own cgroup (`cgroup-parent`, rehearsal-only, reverted afterwards), so
the cap limits the whole stack the way a VPS's real CPU and RAM would.

| VPS cap | Throughput | p99 latency (worst endpoint) | Whole-VPS CPU | Whole-VPS memory |
|---|---|---|---|---|
| none (4 shared cores, the load generator on the same host) | 2,860 req/s | 40 ms | | |
| **2 vCPU / 2 GB** | 3,058 req/s | 48 ms (`/sdk/v1.js`) | 177% of one core, Caddy (TLS) is most of it | RSS 279 MiB; 723 MiB with page cache |
| **1 vCPU / 1 GB** | 1,424 req/s | 93 ms | 86% (saturated) | RSS 276 MiB; 771 MiB peak with page cache; no OOM kill, failcnt 0 |
| idle | | | < 1% | RSS 100 MiB (containers: api 54 MiB, postgres 32 MiB, caddy 15 MiB) |

Peak per container under load: api 106–146 MiB, Caddy 51–58 MiB, Postgres 32–52 MiB. Largest processes after the load: node
186 MiB, dockerd 106 MiB, caddy 75 MiB, containerd 61 MiB. A pilot shop produces a few requests per second, about three
orders of magnitude below what 1 vCPU sustained.

What the test does not cover, and why the advice keeps headroom: the media proxy's in-memory cache (`MEDIA_PROXY_CACHE_MB=64`),
Postgres caching as the data grows (`shared_buffers` 128 MB default), `pg_dump` and image pulls during a deploy, apt upgrades,
and the optional `jobs` replica (another ~100 MiB). A shop-keyed SDK session was not load-tested (it needs a shop row).

Disk on the VPS after all of this: Docker and containerd 2.0 GB with three api versions (production keeps two), `/usr` 728 MB,
`/opt/curtain` 200 MB (three web releases and a site release), volumes 140 MB (Postgres 67 MB, web 67 MB, site 6 MB), backups
160 KB. Container logs are capped at 20 MB × 7 per container (≤ 420 MB). Worst case today is under 5 GB.

**Advice for the new VPS (Ubuntu 24.04, Sydney region for the Australian pilot, one public IPv4):**

| | Minimum that worked | Recommended | Why |
|---|---|---|---|
| CPU | 1 vCPU | **2 vCPU** | 1 vCPU saturated at 1,400 req/s; 2 keeps deploys (pull, migrate, pg_dump) from competing with traffic |
| RAM | 1 GB | **2 GB** (4 GB only if it costs little more) | the stack peaks under 0.8 GB with cache; 2 GB leaves room for Postgres growth, the media cache, deploys and the jobs replica |
| Disk | 10 GB | **40 GB SSD** (25 GB is enough) | measured worst case < 5 GB; the rest is room for backups, logs and years of data |
| Network | | IPv4; **do not add AAAA records at first** | IPv6 was not tested. If AAAA records exist, Let's Encrypt validates over IPv6 first, so add them only after `curl -6 https://api.curtain.fit/healthz` works |

`docs/DEPLOY.md` said 2 vCPU / 4 GB / 40 GB. That still works; the measurement shows 2 GB is enough.

## 5. Defects found and fixed

| # | Defect | Fix | Pinned by |
|---|---|---|---|
| D1 | **A Docker Hub 429 (rate limit) or outage stopped every deploy** at `compose pull`, although `caddy:2.9-alpine` and `postgres:16-alpine` were already on the server. Anonymous Hub pulls are rate-limited per IP and VPS IPs are shared; it happened twice in this rehearsal. An emergency fix would have been blocked too | `infra/scripts/deploy.sh` pulls the api image (required) and then caddy/postgres; a failed pull of an image already on the host only warns, a missing one is still fatal | `apps/api/src/deploy-guard.test.ts`; runs 6, 7, 8 above |
| D2 | A failed pull exited (via `set -e`) with `infra/.env` already pointing at the new, unpulled image, unlike every other early failure | the failed pull puts `infra/.env` back on the running image before exiting | same test; run 7 |
| D3 | `DOMAIN=app.curtain.fit` (or `api.`/`www.`) passed the deploy guard, `scripts/deploy.sh` and the Shopify config renderer, although the message says "no subdomain prefix". It would have asked Let's Encrypt for `app.app.curtain.fit` and sent Shopify webhooks to `api.app.curtain.fit` | refused in `deploy.yml`, `shopify-deploy.yml`, `scripts/deploy.sh` and `packages/shopify-app/src/appConfig.ts` | `deploy-guard.test.ts` runs the guard's shell block and `scripts/deploy.sh`; `deployConfig.test.ts` |
| D4 | A refused `build:release` left a complete `apps/site/dist/` behind. CI never uploads it, but the laptop path (`SITE_DIST=apps/site/dist`) would have published a site with open launch gates (including the waitlist notice that still needs legal review) | the refused release build removes `dist/` (fail closed) | `deploy-guard.test.ts`; checked by running the build |
| — | `shellcheck` SC2015 in `publish_site` (CI does not run shellcheck) | rewritten as an `if` | `shellcheck` clean |

## 6. Still open (needs the real server, store or founder)

- Let's Encrypt issuance for the four real names (needs DNS pointing at the VPS); the GHCR login/pull with the workflow token; the
  workflow on GitHub with the `production` environment approval; the rclone offsite copy.
- Shopify: install on a development store, then the pilot shop (needs `SHOPIFY_API_KEY/SECRET` in `/etc/curtain/curtain.env`,
  the Partner Dashboard and the `shopify-deploy` workflow).
- A real garment bundle import (`import-asset.js`) on the server, and a shop-keyed SDK session under load.
- IPv6 (see the table above), the unattended-upgrades 04:30 reboot on a real kernel update, and the optional `jobs` replica.
- Each deploy has about 3 s of api 502s (single replica). Acceptable for the pilot; deploy at a quiet hour.
- Recommended, not done: log the server in to Docker Hub with a free account (`docker login` as `deploy`) to lift the anonymous
  pull limit; pin `caddy` and `postgres` by digest so a deploy never picks up a new patch release by surprise; run `shellcheck`
  in CI.
- The cron time in `/etc/cron.d/curtain-backup` is the server's local time. Ubuntu cloud images use UTC (the rehearsal VPS
  did); if the provider sets another zone, the nightly backup runs at 03:17 in that zone.
- The site stays a bare 404 on `curtain.fit` until its launch gates are closed (docs/SITE.md).

## 7. Gates on this branch

- `npm_config_workspace_concurrency=1 pnpm check` (root): exit 0. Every package's tests pass (api 440, shopify-app 165, the
  rest unchanged) and the bundle secret scan is clean.
- `pnpm demo:e2e`: exit 0, "2 flows passed". The two 3D sub-checks are skipped because their bundles are git-ignored, as on
  the base branch.
- `pnpm --filter @curtain/api exec vitest run src/deploy-guard.test.ts src/caddy-site.test.ts`: 20 tests pass (14 + 6 new).
- `pnpm --filter @curtain/shopify-app test`: pass.
- `infra/scripts/caddy-validate.sh` (Caddy v2.9.1): "Valid configuration" for `example.test` and `curtain.fit`. This closes
  refinement M3 (the `/assets` block against a real Caddy), and the block was also exercised over HTTPS above.

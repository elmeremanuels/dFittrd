#!/usr/bin/env bash
# Deploy on the VPS (D9), run by .github/workflows/deploy.yml through scripts/deploy.sh, or by hand.
#
#   infra/scripts/deploy.sh --domain <domain> --image-repo ghcr.io/<owner>/curtain-api --tag <tag> [--web-release <dir>] [--site-release <dir>]
#   infra/scripts/deploy.sh --domain <domain> --rollback          # back to the previous good release
#   infra/scripts/deploy.sh --status                              # print the current and previous release
#
# Steps: write infra/.env (write-env.sh, secrets from /etc/curtain/curtain.env), pull the image, take a
# pre-deploy backup, run migrations in a one-off container, swap the api, publish the web release into
# the caddy volume, then check /readyz inside the container and https://api.<domain>/healthz through
# Caddy. Any failure after the swap puts the previous image and web release back.
#
# The marketing site (<domain>, apps/site) is a release of its own (--site-release, published into the
# site volume). It never blocks the plugin: without --site-release the current site stays as it is, and a
# failed site publish or a site that does not answer only logs a warning. A rollback puts the site
# release of the previous deploy back together with its image and web release.
#
# infra/Caddyfile serves all four hosts, so a bad one would take app and api down too. Before anything
# else the deploy validates it with the stack's Caddy image and stops, untouched, if it does not
# validate. The last Caddyfile of a good deploy is kept in .deploy/Caddyfile.good: a changed Caddyfile
# recreates the caddy container (the bind mount would not see the new file otherwise), and a failed
# health check puts Caddyfile.good back before the rollback.
#
# Migrations are forward-only. A rollback restores the previous image on the NEW schema, which works
# because migrations stay additive (docs/DEPLOY.md, "Rollback"). A destructive migration needs a restore.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
STATE_DIR="$HERE/.deploy"
WEB_RELEASES="${WEB_RELEASES:-$(cd "$HERE/.." && pwd)/web/releases}"
SITE_RELEASES="${SITE_RELEASES:-$(cd "$HERE/.." && pwd)/site/releases}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.9-alpine}"
HEALTH_TRIES="${HEALTH_TRIES:-40}"
HEALTH_SLEEP="${HEALTH_SLEEP:-3}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
# Test and recovery knobs: DEPLOY_SKIP_PULL=1 uses images already on the host (a locally built tag);
# PUBLIC_HEALTH_URL / HEALTH_CURL_OPTS point the public check elsewhere (a local drill with Caddy's
# internal CA needs --cacert or -k); PUBLIC_SITE_URL does the same for the site check. Production leaves
# them unset.
DEPLOY_SKIP_PULL="${DEPLOY_SKIP_PULL:-0}"
PROJECT="curtain"

DOMAIN=""
IMAGE_REPO=""
TAG=""
WEB_RELEASE=""
SITE_RELEASE=""
MODE="deploy"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --image-repo) IMAGE_REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --web-release) WEB_RELEASE="$2"; shift 2 ;;
    --site-release) SITE_RELEASE="$2"; shift 2 ;;
    --rollback) MODE="rollback"; shift ;;
    --status) MODE="status"; shift ;;
    *) echo "deploy: unknown argument $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$STATE_DIR"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# State files hold "IMAGE WEB_RELEASE_DIR SITE_RELEASE_DIR" on one line, "-" for an empty field (files
# written before the site existed have two fields; the site then reads as empty).
read_state() {
  local image="" web="" site=""
  if [ -f "$STATE_DIR/$1" ]; then read -r image web site < "$STATE_DIR/$1" || true; fi
  [ "$image" = - ] && image=""
  [ "$web" = - ] && web=""
  [ "$site" = - ] && site=""
  if [ -n "$image$web$site" ]; then printf '%s %s %s\n' "${image:--}" "${web:--}" "${site:--}"; fi
}
# Parse a state line into STATE_IMAGE, STATE_WEB, STATE_SITE (empty for "-").
parse_state() {
  STATE_IMAGE="" STATE_WEB="" STATE_SITE=""
  read -r STATE_IMAGE STATE_WEB STATE_SITE <<< "$1" || true
  [ "$STATE_IMAGE" = - ] && STATE_IMAGE=""
  [ "$STATE_WEB" = - ] && STATE_WEB=""
  [ "$STATE_SITE" = - ] && STATE_SITE=""
  return 0
}
write_state() { printf '%s %s %s\n' "${2:--}" "${3:--}" "${4:--}" > "$STATE_DIR/$1.tmp" && mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

if [ "$MODE" = "status" ]; then
  echo "current:  $(read_state current)"
  echo "previous: $(read_state previous)"
  exit 0
fi

[ -n "$DOMAIN" ] || { echo "deploy: --domain is required" >&2; exit 2; }

compose() { docker compose -p "$PROJECT" "$@"; }

CADDY_GOOD="$STATE_DIR/Caddyfile.good"
# Parse and provision-check infra/Caddyfile with the image the stack runs (no ports, no certificates).
validate_caddyfile() {
  docker run --rm -e DOMAIN="$DOMAIN" -e ACME_EMAIL=ops@example.test \
    -v "$HERE/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
}
caddyfile_changed() { ! cmp -s "$HERE/Caddyfile" "$CADDY_GOOD"; }
# Start caddy; recreate it when the Caddyfile changed (rsync replaces the file, the running container
# keeps reading the old one through its bind mount).
up_caddy() {
  if caddyfile_changed; then
    log "Caddyfile changed: recreating caddy"
    compose up -d --no-deps --force-recreate caddy
  else
    compose up -d caddy
  fi
}
# Put the last good Caddyfile back (cp keeps the inode the bind mount points at) and reload caddy on it.
restore_caddyfile() {
  if [ -f "$CADDY_GOOD" ] && caddyfile_changed; then
    log "restoring the last good Caddyfile"
    cp "$CADDY_GOOD" "$HERE/Caddyfile"
    compose up -d --no-deps --force-recreate caddy
  fi
}

# Publish a web release into the caddy volume without a broken window: hashed assets first, the
# entry points (index.html, sw.js) last, then prune files that belong to neither this release nor
# the one before it (a tab that loaded the old index.html can still fetch its chunks).
publish_web() {
  local release="$1" previous="${2:-}"
  [ -f "$release/index.html" ] || { echo "deploy: no index.html in $release" >&2; return 1; }
  local prev_mount=()
  if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$release" ]; then
    prev_mount=(-v "$previous:/prev:ro")
  fi
  docker volume create "${PROJECT}_web" >/dev/null
  docker run --rm --network none --entrypoint sh \
    -v "${PROJECT}_web:/srv/web" -v "$release:/src:ro" "${prev_mount[@]}" "$CADDY_IMAGE" -euc '
      cd /src
      find . -type d -exec mkdir -p /srv/web/{} \;
      find . -type f ! -path ./index.html ! -path ./sw.js -exec cp -p {} /srv/web/{} \;
      for f in sw.js index.html; do
        if [ -f "$f" ]; then cp -p "$f" "/srv/web/$f.next" && mv -f "/srv/web/$f.next" "/srv/web/$f"; fi
      done
      cd /srv/web
      find . -type f | while read -r f; do
        [ -e "/src/$f" ] || [ -e "/prev/$f" ] || rm -f "$f"
      done
      find . -mindepth 1 -type d -empty -delete
    '
}

# Publish a site release into the site volume the same way: every file except the pages first (hashed CSS
# and JS, fonts, images), then each HTML page through a rename, so a page never points at a file that is
# not there yet; then prune what belongs to neither this release nor the previous one.
publish_site() {
  local release="$1" previous="${2:-}"
  if [ ! -f "$release/index.html" ] || [ ! -f "$release/404.html" ]; then echo "deploy: no index.html and 404.html in $release" >&2; return 1; fi
  local prev_mount=()
  if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$release" ]; then
    prev_mount=(-v "$previous:/prev:ro")
  fi
  docker volume create "${PROJECT}_site" >/dev/null
  docker run --rm --network none --entrypoint sh \
    -v "${PROJECT}_site:/srv/site" -v "$release:/src:ro" "${prev_mount[@]}" "$CADDY_IMAGE" -euc '
      cd /src
      find . -type d -exec mkdir -p /srv/site/{} \;
      find . -type f ! -name "*.html" -exec cp -p {} /srv/site/{} \;
      find . -type f -name "*.html" | while read -r f; do
        cp -p "$f" "/srv/site/$f.next" && mv -f "/srv/site/$f.next" "/srv/site/$f"
      done
      cd /srv/site
      find . -type f | while read -r f; do
        [ -e "/src/$f" ] || [ -e "/prev/$f" ] || rm -f "$f"
      done
      find . -mindepth 1 -type d -empty -delete
    '
}

# The site must never fail a deploy or a rollback: on error, say so and leave the site volume as it was.
try_publish_site() {
  local release="$1" previous="${2:-}"
  if publish_site "$release" "$previous"; then
    log "site $(basename "$release") published"
    return 0
  fi
  log "WARNING: publishing the site $(basename "$release") failed; app and api are not affected, the site keeps its previous files"
  return 1
}

# Report (never fail) whether https://<domain>/ answers after a site publish.
check_site() {
  local url="${PUBLIC_SITE_URL:-https://$DOMAIN/}" _
  local opts=()
  # shellcheck disable=SC2206 # a deliberate word list
  [ -n "${HEALTH_CURL_OPTS:-}" ] && opts=(${HEALTH_CURL_OPTS})
  for _ in 1 2 3 4 5; do
    if curl -fsS --max-time 10 "${opts[@]}" -o /dev/null "$url" >/dev/null 2>&1; then
      log "$url ok"
      return 0
    fi
    sleep "$HEALTH_SLEEP"
  done
  log "WARNING: $url did not answer (DNS for <domain> not pointing here yet?); app and api are not affected"
  return 0
}

wait_ready() {
  local _
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if compose exec -T api wget -qO- http://127.0.0.1:3000/readyz >/dev/null 2>&1; then
      log "api /readyz ok"
      return 0
    fi
    sleep "$HEALTH_SLEEP"
  done
  log "api /readyz failed after $HEALTH_TRIES tries"
  return 1
}

wait_public() {
  local url="${PUBLIC_HEALTH_URL:-https://api.$DOMAIN/healthz}" _
  local opts=()
  # shellcheck disable=SC2206 # a deliberate word list
  [ -n "${HEALTH_CURL_OPTS:-}" ] && opts=(${HEALTH_CURL_OPTS})
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if curl -fsS --max-time 10 "${opts[@]}" "$url" >/dev/null 2>&1; then
      log "$url ok"
      return 0
    fi
    sleep "$HEALTH_SLEEP"
  done
  log "$url failed after $HEALTH_TRIES tries"
  return 1
}

# Bring a release (image + web dir + site dir) up. No migrations: used for rollbacks.
activate() {
  local image="$1" web="$2" previous_web="${3:-}" site="${4:-}" previous_site="${5:-}"
  "$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$image"
  compose up -d --remove-orphans postgres api
  compose up -d caddy
  if [ -n "$web" ]; then publish_web "$web" "$previous_web"; fi
  if [ -n "$site" ] && [ "$site" != "$previous_site" ]; then try_publish_site "$site" "$previous_site" || true; fi
}

rollback_to() {
  local image="$1" web="$2" failed_web="${3:-}" site="${4:-}" failed_site="${5:-}"
  if [ -z "$image" ]; then
    log "no previous release recorded; nothing to roll back to"
    return 1
  fi
  log "rolling back to $image ${web:+(web $(basename "$web"))} ${site:+(site $(basename "$site"))}"
  activate "$image" "$web" "$failed_web" "$site" "$failed_site"
  wait_ready && wait_public
}

if [ "$MODE" = "rollback" ]; then
  parse_state "$(read_state previous)"
  PREV_IMAGE="$STATE_IMAGE" PREV_WEB="$STATE_WEB" PREV_SITE="$STATE_SITE"
  parse_state "$(read_state current)"
  CUR_IMAGE="$STATE_IMAGE" CUR_WEB="$STATE_WEB" CUR_SITE="$STATE_SITE"
  # A deploy before the site existed recorded no site: keep the one that is up rather than emptying it.
  [ -n "$PREV_SITE" ] || PREV_SITE="$CUR_SITE"
  rollback_to "$PREV_IMAGE" "$PREV_WEB" "$CUR_WEB" "$PREV_SITE" "$CUR_SITE"
  write_state current "$PREV_IMAGE" "$PREV_WEB" "$PREV_SITE"
  write_state previous "$CUR_IMAGE" "$CUR_WEB" "$CUR_SITE"
  log "rolled back; current is now $PREV_IMAGE"
  exit 0
fi

[ -n "$IMAGE_REPO" ] || { echo "deploy: --image-repo is required" >&2; exit 2; }
[ -n "$TAG" ] || { echo "deploy: --tag is required" >&2; exit 2; }
NEW_IMAGE="$IMAGE_REPO:$TAG"
parse_state "$(read_state current)"
CUR_IMAGE="$STATE_IMAGE" CUR_WEB="$STATE_WEB" CUR_SITE="$STATE_SITE"
if [ -n "$WEB_RELEASE" ]; then WEB_RELEASE="$(cd "$WEB_RELEASE" && pwd)"; else WEB_RELEASE="$CUR_WEB"; fi
NEW_SITE=0
if [ -n "$SITE_RELEASE" ] && [ -d "$SITE_RELEASE" ]; then
  SITE_RELEASE="$(cd "$SITE_RELEASE" && pwd)"
  if [ "$SITE_RELEASE" != "$CUR_SITE" ]; then NEW_SITE=1; fi
else
  if [ -n "$SITE_RELEASE" ]; then log "WARNING: site release $SITE_RELEASE not found; keeping the current site"; fi
  SITE_RELEASE="$CUR_SITE"
fi

log "deploying $NEW_IMAGE ${WEB_RELEASE:+(web $(basename "$WEB_RELEASE"))} ${SITE_RELEASE:+(site $(basename "$SITE_RELEASE"))}; current: ${CUR_IMAGE:-none}"

"$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$NEW_IMAGE"

# The new api image must come from the registry. Caddy and Postgres are pinned tags that are normally
# already here: a Docker Hub outage or its anonymous rate limit (429) must not block a deploy, or an
# emergency fix, when the host has them. Only an image that is missing locally is fatal.
pull_images() {
  compose pull --quiet api || return 1
  local img
  for img in $(compose config --images caddy postgres | sort -u); do
    [ "$img" = "$NEW_IMAGE" ] && continue
    if ! docker pull -q "$img" >/dev/null; then
      if docker image inspect "$img" >/dev/null 2>&1; then
        log "WARNING: could not pull $img (registry down or rate limited); using the copy already on this host"
      else
        log "could not pull $img and it is not on this host"
        return 1
      fi
    fi
  done
}

if [ "$DEPLOY_SKIP_PULL" = 1 ]; then
  log "DEPLOY_SKIP_PULL=1: using images already on this host"
else
  log "pulling images"
  if ! pull_images; then
    log "pulling images failed; nothing was changed on the running stack"
    [ -n "$CUR_IMAGE" ] && "$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$CUR_IMAGE"
    exit 1
  fi
fi

log "validating infra/Caddyfile"
if ! validate_caddyfile; then
  log "infra/Caddyfile does not validate; nothing was changed on the running stack"
  if [ -f "$CADDY_GOOD" ]; then cp "$CADDY_GOOD" "$HERE/Caddyfile"; log "put the last good Caddyfile back in infra/"; fi
  [ -n "$CUR_IMAGE" ] && "$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$CUR_IMAGE"
  exit 1
fi

compose up -d postgres
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q postgres)" 2>/dev/null)" = "healthy" ] && break
  sleep 2
done

# Pre-deploy backup, kept locally next to the nightly ones. Skipped (with a note) until the age
# recipient is configured, so the very first deploy is not blocked on backups.
if [ -n "$CUR_IMAGE" ]; then
  if grep -qE '^BACKUP_AGE_RECIPIENT=age1' "$HERE/.env"; then
    log "pre-deploy backup"
    "$HERE/scripts/backup.sh" --label predeploy --local-only
  else
    log "note: BACKUP_AGE_RECIPIENT not set; skipping the pre-deploy backup"
  fi
fi

log "running migrations"
if ! compose run --rm --no-deps -T api node dist/migrate.js; then
  log "migrations failed; the running api was not touched"
  [ -n "$CUR_IMAGE" ] && "$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$CUR_IMAGE"
  exit 1
fi

log "starting the new api"
compose up -d --remove-orphans api
up_caddy
if [ -n "$WEB_RELEASE" ]; then
  log "publishing web $(basename "$WEB_RELEASE")"
  publish_web "$WEB_RELEASE" "$CUR_WEB"
fi
if [ "$NEW_SITE" = 1 ]; then
  log "publishing site $(basename "$SITE_RELEASE")"
  if try_publish_site "$SITE_RELEASE" "$CUR_SITE"; then check_site; else SITE_RELEASE="$CUR_SITE"; fi
fi

if wait_ready && wait_public; then
  if [ "$CUR_IMAGE" != "$NEW_IMAGE" ] || [ "$CUR_WEB" != "$WEB_RELEASE" ] || [ "$CUR_SITE" != "$SITE_RELEASE" ]; then
    [ -n "$CUR_IMAGE" ] && write_state previous "$CUR_IMAGE" "$CUR_WEB" "$CUR_SITE"
  fi
  write_state current "$NEW_IMAGE" "$WEB_RELEASE" "$SITE_RELEASE"
  cp "$HERE/Caddyfile" "$CADDY_GOOD.tmp" && mv "$CADDY_GOOD.tmp" "$CADDY_GOOD"
  log "deploy ok: $NEW_IMAGE${SITE_RELEASE:+ (site $(basename "$SITE_RELEASE"))}"

  # Housekeeping: keep the newest web releases (current and previous always survive) and drop
  # api images that no container uses.
  parse_state "$(read_state previous)"
  PREV_IMAGE="$STATE_IMAGE" PREV_WEB="$STATE_WEB" PREV_SITE="$STATE_SITE"
  if [ -d "$WEB_RELEASES" ]; then
    find "$WEB_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP_RELEASES + 1))" | cut -d' ' -f2- |
      while read -r dir; do
        [ "$dir" = "$WEB_RELEASE" ] || [ "$dir" = "$PREV_WEB" ] || rm -rf "$dir"
      done
  fi
  if [ -d "$SITE_RELEASES" ]; then
    find "$SITE_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP_RELEASES + 1))" | cut -d' ' -f2- |
      while read -r dir; do
        [ "$dir" = "$SITE_RELEASE" ] || [ "$dir" = "$PREV_SITE" ] || rm -rf "$dir"
      done
  fi
  # The previous image stays local: a rollback must not need registry credentials.
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE_REPO" | while read -r img; do
    [ "$img" = "$NEW_IMAGE" ] || [ "$img" = "${PREV_IMAGE:-}" ] || docker image rm "$img" >/dev/null 2>&1 || true
  done
  compose ps
  exit 0
fi

log "health check failed; recent api logs:"
compose logs --tail=60 api || true
compose logs --tail=30 caddy || true
restore_caddyfile
if [ -n "$CUR_IMAGE" ]; then
  if rollback_to "$CUR_IMAGE" "$CUR_WEB" "$WEB_RELEASE" "$CUR_SITE" "$SITE_RELEASE"; then
    log "rolled back to $CUR_IMAGE"
  else
    log "ROLLBACK ALSO FAILED: check the server"
  fi
else
  log "first deploy failed; there is no previous release to roll back to"
fi
exit 1

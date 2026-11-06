#!/usr/bin/env bash
# Deploy on the VPS (D9), run by .github/workflows/deploy.yml through scripts/deploy.sh, or by hand.
#
#   infra/scripts/deploy.sh --domain <domain> --image-repo ghcr.io/<owner>/curtain-api --tag <tag> [--web-release <dir>]
#   infra/scripts/deploy.sh --domain <domain> --rollback          # back to the previous good release
#   infra/scripts/deploy.sh --status                              # print the current and previous release
#
# Steps: write infra/.env (write-env.sh, secrets from /etc/curtain/curtain.env), pull the image, take a
# pre-deploy backup, run migrations in a one-off container, swap the api, publish the web release into
# the caddy volume, then check /readyz inside the container and https://api.<domain>/healthz through
# Caddy. Any failure after the swap puts the previous image and web release back.
#
# Migrations are forward-only. A rollback restores the previous image on the NEW schema, which works
# because migrations stay additive (docs/DEPLOY.md, "Rollback"). A destructive migration needs a restore.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
STATE_DIR="$HERE/.deploy"
WEB_RELEASES="${WEB_RELEASES:-$(cd "$HERE/.." && pwd)/web/releases}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.9-alpine}"
HEALTH_TRIES="${HEALTH_TRIES:-40}"
HEALTH_SLEEP="${HEALTH_SLEEP:-3}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
# Test and recovery knobs: DEPLOY_SKIP_PULL=1 uses images already on the host (a locally built tag);
# PUBLIC_HEALTH_URL / HEALTH_CURL_OPTS point the public check elsewhere (a local drill with Caddy's
# internal CA needs --cacert or -k). Production leaves all three unset.
DEPLOY_SKIP_PULL="${DEPLOY_SKIP_PULL:-0}"
PROJECT="curtain"

DOMAIN=""
IMAGE_REPO=""
TAG=""
WEB_RELEASE=""
MODE="deploy"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --image-repo) IMAGE_REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --web-release) WEB_RELEASE="$2"; shift 2 ;;
    --rollback) MODE="rollback"; shift ;;
    --status) MODE="status"; shift ;;
    *) echo "deploy: unknown argument $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$STATE_DIR"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# State files hold "IMAGE WEB_RELEASE_DIR" on one line.
read_state() { if [ -f "$STATE_DIR/$1" ]; then cat "$STATE_DIR/$1"; fi; }
write_state() { printf '%s %s\n' "$2" "$3" > "$STATE_DIR/$1.tmp" && mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

if [ "$MODE" = "status" ]; then
  echo "current:  $(read_state current)"
  echo "previous: $(read_state previous)"
  exit 0
fi

[ -n "$DOMAIN" ] || { echo "deploy: --domain is required" >&2; exit 2; }

compose() { docker compose -p "$PROJECT" "$@"; }

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

# Bring a release (image + web dir) up. No migrations: used for rollbacks.
activate() {
  local image="$1" web="$2" previous_web="${3:-}"
  "$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$image"
  compose up -d --remove-orphans postgres api
  compose up -d caddy
  if [ -n "$web" ]; then publish_web "$web" "$previous_web"; fi
}

rollback_to() {
  local image="$1" web="$2" failed_web="${3:-}"
  if [ -z "$image" ]; then
    log "no previous release recorded; nothing to roll back to"
    return 1
  fi
  log "rolling back to $image ${web:+(web $(basename "$web"))}"
  activate "$image" "$web" "$failed_web"
  wait_ready && wait_public
}

if [ "$MODE" = "rollback" ]; then
  read -r PREV_IMAGE PREV_WEB <<< "$(read_state previous)" || true
  read -r CUR_IMAGE CUR_WEB <<< "$(read_state current)" || true
  rollback_to "${PREV_IMAGE:-}" "${PREV_WEB:-}" "${CUR_WEB:-}"
  write_state current "$PREV_IMAGE" "${PREV_WEB:-}"
  write_state previous "${CUR_IMAGE:-}" "${CUR_WEB:-}"
  log "rolled back; current is now $PREV_IMAGE"
  exit 0
fi

[ -n "$IMAGE_REPO" ] || { echo "deploy: --image-repo is required" >&2; exit 2; }
[ -n "$TAG" ] || { echo "deploy: --tag is required" >&2; exit 2; }
NEW_IMAGE="$IMAGE_REPO:$TAG"
read -r CUR_IMAGE CUR_WEB <<< "$(read_state current)" || true
CUR_IMAGE="${CUR_IMAGE:-}"
CUR_WEB="${CUR_WEB:-}"
if [ -n "$WEB_RELEASE" ]; then WEB_RELEASE="$(cd "$WEB_RELEASE" && pwd)"; else WEB_RELEASE="$CUR_WEB"; fi

log "deploying $NEW_IMAGE ${WEB_RELEASE:+(web $(basename "$WEB_RELEASE"))}; current: ${CUR_IMAGE:-none}"

"$HERE/scripts/write-env.sh" --domain "$DOMAIN" --image "$NEW_IMAGE"

if [ "$DEPLOY_SKIP_PULL" = 1 ]; then
  log "DEPLOY_SKIP_PULL=1: using images already on this host"
else
  log "pulling images"
  compose pull --quiet api caddy postgres
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
compose up -d caddy
if [ -n "$WEB_RELEASE" ]; then
  log "publishing web $(basename "$WEB_RELEASE")"
  publish_web "$WEB_RELEASE" "$CUR_WEB"
fi

if wait_ready && wait_public; then
  if [ "$CUR_IMAGE" != "$NEW_IMAGE" ] || [ "$CUR_WEB" != "$WEB_RELEASE" ]; then
    [ -n "$CUR_IMAGE" ] && write_state previous "$CUR_IMAGE" "$CUR_WEB"
  fi
  write_state current "$NEW_IMAGE" "$WEB_RELEASE"
  log "deploy ok: $NEW_IMAGE"

  # Housekeeping: keep the newest web releases (current and previous always survive) and drop
  # api images that no container uses.
  if [ -d "$WEB_RELEASES" ]; then
    read -r _ PREV_WEB <<< "$(read_state previous)" || true
    find "$WEB_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +"$((KEEP_RELEASES + 1))" | cut -d' ' -f2- |
      while read -r dir; do
        [ "$dir" = "$WEB_RELEASE" ] || [ "$dir" = "${PREV_WEB:-}" ] || rm -rf "$dir"
      done
  fi
  # The previous image stays local: a rollback must not need registry credentials.
  read -r PREV_IMAGE _ <<< "$(read_state previous)" || true
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$IMAGE_REPO" | while read -r img; do
    [ "$img" = "$NEW_IMAGE" ] || [ "$img" = "${PREV_IMAGE:-}" ] || docker image rm "$img" >/dev/null 2>&1 || true
  done
  compose ps
  exit 0
fi

log "health check failed; recent api logs:"
compose logs --tail=60 api || true
if [ -n "$CUR_IMAGE" ]; then
  if rollback_to "$CUR_IMAGE" "$CUR_WEB" "$WEB_RELEASE"; then
    log "rolled back to $CUR_IMAGE"
  else
    log "ROLLBACK ALSO FAILED: check the server"
  fi
else
  log "first deploy failed; there is no previous release to roll back to"
fi
exit 1

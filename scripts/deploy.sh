#!/usr/bin/env bash
# Ship a release to the VPS from a GitHub runner (.github/workflows/deploy.yml) or a laptop.
#
#   scripts/deploy.sh deploy     sync infra/, the web bundle and the site, then run infra/scripts/deploy.sh there
#   scripts/deploy.sh rollback   run infra/scripts/deploy.sh --rollback there
#   scripts/deploy.sh status     print the current and previous release on the server
#
# Environment:
#   VPS_HOST, VPS_USER           where to ssh (the key and known_hosts come from ~/.ssh or SSH_OPTS)
#   VPS_PORT                     optional, default 22
#   DOMAIN                       serves <DOMAIN> (the site), www.<DOMAIN>, app.<DOMAIN> and api.<DOMAIN>
#   IMAGE_REPO, TAG              deploy only: ghcr.io/<owner>/curtain-api and the tag to run
#   WEB_DIST                     deploy only, optional: a built apps/web/dist to publish
#   SITE_DIST                    deploy only, optional: apps/site/dist from `build:release` to publish on
#                                <DOMAIN>. Left out, or not a release build (no matching curtain-release.txt,
#                                infra/scripts/site-release-check.sh): the site on the server stays as it is
#                                and app/api deploy as usual; the site never blocks the plugin.
#   GHCR_USER, GHCR_TOKEN        optional: a registry login used for this pull only (logged out after);
#                                the token goes over ssh stdin, never on a command line
#   REMOTE_DIR                   optional, default /opt/curtain
# No secret is copied to the server: infra/.env is written there from /etc/curtain/curtain.env.
set -euo pipefail

ACTION="${1:-deploy}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/opt/curtain}"
VPS_PORT="${VPS_PORT:-22}"

MISSING=()
for v in VPS_HOST VPS_USER DOMAIN; do [ -n "${!v:-}" ] || MISSING+=("$v"); done
if [ "$ACTION" = "deploy" ]; then
  for v in IMAGE_REPO TAG; do [ -n "${!v:-}" ] || MISSING+=("$v"); done
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "deploy: missing environment: ${MISSING[*]}" >&2
  exit 2
fi
[[ "${TAG:-x}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "deploy: TAG has unexpected characters" >&2; exit 2; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "deploy: DOMAIN has unexpected characters" >&2; exit 2; }
# Only names with 3+ labels: app.curtain.fit is refused, an apex such as api.co still passes (api.co.uk would not: no public-suffix list here).
case "$DOMAIN" in
  www.*.*|app.*.*|api.*.*) echo "deploy: DOMAIN must be the bare domain (e.g. curtain.fit), not $DOMAIN; www., app. and api. are added by the stack" >&2; exit 2 ;;
esac

# shellcheck disable=SC2206 # SSH_OPTS is a deliberate word list
SSH=(ssh -p "$VPS_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 ${SSH_OPTS:-})
TARGET="${VPS_USER}@${VPS_HOST:?}"
remote() { "${SSH[@]}" "$TARGET" "$@"; }
REMOTE_DEPLOY="$REMOTE_DIR/infra/scripts/deploy.sh"

case "$ACTION" in
  status)
    remote "$(printf '%q --domain %q --status' "$REMOTE_DEPLOY" "$DOMAIN")"
    exit 0
    ;;
  rollback)
    echo "→ rolling back on $VPS_HOST"
    remote "$(printf '%q --domain %q --rollback' "$REMOTE_DEPLOY" "$DOMAIN")"
    exit 0
    ;;
  deploy) ;;
  *) echo "usage: $0 deploy|rollback|status" >&2; exit 2 ;;
esac

RSYNC_SSH="${SSH[*]}"

echo "→ syncing infra/ to $VPS_HOST:$REMOTE_DIR/infra (never .env)"
remote "mkdir -p $(printf '%q' "$REMOTE_DIR")/infra $(printf '%q' "$REMOTE_DIR")/web/releases $(printf '%q' "$REMOTE_DIR")/site/releases"
# Servers deployed before Caddyfile.good existed: keep the Caddyfile they run now as the last good one,
# so a failed deploy of a changed Caddyfile can go back to it (infra/scripts/deploy.sh, restore_caddyfile).
remote "cd $(printf '%q' "$REMOTE_DIR")/infra && if [ -f .deploy/current ] && [ -f Caddyfile ] && [ ! -f .deploy/Caddyfile.good ]; then cp Caddyfile .deploy/Caddyfile.good; fi"
rsync -rlptz --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e "$RSYNC_SSH" \
  "$ROOT/infra/Caddyfile" "$ROOT/infra/docker-compose.yml" "$ROOT/infra/.env.example" \
  "$TARGET:$REMOTE_DIR/infra/"
rsync -rlptz --delete --chmod=Du=rwx,Dgo=rx,Fu=rwx,Fgo=rx -e "$RSYNC_SSH" \
  "$ROOT/infra/scripts/" "$TARGET:$REMOTE_DIR/infra/scripts/"

WEB_ARGS=""
if [ -n "${WEB_DIST:-}" ]; then
  [ -f "$WEB_DIST/index.html" ] || { echo "deploy: no index.html in $WEB_DIST" >&2; exit 1; }
  RELEASE="$REMOTE_DIR/web/releases/$TAG"
  echo "→ uploading the web bundle to $RELEASE"
  rsync -rlptz --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e "$RSYNC_SSH" "$WEB_DIST/" "$TARGET:$RELEASE/"
  WEB_ARGS="$(printf ' --web-release %q' "$RELEASE")"
fi

SITE_ARGS=""
if [ -n "${SITE_DIST:-}" ]; then
  # Only a build:release with every launch gate closed is published (it writes curtain-release.txt); a preview
  # build in apps/site/dist, e.g. after `pnpm check`, is skipped with a warning.
  if "$ROOT/infra/scripts/site-release-check.sh" "$SITE_DIST"; then
    SITE_RELEASE="$REMOTE_DIR/site/releases/$TAG"
    echo "→ uploading the site to $SITE_RELEASE"
    if rsync -rlptz --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r -e "$RSYNC_SSH" "$SITE_DIST/" "$TARGET:$SITE_RELEASE/"; then
      SITE_ARGS="$(printf ' --site-release %q' "$SITE_RELEASE")"
    else
      echo "WARNING: uploading the site failed; deploying app and api without it (the site on the server stays as it is)" >&2
    fi
  else
    echo "WARNING: $SITE_DIST is not a site release build (see above); deploying app and api without it" >&2
  fi
else
  echo "→ no SITE_DIST: the site on the server stays as it is"
fi

LOGGED_IN=0
logout_registry() {
  if [ "$LOGGED_IN" = 1 ]; then remote "docker logout ghcr.io >/dev/null" || true; fi
}
trap logout_registry EXIT
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "→ registry login on the server for this pull"
  printf '%s' "$GHCR_TOKEN" | remote "$(printf 'docker login ghcr.io -u %q --password-stdin >/dev/null' "${GHCR_USER:-token}")"
  LOGGED_IN=1
fi

echo "→ running the server-side deploy"
remote "$(printf '%q --domain %q --image-repo %q --tag %q' "$REMOTE_DEPLOY" "$DOMAIN" "$IMAGE_REPO" "$TAG")$WEB_ARGS$SITE_ARGS"

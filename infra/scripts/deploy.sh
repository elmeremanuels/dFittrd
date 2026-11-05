#!/usr/bin/env bash
# Deploy on the VPS: pull the api image, migrate + restart, rsync the web bundle into the Caddy volume.
# Usage: infra/scripts/deploy.sh [--web-dist path/to/apps/web/dist] [--tag <image tag>]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
[ -f .env ] || { echo "infra/.env missing (copy .env.example)"; exit 1; }
set -a; source .env; set +a

WEB_DIST=""
TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --web-dist) WEB_DIST="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown arg $1"; exit 1 ;;
  esac
done

if [ -n "$TAG" ]; then
  export API_IMAGE="${API_IMAGE%%:*}:$TAG"
  echo "→ using $API_IMAGE"
fi

echo "→ pulling images"
docker compose pull --quiet

echo "→ starting postgres + api (the api runs migrations before listening)"
docker compose up -d --remove-orphans postgres api
docker compose up -d caddy

if [ -n "$WEB_DIST" ]; then
  [ -f "$WEB_DIST/index.html" ] || { echo "no index.html in $WEB_DIST"; exit 1; }
  echo "→ rsyncing web bundle into the caddy volume"
  VOL="$(docker volume inspect -f '{{.Mountpoint}}' curtain_web)"
  rsync -a --delete --exclude '.DS_Store' "$WEB_DIST/" "$VOL/"
  # index.html and sw.js are served no-cache; hashed assets are immutable.
fi

echo "→ waiting for /readyz"
for i in $(seq 1 30); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/readyz >/dev/null 2>&1; then
    echo "✓ api ready"; docker compose ps; exit 0
  fi
  sleep 2
done
echo "✗ api did not become ready; recent logs:"; docker compose logs --tail=50 api; exit 1

#!/usr/bin/env bash
# Validate infra/Caddyfile with the same Caddy image the stack runs (not part of CI; run it on the VPS
# or any machine with Docker before the first deploy that carries the /assets block).
#
#   infra/scripts/caddy-validate.sh            # DOMAIN defaults to example.test
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
image="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy:[^[:space:]]*\).*/\1/p' "$here/docker-compose.yml" | head -n1)"
docker run --rm \
  -e DOMAIN="${DOMAIN:-example.test}" -e ACME_EMAIL="${ACME_EMAIL:-ops@example.test}" \
  -v "$here/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "${image:-caddy:2.9-alpine}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

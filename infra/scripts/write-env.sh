#!/usr/bin/env bash
# Build infra/.env on the VPS from three layers, last one wins per key:
#   1. infra/.env.example                 non-secret defaults that ship with the repo
#   2. $SECRETS_FILE (/etc/curtain/curtain.env)   the secrets, written once on the server by the founder
#                                         (scripts/deploy-bootstrap.sh generates the random ones there)
#   3. the deploy's own values            DOMAIN and API_IMAGE, passed as arguments
# No secret ever comes from the repository or from GitHub. The result is mode 600.
#
# Usage: infra/scripts/write-env.sh --domain <domain> --image <ghcr.io/owner/curtain-api:tag> [--secrets <file>] [--out <file>]
# Exits 1 and names every missing required key when the secrets file is incomplete.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-/etc/curtain/curtain.env}"
OUT="$HERE/.env"
DOMAIN=""
IMAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --secrets) SECRETS_FILE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "write-env: unknown argument $1" >&2; exit 2 ;;
  esac
done

[ -n "$DOMAIN" ] || { echo "write-env: --domain is required" >&2; exit 2; }
[ -n "$IMAGE" ] || { echo "write-env: --image is required" >&2; exit 2; }
[ -f "$HERE/.env.example" ] || { echo "write-env: $HERE/.env.example missing (sync infra/ first)" >&2; exit 1; }
[ -r "$SECRETS_FILE" ] || { echo "write-env: secrets file $SECRETS_FILE missing or unreadable (scripts/deploy-bootstrap.sh creates it)" >&2; exit 1; }

# A secrets file that other users can read is a finding, not a blocker on a single-user VPS.
MODE="$(stat -c %a "$SECRETS_FILE")"
case "$MODE" in
  600|640|400|440) ;;
  *) echo "write-env: warning: $SECRETS_FILE has mode $MODE; chmod 600 it" >&2 ;;
esac

TMP="$(mktemp "$HERE/.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"

# Merge KEY=VALUE lines, keeping the first-seen order of keys and the last value of each.
{
  cat "$HERE/.env.example"
  echo
  cat "$SECRETS_FILE"
  echo
  printf 'DOMAIN=%s\n' "$DOMAIN"
  printf 'API_IMAGE=%s\n' "$IMAGE"
} | awk '
  /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
  {
    line = $0
    sub(/^[[:space:]]*export[[:space:]]+/, "", line)
    eq = index(line, "=")
    if (eq < 2) next
    key = substr(line, 1, eq - 1)
    if (!(key in val)) order[++n] = key
    val[key] = line
  }
  END { for (i = 1; i <= n; i++) print val[order[i]] }
' > "$TMP"

# value KEY → the value as compose reads it (an unquoted value ends at " #").
value() {
  local line
  line="$(grep -E "^$1=" "$TMP" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%%[[:space:]]#*}"
  line="${line%"${line##*[![:space:]]}"}"
  line="${line#\"}"; line="${line%\"}"
  printf '%s' "$line"
}

MISSING=()
for key in POSTGRES_PASSWORD JWT_SECRET SHOP_KEY_PEPPER ENCRYPTION_KEY ACME_EMAIL; do
  [ -n "$(value "$key")" ] || MISSING+=("$key")
done
case "$(value ACME_EMAIL)" in
  *@example.com) MISSING+=("ACME_EMAIL (still the example address)") ;;
esac
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "write-env: $SECRETS_FILE lacks these required keys:" >&2
  printf '  - %s\n' "${MISSING[@]}" >&2
  exit 1
fi

ENC="$(value ENCRYPTION_KEY)"
[[ "$ENC" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "write-env: ENCRYPTION_KEY must be 64 hex characters" >&2; exit 1; }
JWT="$(value JWT_SECRET)"
[ "${#JWT}" -ge 32 ] || { echo "write-env: JWT_SECRET must be at least 32 characters" >&2; exit 1; }

# Optional, but the pilot needs them: say so without failing the deploy.
for key in SHOPIFY_API_KEY SHOPIFY_API_SECRET BACKUP_AGE_RECIPIENT; do
  [ -n "$(value "$key")" ] || echo "write-env: note: $key is empty" >&2
done

mv "$TMP" "$OUT"
trap - EXIT
echo "write-env: wrote $OUT ($(wc -l < "$OUT") keys, DOMAIN=$DOMAIN, API_IMAGE=$IMAGE)"

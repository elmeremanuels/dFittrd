#!/usr/bin/env bash
# Nightly encrypted Postgres backup: pg_dump | age | rclone  (D9). Put in the host crontab, e.g.
#   17 3 * * * /opt/paskamer/infra/scripts/backup.sh >> /var/log/paskamer-backup.log 2>&1
# Restore: rclone copy <remote>/<file> . && age -d -i key.txt <file> | gunzip | psql "$DATABASE_URL"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
set -a; source .env; set +a
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key)}"
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE (rclone remote:path)}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

command -v age >/dev/null || { echo "age not installed (apt install age)"; exit 1; }
command -v rclone >/dev/null || { echo "rclone not installed"; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="paskamer-${STAMP}.sql.gz.age"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ dumping ${POSTGRES_DB:-paskamer}"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-paskamer}" --no-owner --no-privileges "${POSTGRES_DB:-paskamer}" \
  | gzip -9 \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$TMP/$FILE"

SIZE="$(stat -c %s "$TMP/$FILE")"
[ "$SIZE" -gt 1024 ] || { echo "✗ backup suspiciously small ($SIZE bytes)"; exit 1; }

echo "→ uploading $FILE ($SIZE bytes) to $BACKUP_RCLONE_REMOTE"
rclone copy --quiet "$TMP/$FILE" "$BACKUP_RCLONE_REMOTE/"

echo "→ pruning backups older than ${KEEP_DAYS} days"
rclone delete --quiet --min-age "${KEEP_DAYS}d" "$BACKUP_RCLONE_REMOTE/" || true
echo "✓ backup done: $FILE"

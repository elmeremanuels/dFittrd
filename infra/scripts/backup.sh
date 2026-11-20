#!/usr/bin/env bash
# Encrypted Postgres backup (D9): pg_dump | gzip | age → $BACKUP_DIR, then optionally rclone offsite.
# Nightly from /etc/cron.d/curtain-backup (scripts/deploy-bootstrap.sh installs it), and before every
# deploy from infra/scripts/deploy.sh (--label predeploy --local-only).
#
#   infra/scripts/backup.sh [--label nightly|predeploy|manual] [--local-only]
#
# infra/.env provides: BACKUP_AGE_RECIPIENT (age1… public key, required; the private key never lives on
# the VPS), BACKUP_DIR (default /var/backups/curtain), BACKUP_KEEP_DAYS (default 14, local),
# BACKUP_RCLONE_REMOTE (optional, e.g. b2:curtain-backups) and BACKUP_REMOTE_KEEP_DAYS (default 30).
# Restore and the drill: infra/scripts/restore-drill.sh and docs/DEPLOY.md, "Backups".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
LABEL="nightly"
LOCAL_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --local-only) LOCAL_ONLY=1; shift ;;
    *) echo "backup: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ "$LABEL" =~ ^[a-z0-9-]+$ ]] || { echo "backup: --label must be [a-z0-9-]" >&2; exit 2; }

[ -f .env ] || { echo "backup: infra/.env missing (run a deploy first)" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key) in /etc/curtain/curtain.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/curtain}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-30}"
DB="${POSTGRES_DB:-curtain}"
DB_USER="${POSTGRES_USER:-curtain}"

command -v age >/dev/null || { echo "backup: age not installed (apt install age)" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="curtain-${LABEL}-${STAMP}.sql.gz.age"
PART="$BACKUP_DIR/.$FILE.part"
trap 'rm -f "$PART"' EXIT

echo "→ dumping $DB"
docker compose -p curtain exec -T postgres pg_dump -U "$DB_USER" --no-owner --no-privileges "$DB" \
  | gzip -9 \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$PART"

SIZE="$(stat -c %s "$PART")"
[ "$SIZE" -gt 1024 ] || { echo "✗ backup suspiciously small ($SIZE bytes)" >&2; exit 1; }
mv "$PART" "$BACKUP_DIR/$FILE"
(cd "$BACKUP_DIR" && sha256sum "$FILE" > "$FILE.sha256")
trap - EXIT
echo "✓ $BACKUP_DIR/$FILE ($SIZE bytes)"

# Approved garment bundles (D16): the assets volume, next to the database dump.
AFILE="curtain-${LABEL}-${STAMP}.assets.tar.gz.age"
echo "→ archiving the garment assets volume"
if docker compose -p curtain exec -T api sh -c 'test -d /data/assets && tar -C /data/assets -cf - .' 2>/dev/null \
  | gzip -9 | age -r "$BACKUP_AGE_RECIPIENT" -o "$BACKUP_DIR/$AFILE"; then
  (cd "$BACKUP_DIR" && sha256sum "$AFILE" > "$AFILE.sha256")
  echo "✓ $BACKUP_DIR/$AFILE"
else
  rm -f "$BACKUP_DIR/$AFILE"
  echo "note: no garment assets archived (volume empty or api not running)"
fi

echo "→ pruning local backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'curtain-*.sql.gz.age*' -o -name 'curtain-*.assets.tar.gz.age*' \) -mtime +"$KEEP_DAYS" -delete

if [ "$LOCAL_ONLY" = 1 ] || [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
  [ "$LOCAL_ONLY" = 1 ] || echo "note: BACKUP_RCLONE_REMOTE not set; the backup stays on this server only"
  exit 0
fi

command -v rclone >/dev/null || { echo "backup: rclone not installed but BACKUP_RCLONE_REMOTE is set" >&2; exit 1; }
echo "→ uploading to $BACKUP_RCLONE_REMOTE"
rclone copy --quiet "$BACKUP_DIR/$FILE" "$BACKUP_RCLONE_REMOTE/"
rclone copy --quiet "$BACKUP_DIR/$FILE.sha256" "$BACKUP_RCLONE_REMOTE/"
[ -f "$BACKUP_DIR/${AFILE:-none}" ] && rclone copy --quiet "$BACKUP_DIR/$AFILE" "$BACKUP_RCLONE_REMOTE/" && rclone copy --quiet "$BACKUP_DIR/$AFILE.sha256" "$BACKUP_RCLONE_REMOTE/"
echo "→ pruning offsite backups older than $REMOTE_KEEP_DAYS days"
rclone delete --quiet --min-age "${REMOTE_KEEP_DAYS}d" --include 'curtain-*' "$BACKUP_RCLONE_REMOTE/" || true
echo "✓ offsite copy done"

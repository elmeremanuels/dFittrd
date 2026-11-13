#!/usr/bin/env bash
# Restore drill: decrypt a backup into a throwaway Postgres container, check it, throw it away.
# Never touches the live database. Run it monthly, and after any change to backups (docs/DEPLOY.md).
#
#   infra/scripts/restore-drill.sh <curtain-….sql.gz.age> <age identity file>
#
# The identity (private key) is NOT kept on the VPS: run this on the machine that holds it (any
# computer with docker, age and gunzip), or copy the key to the VPS for the drill and shred it after.
# Exit 0 = the dump decrypts, restores without errors, has the drizzle migration journal and the core
# tables. The row counts it prints are for your eyes (compare with the live `docker compose exec
# postgres psql`), they contain no personal data.
set -euo pipefail

BACKUP="${1:-}"
IDENTITY="${2:-}"
if [ ! -f "$BACKUP" ] || [ ! -f "$IDENTITY" ]; then echo "usage: $0 <backup.sql.gz.age> <age identity file>" >&2; exit 2; fi
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
NAME="curtain-restore-drill-$$"

command -v age >/dev/null || { echo "age not installed" >&2; exit 1; }
if [ -f "$BACKUP.sha256" ]; then
  (cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256")
fi

# shellcheck disable=SC2317 # called by the EXIT trap
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ starting a throwaway $PG_IMAGE (no network, no volume)"
docker run -d --name "$NAME" --network none -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U drill -d drill >/dev/null 2>&1 && break
  sleep 1
done
# pg_isready can answer during the init restart; wait for a real query.
for _ in $(seq 1 30); do
  docker exec "$NAME" psql -U drill -d drill -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

echo "→ restoring $(basename "$BACKUP")"
START="$(date +%s)"
age -d -i "$IDENTITY" "$BACKUP" | gunzip | docker exec -i "$NAME" psql -U drill -d drill -v ON_ERROR_STOP=1 -q >/dev/null
echo "  restored in $(( $(date +%s) - START ))s"

q() { docker exec "$NAME" psql -U drill -d drill -At -c "$1"; }

TABLES="$(q "select count(*) from information_schema.tables where table_schema = 'public'")"
MIGRATIONS="$(q "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo 0)"
echo "  public tables: $TABLES, applied migrations: $MIGRATIONS"

FAIL=0
[ "$TABLES" -gt 0 ] || { echo "✗ no tables restored"; FAIL=1; }
[ "$MIGRATIONS" -gt 0 ] || { echo "✗ no drizzle migration journal"; FAIL=1; }
for t in shops products devices try_sessions usage_events; do
  if [ "$(q "select to_regclass('public.$t') is not null")" = "t" ]; then
    printf '  %-16s %s rows\n' "$t" "$(q "select count(*) from public.$t")"
  else
    echo "✗ table $t missing"; FAIL=1
  fi
done

if [ "$FAIL" = 0 ]; then echo "✓ restore drill passed"; else echo "✗ restore drill FAILED"; fi
exit "$FAIL"

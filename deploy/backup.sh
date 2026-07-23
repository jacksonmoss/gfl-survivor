#!/bin/sh
# Scheduled pg_dump of the production database with rotation.
#
# Runs as a long-lived companion container (see the `backup` service in
# docker-compose.prod.yml). Every $BACKUP_INTERVAL it writes a gzipped,
# date-stamped custom-format dump into /backups (a host bind mount, so dumps
# survive loss of the pgdata volume) and prunes all but the newest
# $BACKUP_KEEP dumps.
#
# Env:
#   PGHOST, PGUSER, PGDATABASE, PGPASSWORD  — connection (set by compose)
#   BACKUP_INTERVAL  — seconds between runs (default 86400 = daily)
#   BACKUP_KEEP      — number of dumps to retain (default 7)
set -eu

: "${PGHOST:=db}"
: "${PGUSER:=gfl}"
: "${PGDATABASE:=gfl}"
: "${BACKUP_INTERVAL:=86400}"
: "${BACKUP_KEEP:=7}"

DIR=/backups
mkdir -p "$DIR"

backup_once() {
  ts=$(date +%Y%m%d-%H%M%S)
  out="$DIR/gfl-$ts.dump"
  tmp="$out.partial"
  # Custom format (-Fc): compressed, restore with pg_restore.
  if pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$tmp"; then
    mv "$tmp" "$out"
    echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"
  else
    echo "[backup] pg_dump FAILED; keeping previous backups" >&2
    rm -f "$tmp"
    return 1
  fi
  # Rotation: keep the newest $BACKUP_KEEP dumps, delete the rest.
  ls -1t "$DIR"/gfl-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
    echo "[backup] pruning $old"
    rm -f "$old"
  done
}

echo "[backup] starting: every ${BACKUP_INTERVAL}s, keep ${BACKUP_KEEP}, dir $DIR"
while :; do
  backup_once || true
  sleep "$BACKUP_INTERVAL" &
  wait $!
done

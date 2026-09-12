#!/usr/bin/env bash
# =============================================================================
# deploy/backup.sh — nightly SQLite backup via VACUUM INTO, 14-day retention.
#
# docs/adr/0001-sqlite-over-postgres.md: "Backup and restore is `cp sieve.db`
# / `VACUUM INTO` — one file, one mechanism." This script is that mechanism,
# automated. A backup that has never been restored is not a backup — see
# deploy/RESTORE.md for the drill, and actually run it before trusting this.
#
# Idempotent: re-running on the same UTC day overwrites that day's backup
# file rather than accumulating duplicates; the retention sweep only ever
# deletes files strictly older than RETENTION_DAYS, never the one just
# written. Safe to re-run any number of times, same day or not.
#
# First-time setup (see deploy/README.md for the full checklist):
#   sudo apt-get install -y sqlite3
#   crontab -e
#     0 3 * * * /home/teknikki/apps/sieve/deploy/backup.sh >> /home/teknikki/apps/sieve/backup.log 2>&1
#
# Env overrides (all optional, sane defaults for the documented VPS layout):
#   SIEVE_DB_PATH               default: <this repo's deploy dir>/../data/sieve.db
#   SIEVE_BACKUP_DIR             default: ~/backups/sieve
#   SIEVE_BACKUP_RETENTION_DAYS  default: 14
# =============================================================================

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${SIEVE_DB_PATH:-${DEPLOY_DIR}/data/sieve.db}"
BACKUP_DIR="${SIEVE_BACKUP_DIR:-${HOME}/backups/sieve}"
RETENTION_DAYS="${SIEVE_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%F)"
DEST="${BACKUP_DIR}/sieve-${STAMP}.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "!! sqlite3 CLI not found. One-time setup: sudo apt-get install -y sqlite3" >&2
  exit 1
fi

if [ ! -f "${DB_PATH}" ]; then
  echo "!! No database at ${DB_PATH} — nothing to back up." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "==> $(date -u '+%Y-%m-%dT%H:%M:%SZ') Backing up ${DB_PATH} -> ${DEST}"

# VACUUM INTO writes a fresh, defragmented, fully self-contained snapshot.
# Per SQLite's own documentation this is safe to run against a live
# WAL-mode database without blocking concurrent readers/writers — unlike
# `cp`, which can copy a torn/inconsistent state if it races a writer, and
# unlike a plain copy, the destination has no separate -wal/-shm sidecars
# to keep in sync; it's one ordinary, complete file.
rm -f "${DEST}"
sqlite3 "${DB_PATH}" "VACUUM INTO '${DEST}'"

# An empty or truncated file from a failed run must never silently pass as
# "backup done" — verify it's actually a readable, consistent database.
if ! sqlite3 "${DEST}" "PRAGMA integrity_check;" | grep -qx "ok"; then
  echo "!! Backup at ${DEST} failed integrity_check — treating this run as FAILED." >&2
  echo "!! NOT pruning old backups this run, so last night's good backup is kept." >&2
  exit 1
fi

SIZE="$(du -h "${DEST}" | cut -f1)"
echo "==> Backup OK: ${DEST} (${SIZE})"

echo "==> Pruning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"
find "${BACKUP_DIR}" -maxdepth 1 -name 'sieve-*.db' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "==> Current backups:"
ls -lh "${BACKUP_DIR}"/sieve-*.db 2>/dev/null || echo "  (none)"

# Restore runbook

> A backup that has never been restored is not a backup — it's a hope. This file exists so that
> hope is replaced with a rehearsed, timed procedure. Run the **drill** (§2) before you ever need
> the **real thing** (§3) — P14.5 in the implementation plan treats that drill as a launch gate, not
> an optional nicety.

Related: [`deploy/backup.sh`](./backup.sh) (how backups are made), `docs/adr/0001-sqlite-over-postgres.md`
(why restore is this simple: one file, `VACUUM INTO`, no second system to reconcile).

---

## 0. What you're restoring

Sieve's entire persistence layer is one SQLite file in WAL mode:

- `data/sieve.db` — the database (tables, FTS5 index, `vec0` vector table, `jobs` queue)
- `data/sieve.db-wal`, `data/sieve.db-shm` — WAL-mode sidecars, regenerated automatically; never
  backed up or restored directly (see §4)

A backup (`~/backups/sieve/sieve-YYYY-MM-DD.db`) is a single, complete, already-checkpointed
snapshot produced by `VACUUM INTO` — there is nothing else to restore alongside it.

---

## 1. Before you touch anything: which backup?

```bash
ssh contabo
ls -lh ~/backups/sieve/
```

Pick the most recent backup **from before** whatever went wrong. If you're not sure when the bad
state started, start with yesterday's and work backward.

---

## 2. The drill — rehearse this on a live box with zero risk to the running app

This restores a backup into a **throwaway copy**, never touching the running container's actual
`data/sieve.db`. Do this now, time it, and record the result — that's the actual deliverable of
P14.5, not just having this file exist.

```bash
ssh contabo
cd ~/apps/sieve

# 1. Pick a backup and verify it's a healthy, complete database BEFORE trusting it.
BACKUP=~/backups/sieve/sieve-$(date -u +%F).db   # or an older date, ls the dir first
sqlite3 "$BACKUP" "PRAGMA integrity_check;"
# must print exactly: ok

# 2. Restore into a scratch copy, not the live path.
cp "$BACKUP" /tmp/sieve-restore-drill.db

# 3. Prove it's actually queryable and has the shape/content you expect —
#    this is the part a "the file exists" check would miss.
sqlite3 /tmp/sieve-restore-drill.db "SELECT COUNT(*) FROM items;"
sqlite3 /tmp/sieve-restore-drill.db "SELECT id, title, status, created_at FROM items ORDER BY created_at DESC LIMIT 5;"
sqlite3 /tmp/sieve-restore-drill.db "SELECT COUNT(*) FROM chunks;"
sqlite3 /tmp/sieve-restore-drill.db "SELECT COUNT(*) FROM items_fts;"

# 4. Clean up the scratch copy.
rm -f /tmp/sieve-restore-drill.db
```

Record: the date of the backup you tested, how long steps 1–3 took end to end, and the row counts
you saw. If `integrity_check` ever returns anything other than `ok`, or a count comes back `0` when
you know the live app has items, that backup (and the mechanism producing it) needs investigating
**before** you need it for real.

---

## 3. The real thing — restoring after actual data loss or corruption

This overwrites the live database. Read all of §3 once before running anything.

```bash
ssh contabo
cd ~/apps/sieve

# 1. Stop the app so nothing writes to the database while you replace it.
docker compose -f compose.yml -f compose.prod.yml stop sieve

# 2. Preserve whatever is currently on disk, even if it's the broken state —
#    you may need it later to understand what happened. Never restore
#    directly over the only copy of the "before" state.
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p ~/backups/sieve/pre-restore
cp data/sieve.db "~/backups/sieve/pre-restore/sieve.db.broken-${TS}" 2>/dev/null || true

# 3. Choose and verify the backup (same check as the drill — never restore
#    a backup you haven't confirmed passes integrity_check).
BACKUP=~/backups/sieve/sieve-2026-09-11.db   # <-- set this to the actual file you're restoring
sqlite3 "$BACKUP" "PRAGMA integrity_check;"
# must print exactly: ok

# 4. Remove stale WAL/SHM sidecars from the OLD database. VACUUM INTO
#    backups are single, already-checkpointed files — leaving the previous
#    -wal/-shm next to a swapped-in sieve.db risks better-sqlite3 replaying
#    frames that belong to a database that no longer exists on disk.
rm -f data/sieve.db-wal data/sieve.db-shm

# 5. Put the backup in place as the live database.
cp "$BACKUP" data/sieve.db

# 6. Fix ownership — the container runs as uid:gid 1001:1001 (see
#    Dockerfile's `nextjs` user); a root-owned file from `cp` as your login
#    user will fail to open inside the container.
sudo chown 1001:1001 data/sieve.db

# 7. Bring the app back up and let the (idempotent, boot-time) migration
#    runner confirm the schema, then watch it come healthy.
docker compose -f compose.yml -f compose.prod.yml up -d sieve
docker inspect --format='{{.State.Health.Status}}' sieve   # poll until "healthy"

# 8. Verify for real — don't declare victory on a green healthcheck alone.
curl -fsS http://127.0.0.1:3060/api/v1/health && echo
#    Then sign in and spot-check: does the library show the item count and
#    recent items you expect from the chosen backup's date?
```

If step 3's `integrity_check` fails, or step 8 doesn't look right, **stop** — put the
`pre-restore/sieve.db.broken-*` copy back, try an older backup, and treat the newer backups as
suspect until you understand why.

---

## 4. Why WAL sidecars are never backed up or restored directly

`sieve.db-wal` and `sieve.db-shm` are working files for SQLite's write-ahead log — they only make
sense paired with the exact `sieve.db` they were generated against, and better-sqlite3 recreates
them automatically the moment it opens a database that doesn't have them. `VACUUM INTO` (used by
`deploy/backup.sh`) already produces a fully checkpointed, self-contained snapshot with no WAL state
outstanding — that's *why* it's the backup mechanism instead of a raw file copy of all three files.
Restoring is therefore always "one file in, stale sidecars removed," never "three files kept in
sync."

## 5. Getting a backup off the VPS (for local inspection, or a laptop-side drill)

```bash
scp contabo:~/backups/sieve/sieve-2026-09-11.db ./sieve-restore-check.db
sqlite3 ./sieve-restore-check.db "PRAGMA integrity_check;"
sqlite3 ./sieve-restore-check.db "SELECT COUNT(*) FROM items;"
rm ./sieve-restore-check.db
```

Useful when you want to eyeball a backup without touching the VPS at all — this never stops or
restarts anything running.

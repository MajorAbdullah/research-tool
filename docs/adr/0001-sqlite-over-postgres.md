# ADR 0001: SQLite (with sqlite-vec + FTS5) over Postgres (with pgvector + Meilisearch)

**Status:** Accepted · **Date:** 2026-09-12

## Context

Sieve has exactly one user. The engineering standards this repo inherited (`CLAUDE.md` and the
`Best Practices/` docs) are written for a multi-tenant SaaS platform, and the closest prior art,
Karakeep, uses Postgres for its relational data and Meilisearch for search. Between the SaaS-shaped
standards and the Karakeep precedent, the "obvious" default going in was a Postgres + pgvector
stack — and that is in fact what the first draft of the implementation plan specified.

**This decision reverses an earlier draft, not a hypothetical.** The plan's first version specified
three containers: Next.js, a dedicated worker, and Postgres 17 + pgvector, with `pg-boss` as the job
queue — roughly 700 MB resident. The project owner rejected it with a direct question: *"aren't we
building quite heavy app for small task? ... try best that we make the app optimized so it can run
on lowest resources."* That pushback is the origin of this ADR. The plan document was then rewritten
in place, so the Postgres draft is not visible in the final text — hence this paragraph, recording
that the heavier option was specified, costed, and deliberately abandoned rather than never
considered.

Notably, the same review also established that the presumed-lighter alternative was not lighter:
Karakeep, evaluated as a base to fork or extend, ships headless Chrome and Meilisearch and needs
~500 MB idle / 2 GB recommended (see ADR 0002). Neither default survived contact with the numbers.

The reversal is grounded in the VPS environment as actually verified over SSH, not assumed:

- 11 GB RAM total, **7.1 GB available, 1.4 GB swap already in use**.
- 145 GB disk, 49 GB free (67% used).
- **~45 containers already running** on the box (ERPNext, BillionMail, Medusa, n8n, **5× Postgres**,
  Qdrant, and others) — the host is a crowded, shared, non-dedicated machine, not a clean slate.
- Karakeep's own backup story is a Postgres dump plus a separate Meilisearch index — two systems to
  keep consistent and restorable.

Adding a dedicated Postgres instance (plus pgvector for vectors and Meilisearch for full-text) means
at least two more containers, more permanently-resident RAM, and a second/third moving part to
patch and back up — on a box that is already tight on both RAM and swap.

## Decision

Use **SQLite in WAL mode via `better-sqlite3`** as the only datastore, with two extensions replacing
what would otherwise be separate services:

- **sqlite-vec**'s `vec0` virtual table (`chunk_vec(embedding float[384])`) for kNN vector search,
  replacing pgvector/Qdrant. Brute-force kNN is adequate to roughly 100k vectors; Sieve expects
  10–50k chunks, well inside that ceiling.
- **SQLite FTS5** with `bm25()` ranking for full-text search, replacing Meilisearch.
- Hybrid search fuses the two rankings with **Reciprocal Rank Fusion (`k=60`)** — no separate
  score-normalization step is needed either.

Backup becomes a single-file operation (`VACUUM INTO`, nightly, 14-day retention) instead of
coordinating a Postgres dump and a Meilisearch index rebuild.

## Consequences

- Removes 1–2 containers from a box that already runs ~45 — a direct improvement to being a good
  neighbour on shared hardware, and the single biggest RAM lever available at this scale.
- Backup and restore is `cp sieve.db` / `VACUUM INTO` — one file, one mechanism, restore-drillable
  in minutes (P14.5), instead of two systems that must agree with each other.
- No network hop to the database: lower latency, no connection pool to size, tune, or exhaust.
- Write concurrency is effectively single-writer (mitigated by WAL mode + `busy_timeout`) — acceptable
  only because there is one user and writes are short job-stage updates, not long transactions.
- Gives up native pgvector ANN indexing (HNSW/IVFFlat), Postgres row-level security, and read
  replicas — none of which a single-user, sub-100k-vector corpus currently needs.

## What would reverse this

- **A second real user** (not hypothetical) — SQLite's single-writer model stops being "one user,
  short writes" and starts being a real contention point; this is the same trigger named in
  ADR 0008 for revisiting multi-tenancy.
- **Chunk count approaching the ~100k brute-force ceiling** stated above, with measured search
  latency breaching the P9.1.5 target (p95 < 300 ms at 5k items, extrapolated forward) — at that
  point pgvector's indexed ANN search becomes materially necessary, not just theoretically nicer.
- **The VPS gets meaningfully more headroom** (a box upgrade) *and* a second feature independently
  requires Postgres — otherwise adding a container purely for Sieve still fails the "good neighbour"
  test against the other ~45 containers.
- **Observed write contention in production** that WAL mode and `busy_timeout` cannot absorb (e.g.,
  the worker and an interactive request colliding measurably under real load, not in theory).

# ADR 0004: Free-tier-only models, with the request budget as a first-class constraint

**Status:** Accepted · **Date:** 2026-09-12

## Context

OpenRouter's free tier was verified against its live docs and catalog (2026-09-12): **1,000
requests/day and 20 requests/minute, account-wide across all `:free` model variants**, resetting at
UTC midnight. Extra API keys do not circumvent this — the limit is tied to the account, not to any
one model. A $10 top-up (bringing the account to a $15 balance) was already made specifically to
cross the one-time threshold that raises the daily cap from 50 to 1,000 requests/day; the balance
itself is never spent, and the running cost of the whole system is $0/month.

Because the counter is global, **model rotation buys availability, not capacity.** Swapping to
another free model when one is deprecated or returning 503s works. Swapping models to get *more*
daily requests does not — the shared counter doesn't care which `:free` model was called. Any
design that leaned on rotation for throughput would quietly fail once volume grew.

Given that, **requests-per-item becomes the primary architectural lever**, not model selection.
Three decisions were made specifically to minimize it:

| Stage | Requests/item | Why |
|---|---|---|
| Embeddings | **0** | Run locally (ADR 0003) |
| Enrichment | **1** | A single structured call returns tldr + bullets + tags + topic + repo fields together, never three separate calls |
| Relation labeling | **~0.05** | A batched sweep labels up to 20 pending pairs per request, not one request per pair |

This yields **≈1.05 requests/item → ~900 items/day**, versus an estimated ~330/day for a naive
design (separate calls per field, unbatched relations) — roughly a 3× throughput gain obtained
entirely from request-shape architecture, not from buying more quota or picking a "bigger" model.

## Decision

- Treat the OpenRouter free-tier request budget as a first-class, explicitly modeled architectural
  constraint everywhere in the system, not an incidental cost line.
- Maintain a persistent UTC-day request counter in `settings`, with a **soft cap of 900/day**,
  **100 of which are reserved for interactive use** (chat, manual re-enrich) so background backfill
  (e.g., the WhatsApp importer, P12.5) can never starve foreground use.
- At the cap, LLM-dependent job stages **pause** (jobs stay queued) and **auto-resume at 00:00 UTC**;
  the UI states "AI budget spent — resumes in Xh."
- Pace requests at **~18/minute** (under the global 20 RPM ceiling) via a token bucket shared across
  both model chains (ADR 0005) — rate-limit safety comes from pacing, not from rotation.
- Guarantee the system stays useful at zero remaining budget: capture, extraction, chunking, local
  embedding, FTS indexing, and both keyword and semantic search all run without OpenRouter, so an
  item is captured, searchable, and visible on the board even when only its AI summary/tags/topic
  are delayed.

## Consequences

- Every future feature that wants to add an LLM call to the per-item path must justify its request
  cost or batch it — this is now a standing rule in `CLAUDE.md`'s "Free-Tier Budget" section, not
  just a one-time design choice made here.
- The system degrades gracefully instead of failing outright when the daily budget is exhausted, at
  the cost of delayed enrichment on heavy-ingest days — the WhatsApp backlog importer deliberately
  throttles itself against this same cap and can take roughly a day to drain 800 links.
- Two pieces of standing infrastructure are required indefinitely and must survive process restart:
  the budget manager (persistent counter + soft cap + interactive reservation) and the token-bucket
  pacer.
- Throughput is capped at ~900 items/day regardless of how many free models exist or how fast the
  VPS could otherwise process items — this ceiling is tied to the OpenRouter account, not to compute.

## What would reverse this

- OpenRouter changes the free tier to be **per-model rather than account-wide** — request-shape
  optimizations would still help but would stop being load-bearing, since rotation would then also
  buy capacity.
- Actual sustained ingest volume exceeds ~900 items/day for a meaningful period (the single-user
  assumption stops holding) — at that point paid API calls become cheaper than continuing to
  engineer around a free ceiling.
- OpenRouter deprecates the free tier entirely, or drops the balance-unlocks-1,000/day mechanism —
  the whole free-only design, and the downstream chain design in ADR 0005, would need re-costing
  against paid pricing from scratch.

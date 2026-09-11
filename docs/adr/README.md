# Architecture Decision Records

Sieve's load-bearing decisions, recorded so a future reader (human or agent) knows *why*, not just
*what*, and knows exactly what would need to change for the decision to be revisited. Every entry
uses the same shape: Context, Decision, Consequences, and a concrete **"What would reverse this"**
section — read that section first if you're considering going against one of these.

> Read this before proposing an architectural change. If a decision looks wrong, argue with the ADR
> — don't silently re-litigate it in code. See `CLAUDE.md` for how these connect to day-to-day rules.

| # | Title | Summary |
|---|---|---|
| [0001](./0001-sqlite-over-postgres.md) | SQLite over Postgres | Single user + a crowded, RAM-tight VPS (~45 containers, 1.4 GB swap in use) beats the default multi-tenant-SaaS choice of Postgres + pgvector + Meilisearch. `sqlite-vec` + FTS5 replace both; backup is one file. |
| [0002](./0002-build-rather-than-fork-karakeep.md) | Build rather than fork/extend Karakeep | Karakeep (28k★) is heavier, not lighter (headless Chrome + Meilisearch), and doesn't solve the hard part (YouTube transcripts are an open issue there). Forking buys AGPL + a merge treadmill against 190 contributors for no advantage. |
| [0003](./0003-local-embeddings-over-api-embeddings.md) | Local embeddings over API embeddings | **Reverses an earlier plan.** Not about ingest cost — with API embeddings, every search query and keystroke would burn the shared daily quota. Local (`bge-small-en-v1.5`, 384d) costs ~120 MB RAM and removes retirement risk on the whole index. |
| [0004](./0004-free-tier-only-models-request-budget.md) | Free-tier-only models, with the request budget as a first-class constraint | OpenRouter's 1,000 req/day + 20/min is account-wide across all `:free` models — rotation buys availability, not capacity. Requests/item (~1.05) is the real design lever: ~900 items/day vs. ~330 naive. |
| [0005](./0005-two-model-chains.md) | Two model chains, not one | Only 6 of 22 free chat models support native structured output, and the preferred reasoning model (`nemotron-3-ultra`, 1M context) isn't one of them. Enrichment and chat/RAG get separate, purpose-fit chains instead of one compromise chain. |
| [0006](./0006-browser-extension-as-extraction-engine.md) | The browser extension is the extraction engine, not a convenience | The VPS's datacenter IP gets blocked by YouTube/Instagram/X/Cloudflare. The extension runs on the user's residential IP, already logged in, and is load-bearing — not an optional client. |
| [0007](./0007-single-container-in-process-worker.md) | Single container with an in-process worker | The pipeline is I/O-bound; the one CPU stage (local embedding) runs on ONNX's native thread pool, capped at 2 of 6 vCPUs. `WORKER_ENABLED=false` is the documented escape hatch if that stops holding. |
| [0008](./0008-no-multi-tenancy-billing-sso.md) | No multi-tenancy, billing, entitlements, or SSO | There is one tenant. `user_id` + one scoping helper keep the isolation mechanism in place, so a second user is a signup page, not a migration — but only once that's actually tested. |
| [0009](./0009-no-iac-no-zero-downtime-deploys.md) | No Terraform/Pulumi IaC and no zero-downtime deploys | The infrastructure is one nginx vhost and one compose file — `deploy/` + `compose*.yml` in git *is* the versioned IaC at this scale. A ~5 s restart is acceptable; fast rollback to the previous GHCR tag is kept because that part does matter. |
| [0010](./0010-mit-license.md) | MIT licence | Not forking Karakeep (ADR 0002) left the license choice unconstrained by AGPL. MIT maximizes reuse for an eventual open-source release. |

## Adding a new ADR

Copy the format below into `NNNN-short-title.md` (next sequential number, zero-padded to 4 digits),
and add a row to the table above.

```
# ADR NNNN: <Title>
**Status:** Accepted · **Date:** YYYY-MM-DD
## Context
## Decision
## Consequences
## What would reverse this
```

`What would reverse this` is not optional and not vague — a threshold, a measurement, or a new
requirement that would actually flip the decision, not "if priorities change."

# ADR 0003: Local embeddings (`bge-small-en-v1.5`, 384d) over API embeddings

**Status:** Accepted · **Date:** 2026-09-12

## Context

**This reverses an earlier position in the plan's own development.** Local embeddings were first
justified mainly on ingest cost — fewer API calls while adding items — which understated the real
constraint and would not, by itself, have been decisive.

The decisive reason surfaced only once the free-tier request budget (ADR 0004) was modeled
properly: OpenRouter's 1,000 requests/day and 20/minute limits are **account-wide across all
`:free` models**, not per model. If query embeddings were generated via an API model instead of
locally, **every search query and every debounced keystroke in the search-as-you-type box** would
consume the same shared daily quota that enrichment and chat depend on — the plan's own accounting
puts this at 30 requests gone for 30 searches, before a single item is enriched. Ingest cost was
never the real issue; steady-state *usage* cost was.

A second, independent failure mode also argues against API embeddings: if a hosted embedding model
is retired or silently changed, every previously-stored vector becomes incomparable to newly
embedded ones, forcing a full re-embed of the entire corpus (an estimated 10–50k chunks) with no
warning. A model file pinned in a volume cannot be retired out from under the deployment the way a
hosted API model can.

Local embedding's cost is small and known: **`bge-small-en-v1.5`, 384 dimensions, ONNX-quantized**,
via `fastembed`, at **~350 MB RAM (measured — see the correction below)**. That pushes the container to ~600 MB total — still
comfortably under the 512 MB `mem_limit` and under 6% of the box's free RAM.

## Decision

- Default `EmbeddingProvider` is **local**: `fastembed` / `bge-small-en-v1.5`, 384 dimensions,
  ONNX-quantized, warmed once at boot (not per call), concurrency capped at 2.
- The `vec0` schema uses a fixed, literal 384-dim column (`vec0(embedding float[384])`) — no
  bootstrap dimension probing is needed because the local model's output dimension is a known
  constant, unlike an API model whose dimensions aren't guaranteed documented.
- Keep an OpenRouter-based `EmbeddingProvider` (`nvidia/nemotron-3-embed-1b:free`) behind the same
  interface as a documented, **non-default** alternative for trading quota for RAM — switching
  requires a deliberate `pnpm reembed`, never an automatic fallback.
- **Never mix embedding models in one index.** Each `chunks` row records `embedding_model`; a
  startup guard refuses mismatches loudly; embedding failures retry the *same* model and never fail
  over to a different-dimension one.

## Consequences

- Searching is free and instant from a quota perspective: zero OpenRouter requests for any query,
  keystroke, or relation-sweep embedding step.
- Frees roughly 45% of the effective daily request budget (per the ~1.05 req/item accounting in
  ADR 0004) for enrichment instead of spending it on embeddings.
- Immune to upstream embedding-model retirement corrupting the index — the worst case is a
  deliberate, versioned `pnpm reembed`, not silent corruption discovered later.
- Permanently costs **~350 MB of RAM** (not the ~120 MB originally estimated) and some CPU during ingest, resident in the single container for
  the life of the deployment (see ADR 0007).
- Gives up whatever marginal retrieval quality a larger hosted embedding model might offer, and gives
  up easy elasticity — changing embedding providers is a full `pnpm reembed` pass over every stored
  chunk, not a config flip.
- The chat/RAG path still sends text to free hosted models regardless of this decision — this ADR
  only removes network calls from the *search* and *embedding* path, not from chat. OpenRouter's
  free variants generally permit request retention for training, so private notes and chat queries
  still travel that path; this is flagged as an accepted, unresolved tradeoff of staying free-only,
  not something this decision fixes.

## Measurement correction (2026-09-12)

The original estimate of **~120 MB was wrong by roughly 3x.** Measured on the installed stack
(`fastembed` 2.1.0 / `onnxruntime-node` 1.29.0, `bge-small-en-v1.5`, CPU provider):

| Stage | RSS |
|---|---|
| node baseline | 38 MB |
| after `require('fastembed')` | 69 MB |
| **after model load** | **348 MB** |
| under embedding load (120 chunks) | 400-509 MB, stable |

Supporting facts:

- `heapUsed` is only **7 MB** — so ~390 MB is native onnxruntime arena memory. **A forced GC reclaims
  none of it.** This is not a JS leak and cannot be tuned away from the JS side.
- It does **not** grow with work: 20 chunks and 120 chunks both settle at ~400 MB.
- **Warm init from the on-disk cache is 0.25 s** (the first run's 481 s was the 128 MB model download).
- Throughput ~87 ms/chunk on Apple Silicon.

**The decision stands, but the container limit was corrected from `512m` to `1g`.** At 7.1 GB free on
the host this is ~9% of available RAM, and still inside Karakeep's own 2 GB recommendation (ADR 0002),
so the "good neighbour" constraint is not violated. The reasoning that actually drove this ADR — that
API embeddings would make *every search query* cost free-tier quota, and that a retired remote model
would invalidate every stored vector — is untouched by the RAM figure.

**The lever if RAM ever does get tight:** because warm init is only 0.25 s, the embedder can move to a
separate short-lived or long-lived child process, keeping the web process at ~200 MB. That was
deliberately *not* done now: it adds IPC and lifecycle complexity to buy ~350 MB on a box with 7.1 GB
free, which the repo's own KISS/YAGNI rule argues against.

## What would reverse this

- The VPS RAM budget tightens further (available RAM drops well below the current 7.1 GB with
  1.4 GB swap already in use) such that 120 MB stops being negligible.
- A hosted embedding model ships with a stable, versioned, contractually-never-retired guarantee
  (removing the corruption-on-retirement risk) **and** the free-tier budget is increased or
  decoupled from search/query traffic specifically (removing the quota-consumption argument) —
  both conditions, not just one.
- The golden-set eval (P9.1.7) shows local embedding quality measurably underperforming a hosted
  alternative on context precision/recall by enough to justify paying the quota cost for it.

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

---

## Amendment — 2026-09-16: `openrouter` is now the deployed default

**Status:** Accepted · Reverses this ADR's *default*, keeps every one of its safeguards.

The Decision above made `local` the default and kept an OpenRouter provider as a documented,
deliberately unwired alternative "for trading quota for RAM". That trade has now been made
deliberately, for the deployment on the shared Contabo box. `EMBEDDING_PROVIDER=openrouter`,
`nvidia/nemotron-3-embed-1b:free`, **2048 dimensions**.

### What was re-tested, rather than assumed

This ADR was written before the code ever called the endpoint. Measured against it directly:

| Question | Answer |
|---|---|
| Does OpenRouter even serve embeddings? | Yes — `POST /api/v1/embeddings`, batched array input, results returned with `index` |
| Dimensions | **2048** for both free NVIDIA models (`nemotron-3-embed-1b`, `llama-nemotron-embed-vl-1b-v2`) |
| Does it spend the shared free-tier budget? | **Yes.** 10 embedding calls moved `free_model_daily_requests.used` by 5. The exact ratio is OpenRouter's business and may change; we charge 1 per call, which is conservative |
| Free alternatives at other widths? | None. The 1536-d and 4096-d models are paid, which the project's free-only constraint rules out |
| Is it in the public model catalog? | **No** — `/api/v1/models` lists no embedding models at all, so there is no way to enumerate them or detect a retirement in advance |

So this ADR's **first** argument — that hosted embeddings spend the shared quota on every query —
was correct and is unchanged. What changed is the weighting, not the fact: the deployment target
is a box with ~45 other containers, and 350 MB of permanently-resident ONNX arena is a larger
practical cost there than a few hundred requests out of 1,000/day. Verified after the switch:
`onnxruntime` is no longer mapped into the server process at all.

This ADR's **second** argument — silent model retirement corrupting the index — is *strengthened*
by the catalog finding, and is now defended in code rather than by avoidance (see below).

### What is kept, unchanged

- **Never mix embedding models in one index.** Still the rule. `settings.embedding_model` still
  guards it at boot, and switching still requires `pnpm reembed`.
- **No automatic provider fallback.** A hosted provider that is down does *not* fail over to the
  local one — different vectors, silent corruption. It degrades (below) instead.
- **Batching.** One request per batch, never per chunk.

### What is new, because the risks this ADR named are now live

- **The dimension is configuration, not a constant.** `EMBEDDING_DIMENSIONS` is required for
  `openrouter` and has no default — this ADR's "an API model whose dimensions aren't guaranteed
  documented" is exactly why. `chunk_vec`'s width is reconciled against it at boot: rebuilt if the
  table is empty, a hard boot failure if it holds vectors, never a silent drop of the index.
- **Responses are width-checked.** If the model behind the `:free` alias starts returning a
  different width, the provider throws and names both numbers instead of writing incomparable
  vectors. This is the retirement scenario this ADR predicted, caught at the point it happens.
- **Embedding calls are metered.** `BudgetedEmbeddingProvider` reserves against the same
  `BudgetManager` as enrichment and chat — ingest on the `background` lane, search on
  `interactive`, so a bulk import cannot starve your own searches.
- **Search degrades instead of failing.** Budget exhausted, a timeout, a 429, or no network all
  fall back to keyword-only FTS. CLAUDE.md's "the system stays useful at zero budget ... Never
  break that property" survives this change — verified by spending the budget to the cap and
  confirming search still returned the correct top result.

### Consequences that changed

- Searching is **no longer free**. An embedded query costs budget, and at zero budget search is
  keyword-only — still useful, measurably worse at conceptual matching.
- Search now depends on the network. Offline, it is keyword-only.
- Vectors are **5.3× larger** on disk (2048 × 4 bytes vs 384 × 4).
- ~350 MB of RAM is returned to the box.

### What would reverse this amendment

- Search quality at zero budget proving unacceptable often enough to matter — i.e. the daily cap
  is actually being hit during normal use, not just during bulk imports.
- The free NVIDIA embedding models being retired. Since they aren't in the public catalog, expect
  to discover this via the width check or a sudden run of 404s, not an announcement. Falling back
  to `local` is `EMBEDDING_PROVIDER=local`, `EMBEDDING_DIMENSIONS=384`, `pnpm reembed`.

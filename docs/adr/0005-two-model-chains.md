# ADR 0005: Two model chains, not one

**Status:** Accepted · **Date:** 2026-09-12

## Context

Verified against OpenRouter's live catalog (2026-09-12): **only 6 of the 22 free chat models support
native `structured_outputs`**. Enrichment (`tldr` + `bullets` + `tags` + `topic` + `kind_fields`)
runs unattended on every captured item and depends on reliably schema-shaped output every time — it
cannot afford prompt-and-repair as its normal path at scale.

The user's preferred model for chat and reasoning, `nvidia/nemotron-3-ultra-550b-a55b:free`, has a
**1,000,000-token context window** and is a 550B-class frontier-reasoning MoE — but it supports
`tools` (forced tool-call) and **not** `response_format` (native JSON schema). It is exactly one of
the 16 free models that can't be trusted for schema-mandatory enrichment. A single chain would force
a choice: drop Ultra's context and reasoning from chat entirely to standardize on schema-native
models (none of which reach Ultra's scale or window), or accept unenforced/unreliable output shape
in the automated enrichment pipeline. Neither is acceptable.

## Decision

Run **two independently ordered chains, six models deep each, three vendors each, all free**:

**Chain A — Enrichment (schema mandatory):**

| # | Model | Context | Schema |
|---|---|---|---|
| 1 | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144 | native |
| 2 | `dots-studio/dots-3-note-preview:free` | 512,000 | native |
| 3 | `nex-agi/nex-n2.5-pro:free` | 262,144 | native |
| 4 | `openrouter/free` (auto-router) | 200,000 | native |
| 5 | `google/gemma-4-31b-it:free` | 262,144 | forced tool-call |
| 6 | `nex-agi/nex-n2.5-mini:free` | 262,144 | native |

**Chain B — Chat/RAG + oversized content (reasoning + context, free-form output):**

| # | Model | Context | Modalities |
|---|---|---|---|
| 1 | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1,000,000 | text |
| 2 | `thinkingmachines/inkling:free` | 1,048,576 | text, image, audio |
| 3 | `nvidia/nemotron-3.5-lightning:free` | 1,000,000 | text |
| 4 | `thinkingmachines/inkling-small:free` | 1,048,576 | text, image, audio |
| 5 | `dots-studio/dots-3-note-preview:free` | 512,000 | text, image |
| 6 | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144 | text |

Content that exceeds Chain A's window (a 4-hour transcript, a 300-page PDF) routes to Chain B's
larger-context models instead of being truncated (the long-content router, P3.1.1b).

A capability probe reads `supported_parameters` from `/api/v1/models` at boot, caches it, and picks
the enforcement strategy per model — `response_format` → forced tool-call → prompt-and-repair — so
a model substituted into either chain later (free models rotate without warning) is handled
correctly with no code change. `openrouter/free` sits at Chain A position 4 specifically as the
literal "if free ends, another takes its place" mechanism: it is OpenRouter's own auto-router across
the free pool.

## Consequences

- Ultra's 1M context and reasoning are spent exactly where they matter — chat/RAG over the whole
  library, oversized content — never on "return five tags as JSON."
- Enrichment gets schema reliability from models chosen specifically because they support it, at the
  cost of not using a single "best" model uniformly across every task.
- Two ordered chains mean two env-configured lists (`LLM_CHAIN_ENRICH`, `LLM_CHAIN_CHAT`) to
  maintain, with some models (`nemotron-3-super-120b-a12b`, `dots-3-note-preview`) intentionally
  appearing in both.
- The long-content router is a real code path — not just a config list — and needs its own test (a
  500k-token transcript enriching without losing its ending), rather than a simpler single-chain
  truncate-and-go rule.

## What would reverse this

- OpenRouter's free catalog shifts so that most schema-capable models also carry very large context
  windows, removing the schema-vs-context tradeoff that motivates the split — collapsing to one
  chain would then lose little.
- `nemotron-3-ultra` (or its Chain B equivalent at the time) gains native `response_format` support
  upstream — the model that most motivated keeping the chains separate would then qualify for
  Chain A too.
- The golden-set eval shows Chain A's schema-reliability advantage isn't actually load-bearing in
  practice — e.g., prompt-and-repair on a single unified chain (including Ultra) turns out cheap and
  reliable enough that the split stops paying for itself.

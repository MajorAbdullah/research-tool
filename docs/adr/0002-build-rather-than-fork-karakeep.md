# ADR 0002: Build Sieve from scratch rather than fork/extend Karakeep

**Status:** Accepted · **Date:** 2026-09-12

## Context

Karakeep (28k★) is the closest prior art — a self-hosted bookmark/read-it-later app with AI
features — and is the project that most reshaped this plan by forcing the question "why not just
use this?" directly.

The comparison, verified against Karakeep's own docs and install guides:

| | Karakeep | Sieve |
|---|---|---|
| Containers | 3 (app + **headless Chrome** + Meilisearch) | 1 |
| RAM | ~500 MB idle, ~800 MB active, 2 GB recommended | ~370 MB |
| YouTube transcripts | Open feature request, unresolved ([#1629](https://github.com/karakeep-app/karakeep/issues/1629)) | Solved via extension (ADR 0006) |
| GitHub repo table, research status workflow, alternatives/competes-with | None of these exist | All in scope for v1 |
| License | AGPL, ~190 contributors | — |

Two facts drove the decision, not one:

1. **Karakeep is not the lighter option.** It ships headless Chrome, which is the actual RAM hog —
   forking it would mean inheriting that weight, not escaping it.
2. **It does not solve the hard part.** YouTube transcript extraction — the single biggest reason
   Sieve exists instead of a bookmarking app — is an open, unresolved issue in Karakeep's own
   tracker. Forking would still require building the extension-based extraction path from scratch.

Given both of those, forking would mean carrying AGPL's obligations and a permanent merge treadmill
against 190 upstream contributors, in exchange for a stack that is heavier, not lighter, and that
still doesn't solve the problem Sieve is being built to solve.

## Decision

Build Sieve as a new codebase. Validate architecture *shape* against Karakeep (TypeScript + a
background worker + a pluggable LLM provider + hybrid search) without adopting its heavy
dependencies — no headless Chrome, no Meilisearch, no Postgres (see ADR 0001).

Treat upstreaming a YouTube-transcription PR to Karakeep as a separate, optional, good-for-the-
ecosystem action — explicitly not a substitute for building Sieve's own extraction path, since it
wouldn't get Sieve its own tool even if accepted.

## Consequences

- No AGPL obligations carry into Sieve, which leaves the license choice unconstrained by any
  upstream (see ADR 0010 — MIT).
- No merge treadmill: Sieve's own history is the only one to manage; nothing to keep rebasing
  against Karakeep's ongoing changes.
- Everything Karakeep doesn't have — the browser-extension extraction engine, GitHub repo table,
  research status board, alternatives/competes-with relations — must still be built, exactly as it
  would have been after a fork; nothing was actually saved on that front by not forking.
- Ends up lighter (1 container, ~370 MB) than Karakeep (3 containers, 2 GB recommended) while adding
  domain-specific features Karakeep lacks entirely.
- Forgoes Karakeep's existing user base and its already-battle-tested extractors (everything except
  YouTube transcripts) — Sieve's extractors are new and need their own fixture-based test suite
  (P2) built from zero prior art.

## What would reverse this

- Karakeep ships extension-based YouTube transcript capture upstream (closing #1629) **and** makes
  headless Chrome / Meilisearch optional such that idle RAM drops well below Sieve's ~370 MB —
  at that point running or lightly patching Karakeep would dominate a from-scratch build.
- Karakeep adds first-class support for the domain-specific features Sieve exists for (research
  status workflow, GitHub repo table, alternatives/competes-with relations) — removing the "doesn't
  solve the hard part" argument entirely.
- Karakeep relicenses away from AGPL to something permissive — removing the fork-obligation concern
  that made building from scratch the safer default.

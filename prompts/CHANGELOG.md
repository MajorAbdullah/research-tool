# Prompt changelog

CLAUDE.md requires prompt and model versions to be tracked as a matched pair, and changes to be
tied to observed results. Each entry says what changed, why, and what evidence prompted it.

## enrichment.v2 — 2026-09-12

**Changed:** the `topic` instruction now names *two* failure modes instead of one, with a concrete
counter-example, and states that a library with only one or two topics is normal.

**Why:** v1 warned only against creating near-duplicates ("do not propose 'LLM Agents' when 'Agent
Frameworks' exists") and said to "prefer reusing" an existing topic. Observed on a live run: with
exactly one topic in the library — "LLM Inference Engines", created from a vLLM repo — the very next
item, **Karakeep, a self-hosted bookmark manager, was assigned "LLM Inference Engines"** at
confidence 0.95. The model over-applied the reuse instruction because v1 gave it no example of the
opposite mistake.

**Evidence the threshold was NOT at fault:** cosine distance from "LLM Inference Engines" to the
labels a model *should* have proposed was measured with the real local embedder, all comfortably
outside the 0.15 reuse threshold:

| candidate label | distance | verdict at 0.15 |
|---|---|---|
| Bookmark Managers | 0.1840 | create new ✓ |
| Self-Hosted Tools | 0.1653 | create new ✓ |
| Knowledge Management | 0.1699 | create new ✓ |
| Read-Later Apps | 0.2202 | create new ✓ |
| LLM Inference | 0.0279 | reuse ✓ |
| Inference Engines for LLMs | 0.0453 | reuse ✓ |

So `assignTopic` would have rejected any sensible proposal for Karakeep. The model simply never
made one — it emitted the existing label verbatim, which no distance check can catch. The fix
therefore belongs in the prompt, not the threshold.

**Open question, deliberately not changed:** "LLM Serving" sits at 0.1735, i.e. *outside* the reuse
threshold, even though it arguably is the same topic as "LLM Inference Engines". The threshold may
be slightly too tight for genuine synonyms while the prompt was too loose. Tuning it needs a
topic-assignment eval set that does not exist yet; `DEFAULT_TOPIC_DISTANCE_THRESHOLD` is left at
0.15 rather than moved on a single anecdote.

# Evals

Retrieval and generation are scored **separately**, as four distinct numbers. A good answer
built on bad context is a fragile system; a single blended score hides that.

```bash
pnpm eval       # retrieval:  context precision, context recall
pnpm eval:rag   # generation: faithfulness, answer relevancy
```

**Re-run both before any change to chunking, embeddings, retrieval, or prompts.** That is a
hard rule in `CLAUDE.md`, not a suggestion — these are the only signals that catch a silent
quality regression, because retrieval getting worse does not throw an exception.

## Files

- `golden-set.ts` — the corpus and the cases. Every case carries a `rationale` field
  explaining why it exists, so nobody deletes a case they don't understand.
- `retrieval/*.eval.ts` — scores retrieval against `RETRIEVAL_CASES` (no LLM calls; runs on
  local embeddings, so it costs no OpenRouter quota).
- `generation/*.eval.ts` — scores answers against `GENERATION_CASES`. **This one spends free-tier
  requests**, so it is not part of `pnpm test` and never runs in CI by default.

## Notes on the corpus

It is small on purpose, and deliberately contains items whose **titles do not contain the words
you would search for** — `reel-diffusion` is titled "this changes EVERYTHING 🤯". That asymmetry
is the entire reason hybrid search exists in this project. A corpus without it scores
suspiciously well and tells you nothing.

`GENERATION_CASES` includes a case with `expectInsufficient: true` where the corpus genuinely
cannot answer. The model must say so rather than invent. That is the primary hallucination guard.

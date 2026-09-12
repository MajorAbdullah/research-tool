<div align="center">

# 🧺 Sieve

**A self-hosted AI research library for people drowning in links.**

Share a link from anywhere. Sieve extracts the real content, summarizes it, groups it by topic and
media kind, tracks what you've actually evaluated, and makes the whole pile searchable by *meaning*.

`Next.js 16` · `SQLite + sqlite-vec` · `One container` · `~600 MB` · `$0/month`

</div>

---

> ### ⚠️ Status: pre-implementation
>
> The architecture is settled and approved; the application code is being built now. This README
> documents the **target state**. Commands below will not work until the phases that implement them
> land. Track progress in [`docs/plans/`](./docs/plans/) and the decision history in
> [`docs/adr/`](./docs/adr/).

---

## The problem

If you follow AI research, your input firehose looks like this: GitHub repos, arXiv papers, blog
posts, YouTube explainers, Instagram Reels, X threads. Most people dump them into a "message
yourself" chat and never look again. The pile grows, nothing is retrievable, and you re-discover the
same repo three times without ever testing it.

Sieve fixes three specific failures of that habit:

| Failure | Sieve's answer |
|---|---|
| "I saved something about this but can't find it" | Hybrid search — keyword **and** semantic. Finds the Reel titled *"this changes everything 🤯"* when you search *"video diffusion fine-tuning"* |
| "Did I already try this repo?" | A research status board: Inbox → To Test → Testing → Tested → Dropped, with an outcome note |
| "What even is this repo?" | Per-kind AI enrichment — repos get a real table (what it does, language, stars, last commit, licence) plus *"what it competes with"* from your own library |

---

## How it works

```
   Browser Extension ─┐
   Android PWA share ─┼──▶  /api/v1/capture  ──▶  SQLite job queue
   Web paste box     ─┤                               │
   WhatsApp import   ─┘                               ▼
                                    resolve → extract → enrich → embed → relate → index
                                                      │
                                    ┌─────────────────┴─────────────────┐
                                    ▼                                   ▼
                            Hybrid search                        Library · Board
                       (FTS5 + sqlite-vec, RRF)                   Ask-my-library chat
```

Each pipeline stage is a separate retryable job. A YouTube rate-limit in `extract` backs off and
retries without blocking `enrich` for anything else, and any stage can be re-run from the UI.

### The part that makes it actually work

**Your server has a datacenter IP, and YouTube, Instagram, X and Cloudflare all block it.**
`youtube-transcript-api` and `yt-dlp` work on a laptop and start returning `RequestBlocked` / `429`
from a VPS after a couple hundred requests. A server-only design silently degrades to "title and
thumbnail" for exactly the sources you care most about.

So **the browser extension is the extraction engine, not a convenience.** It runs in your browser,
on your residential IP, already logged in — it reads the rendered DOM, the YouTube transcript panel,
the full X thread, the Reel caption, and posts that text to the server alongside the URL. No
proxies, no cookies on the server, no per-request cost.

Every item records an **extraction tier** so degradation is never silent:

| Tier | Meaning |
|---|---|
| `full` | Real content captured — transcript, article body, or the GitHub API |
| `partial` | Some content, some metadata |
| `metadata_only` | Title and thumbnail only — the UI prompts you to re-open it with the extension, and **Re-extract** re-runs the ladder |

---

## Features

- **Capture from anywhere** — browser extension (Chrome/Arc/Edge), Android share sheet via PWA, web paste box, bulk WhatsApp import
- **Per-kind extraction** — GitHub REST API, Mozilla Readability for articles, YouTube transcripts, PDF/arXiv text, X threads
- **One-call AI enrichment** — TL;DR, bullets, tags, topic, and repo-specific fields in a single request
- **Auto topic clustering** — assigns to your existing topics instead of inventing near-duplicates
- **Hybrid search** — SQLite FTS5 (`bm25`) + sqlite-vec kNN, fused with Reciprocal Rank Fusion
- **Research status board** — drag-and-drop kanban, touch-capable, with per-item outcome notes
- **Ask-my-library chat** — RAG over your own saved items, with mandatory inline citations and an explicit *"I have nothing saved about that"* path
- **Alternatives panel** — *"do I already have something like this?"*, with a one-line difference

**Deliberately not in v1:** digests and stale-nudges, audio/video transcription (captions + metadata
for now), AI priority scoring, media archiving, iOS share sheet (Safari has no Web Share Target).

---

## Quick start

### Prerequisites

| Requirement | Notes |
|---|---|
| Node 24+ and pnpm | |
| Docker + Compose v2 | For the containerized run |
| An **OpenRouter API key** | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **A one-time $10 OpenRouter credit purchase** | See *Cost* below — this is not optional in practice |
| A **GitHub PAT** (`public_repo`) | Lifts the GitHub API from 60 → 5,000 req/hr |

### Run it

```bash
git clone <your-fork> sieve && cd sieve
cp .env.example .env        # then fill in OPENROUTER_API_KEY and GITHUB_PAT
pnpm install
pnpm db:migrate             # creates the SQLite file, FTS5 and vec0 tables
pnpm seed:user              # creates your single user from SEED_USER_* in .env
pnpm dev                    # http://localhost:3060
```

### Or with Docker

```bash
cp .env.example .env
docker compose up -d
docker compose logs -f
```

The SQLite file lives in a bind-mounted `./data/` so it survives container replacement.

### Install the browser extension

```bash
pnpm build:ext
```

Then in Chrome/Arc → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Open the extension's options page and paste your server URL plus the
`EXTENSION_TOKEN` from `.env`.

> Install the extension even if you mostly browse on your phone. It is the only path to full
> YouTube transcripts and paywalled/Cloudflare-protected article text.

### Install the Android app

There isn't one — it's a PWA. Open your Sieve URL in Chrome on Android → menu → **Install app**.
"Sieve" then appears in the native share sheet from YouTube, Instagram, X and Chrome.

---

## Configuration

Every variable is documented in [`.env.example`](./.env.example). The ones worth understanding:

| Variable | Default | Why it matters |
|---|---|---|
| `LLM_CHAIN_ENRICH` | 5 free models | Ordered fallback for enrichment. **Must lead with a model supporting native structured output** |
| `LLM_CHAIN_CHAT` | 4 free models | Ordered fallback for chat/RAG. Leads with 1M-context models |
| `LLM_DAILY_CAP` | `900` | Of the 1,000/day free allowance |
| `LLM_INTERACTIVE_RESERVE` | `100` | Held back so background backfill can never starve your own chat |
| `EMBEDDING_PROVIDER` | `local` | `local` uses `bge-small-en-v1.5` on CPU. Changing this requires `pnpm reembed` |
| `WORKER_ENABLED` | `true` | Set `false` to run the worker as a separate container |
| `GITHUB_PAT` | — | Without it you get 60 req/hr and repo enrichment will stall |

---

## Cost

**$0/month.** Every model in both chains is a free OpenRouter model, and embeddings run locally.

**But buy $10 of OpenRouter credit once.** You will never spend it. OpenRouter's free tier is
**50 requests/day** until your account has purchased $10 at some point, after which it is
permanently **1,000 requests/day**. The balance then just sits there.

### The budget is a real constraint

The free limits — **1,000 requests/day and 20/minute** — are **account-wide across all `:free`
models**, resetting at UTC midnight. Extra API keys don't help.

> **Model rotation buys availability, not capacity.** Falling back to another model when one is
> deprecated or returning 503s works. Falling back to get *more requests* does not — the counter is
> global. Sieve is designed around this.

| Stage | Requests per item | How |
|---|---|---|
| Embeddings | **0** | Local model — which also means **searching costs nothing** |
| Enrichment | **1** | One structured call returns everything at once |
| Relation labeling | **~0.05** | Batched sweep, up to 20 pairs per request |

**≈1.05 requests/item → ~900 items/day.**

**When the budget runs out, Sieve degrades instead of stopping.** Capture, extraction, chunking,
embedding, full-text and semantic search are all local. An item still arrives, is still searchable,
and is still on the board — only its summary and tags land after the UTC reset.

---

## Privacy

Self-hosted: your database, your server, your data. Two honest caveats:

1. **Free OpenRouter models may retain requests for training.** Item content and your chat questions
   travel that path. Your saved links are public pages anyway, but private notes are not — worth
   knowing. Switching the chat chain to a paid model is a one-line change.
2. **Local embeddings mean all search text stays on your box.** Queries are never sent anywhere.

---

## Development

```bash
pnpm dev            # dev server on :3060
pnpm check          # lint + format + typecheck
pnpm test           # Vitest — extractors, chunker, RRF fusion, parsers
pnpm test:e2e       # Playwright smoke
pnpm eval           # retrieval: context precision + context recall
pnpm eval:rag       # generation: faithfulness + answer relevancy
pnpm reembed        # re-embed everything after an embedding-model change
pnpm build:ext      # build the browser extension
```

**Run `pnpm eval` and `pnpm eval:rag` before any change to chunking, embeddings, retrieval, or
prompts.** They report four separate numbers on purpose — a good answer built on bad context is a
retrieval bug waiting to surface elsewhere, and a blended score hides it.

### Layout

```
src/
  app/api/v1/      HTTP routes — parse, authorize, delegate. Nothing else
  services/        business logic
  repositories/    persistence
  lib/
    extractors/    one per source, pure and fixture-tested
    ai/            provider adapters, model chains, budget manager
    search/        FTS5 + vector + RRF fusion
    rag/           retrieval and answer assembly
  worker/          job loop and pipeline stages
  db/              Drizzle schema and client
prompts/           versioned prompt files, one per task
extension/         MV3 browser extension
docs/adr/          architecture decision records
```

### Before you change anything architectural

Read [`CLAUDE.md`](./CLAUDE.md) and the relevant [`docs/adr/`](./docs/adr/) entry. Several decisions
look wrong until you know the constraint behind them — in particular why embeddings are local, why
the extension does the scraping, and why enrichment is exactly one request.

---

## Deployment

Built by GitHub Actions → pushed to GHCR → pulled over SSH → `docker compose up -d`, behind an nginx
vhost with a certbot certificate. See [`deploy/`](./deploy/).

It is designed to be a **good neighbour** on a busy box — one container, hard `mem_limit: 1g`,
capped worker concurrency, and ONNX inference capped at 2 threads.

Most of that is the local embedding model: **~350 MB resident, measured**, of which almost all is
native onnxruntime memory that GC never returns. That is the price of embeddings that cost no API
quota and keep every search query on your own machine.

```bash
# Backup (nightly, automatic) — SQLite makes this trivial
sqlite3 data/sieve.db "VACUUM INTO '/backups/sieve-$(date +%F).db'"
```

A backup you haven't restored isn't a backup. The restore drill is part of the launch checklist.

---

## Prior art

[**Karakeep**](https://docs.karakeep.app/) (28k★, formerly Hoarder) is the closest existing project
and worth your time if you want something mature today. Sieve exists because Karakeep ships headless
Chrome and Meilisearch (~500 MB idle, 2 GB recommended) and doesn't cover the things this was built
for: YouTube transcription ([open request](https://github.com/karakeep-app/karakeep/issues/1629)),
structured repo enrichment, a research status workflow, or competes-with relations.

Also worth knowing: **Pocket shut down in 2025 and Omnivore was acquired and shut down in 2024.**
That's the case for self-hosting your reading pile.

---

## Licence

MIT — see [`LICENSE`](./LICENSE).

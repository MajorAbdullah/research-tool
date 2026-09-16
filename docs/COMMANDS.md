# Commands

Everything you can run, and when. `make` on its own prints the same list with one-line
descriptions.

Every `make` target is a thin wrapper over a `pnpm` script — both are listed so you can use
either. Nothing here is `make`-only.

---

## Setup, from a fresh clone

```bash
make install-all
```

That is the whole setup. It runs, in order:

| Step | What it does | Notes |
|---|---|---|
| `env-init` | Copies `.env.example` → `.env` if missing | Leaves an existing `.env` untouched |
| `install-deps` | `pnpm install` | **Slow the first time** — compiles `better-sqlite3`, `argon2` and `onnxruntime-node` from source. ~18 min observed on an M-series Mac |
| `db-migrate` | Creates `data/sieve.db` with all tables, the FTS5 index and the vector index | Idempotent |
| `db-seed` | Creates your single user from `SEED_USER_*` | Idempotent |
| `model-warm` | Downloads the ~128 MB embedding model into `.fastembed_cache/` | Without this, your first captured link pays a ~480 s download inside a pipeline job, which looks like a hang |

**Before it will actually work, put your OpenRouter key in `.env`:**

```bash
make env-init          # if you don't have a .env yet
$EDITOR .env           # set OPENROUTER_API_KEY
```

| Variable | Required? | Why |
|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | Enrichment fails without it. Extraction and search still work |
| `GITHUB_PAT` | recommended | Lifts the GitHub API from **60 → 5,000 req/hr**. Without it, repo enrichment stalls after ~60 repos in an hour |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | pre-filled | Your login. The password was generated — read it from `.env` |
| `EXTENSION_TOKEN` | pre-filled | The browser extension's bearer token |
| `AUTH_SECRET` | pre-filled | Session signing |

Then verify the AI path end to end:

```bash
make smoke-ai          # spends ~2 of your 1,000 daily free requests
```

It checks the capability probe, the local embedder, a real enrichment, topic assignment, and the
prompt-injection defence. If this passes, the hard parts work.

---

## Running it

There are two ways, **both on port 3060 — run one at a time.**

```bash
make dev               # host dev server, hot reload      ← everyday
make start             # docker container, production-like
```

`make dev` halts the container stack first if it's running, so you can switch freely without
hitting a port clash.

| Target | pnpm equivalent | Use when |
|---|---|---|
| `make dev` | `pnpm dev` | Developing. Hot reload, fast restarts |
| `make start` | `docker compose up -d --wait` | Checking it behaves the same way it will in production |
| `make stop` | `docker compose stop` | Halt containers, keep their state |
| `make restart` | `docker compose restart` | |
| `make status` | `docker compose ps` | |
| `make logs` | `docker compose logs -f` | |
| `make health` | `curl .../api/v1/health` | Quick "is it alive, and how much LLM quota is left" |

Migrations apply **automatically at boot** in every environment (`instrumentation.ts`), so there's
no separate migrate step in the run loop. `make db-migrate` exists for when you want it explicitly.

Once it's up: <http://localhost:3060> — log in with the `SEED_USER_*` values from `.env`.

---

## Using it

### Capture a link

```bash
# from the extension / any script (bearer auth)
source .env
curl -X POST http://localhost:3060/api/v1/capture \
  -H "Authorization: Bearer $EXTENSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/vllm-project/vllm","surface":"extension"}'
# -> {"id":"itm_1","status":"queued","duplicate":false}   in ~5ms
```

Capture **enqueues and returns immediately** — it never processes inline. Watch it progress with
`make logs`, or poll `GET /api/v1/items/itm_1`.

### Search

Search needs a **session cookie**, not the extension token (the token is capture-only). In the
browser you're already logged in. From the CLI:

```bash
source .env
CSRF=$(curl -s -c /tmp/sieve.jar http://localhost:3060/api/auth/csrf | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrfToken"])')
curl -s -b /tmp/sieve.jar -c /tmp/sieve.jar -X POST \
  http://localhost:3060/api/auth/callback/credentials \
  -d "csrfToken=$CSRF" -d "email=$SEED_USER_EMAIL" -d "password=$SEED_USER_PASSWORD" -o /dev/null

curl -s -b /tmp/sieve.jar -G http://localhost:3060/api/v1/search \
  --data-urlencode 'q=video diffusion fine-tuning' | python3 -m json.tool
```

Useful query params: `q`, `kind`, `topic`, `tag`, `status`, `extraction_tier`, `date_from`,
`date_to`, `cursor`, and `tier=fts` for the instant keyword-only tier.

### The browser extension

> **The app walks you through this.** Open **Settings → Connect your devices** in Sieve — it has
> the click-by-click steps, a **Reveal token** button, and copy buttons for both values you need.
> The steps below are the same thing in text form.

```bash
make build-ext
```

Then Chrome/Arc → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Open its options page and paste your server URL plus `EXTENSION_TOKEN`.

**Install it even if you mostly browse on your phone.** It is the only path to full YouTube
transcripts and to paywalled or Cloudflare-protected article text — the server's datacenter IP is
blocked by those sites, the extension's residential IP is not. See
[`docs/adr/0006`](adr/0006-browser-extension-as-extraction-engine.md).

### The phone (Android)

> Also covered in **Settings → Connect your devices**, which detects you're on a phone and opens
> on that tab.

There's no app to install — it's a PWA. Open your Sieve URL in Chrome on Android → menu →
**Install app**. "Sieve" then appears in the native share sheet from YouTube, Instagram and X.

**iOS:** Safari can add Sieve to your home screen, but Apple doesn't implement Web Share Target,
so it won't appear in the iOS share sheet. Use the extension or the paste box there.

---

## Inspecting data

```bash
make sqlite            # sqlite3 CLI against data/sieve.db
make db-studio         # drizzle-kit studio, browser UI
```

Handy queries once you're in `make sqlite`:

```sql
-- what's in the library, and did extraction degrade?
SELECT id, kind, status, extraction_tier, substr(title,1,40) FROM items ORDER BY id;

-- how much LLM quota have I burned today, and on which models?
SELECT prompt_version, model_resolved, count(*) FROM llm_calls GROUP BY 1,2;

-- anything stuck or failed?
SELECT id, status, failure_reason FROM items WHERE status IN ('failed','processing');
SELECT name, state, attempts, last_error FROM jobs WHERE state != 'completed';

-- topics actually being used
SELECT t.label, count(*) FROM item_topics it JOIN topics t ON t.id=it.topic_id GROUP BY 1;
```

---

## Quality gates

```bash
make check             # format:check + lint + typecheck — exactly what CI runs
make test              # the whole suite
```

| Target | pnpm | Scope |
|---|---|---|
| `make test` | `pnpm test` | Everything (~580 tests, a few seconds) |
| `make test-unit` | `pnpm test:unit` | Unit only |
| `make test-integration` | `pnpm test:integration` | Real in-memory SQLite, real migration |
| `make test-e2e` | `pnpm test:e2e` | Playwright; builds and starts the app |
| `make test-ui` | `pnpm test:watch` | Watch mode |
| `make lint` / `format` / `typecheck` | same | Individually |

**Do not upgrade `typescript` or `eslint`** without reading the pinned-version table in
[`CLAUDE.md`](../CLAUDE.md). TypeScript 7 breaks `typescript-eslint` entirely, and ESLint 10 breaks
it a different way. Both are pinned below `latest` deliberately.

---

## Evals — the only way to catch a silent search regression

```bash
make eval              # retrieval: context precision + recall.  SPENDS requests (hosted embeddings)
make eval-rag          # generation: faithfulness + relevancy.   SPENDS free-tier requests
```

**Run `make eval` after any change to chunking, embeddings, retrieval, or prompts.** Retrieval
getting worse does not throw an exception — nothing else will tell you. It used to be free; since
embeddings moved to OpenRouter (ADR 0003 amendment) each run spends a request per batch, so it is
no longer unlimited — still cheap enough to run on every retrieval change, just not in a loop.

The two are scored separately on purpose: a good answer built on bad context is a fragile system,
and a single blended number hides exactly that.

---

## Maintenance

```bash
make db-backup         # VACUUM INTO a timestamped copy; safe while running
make reembed           # re-embed every chunk — REQUIRED after changing the embedding model
make db-generate       # generate a new drizzle migration after editing schema.ts
```

**On `reembed`:** vectors from different embedding models are not comparable. The app refuses to
mix them and fails loudly at startup rather than silently corrupting search. If you change
`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS`, run this — it rebuilds
`chunk_vec` at the configured width (a vec0 table's width is fixed at CREATE, so switching between
the 2048-d hosted model and the 384-d local one *requires* it).

**On backups:** a backup you have never restored is not a backup. The restore procedure is in
[`deploy/RESTORE.md`](../deploy/RESTORE.md) — walk it once.

---

## Deploying

```bash
make deploy            # pull the GHCR image on the VPS and roll the container
```

You rarely run that by hand. **Every push to `master` deploys automatically** — CI builds the
image, pushes it to GHCR, and runs `deploy.sh` on the VPS over SSH. The image is built **once**
and promoted, never rebuilt per environment.

If the new container doesn't report healthy within 120 s, `deploy.sh` **rolls back to the previous
image by itself** and the Actions run goes red — so a bad push self-reverts rather than leaving the
site down. Setup, required GitHub secrets, the rollback messages, and the GHCR fine-grained-PAT
trap are all in [`deploy/README.md`](../deploy/README.md).

Production lifecycle, if you need it directly:

```bash
make production          make production-logs
make production-stop     make production-status
make production-restart
```

---

## Cleanup

| Target | Removes | Keeps |
|---|---|---|
| `make clean` | Containers | Database, model cache, images |
| `make clean-volumes` | Containers + named volumes | **Your database** (`./data` is a bind mount) |
| `make nuke` | Containers, volumes, local images, `.next`, model cache | **Your database** |
| `make db-reset` | **Your entire database**, then re-migrates and re-seeds | Nothing |

All four destructive targets prompt before acting. `db-reset` is the only one that deletes what
you've saved — the others leave `./data` alone because it's a bind mount, not a volume.

---

## Troubleshooting

**`EADDRINUSE` on 3060.** Something's already there — usually a container from `make start` or a
stray `next start`. `make stop` handles the container. For a stray process:
`lsof -ti:3060 | xargs kill`.

**First captured link seems to hang.** Only on `EMBEDDING_PROVIDER=local` — the embedding model is
downloading (~128 MB, ~480 s); run `make model-warm` once and it never happens again. The default
hosted provider downloads nothing.

**Search results got noticeably worse and `make health` shows no quota left.** Expected: with
hosted embeddings, search degrades to keyword-only (FTS) once the daily budget is spent, rather
than erroring. It recovers at the UTC reset. The server logs `degrading to keyword-only (FTS)`
each time it happens.

**Repo enrichment stops working.** You've hit GitHub's 60 req/hr unauthenticated limit. Set
`GITHUB_PAT` in `.env` for 5,000/hr.

**Summaries stop appearing but capture and search still work.** You've spent the day's LLM budget.
`make health` shows `llm_quota`. This is by design — items still get captured, extracted, embedded
and indexed; only summaries wait for the UTC-midnight reset. Nothing is lost.

**An item shows "metadata only".** The server's IP was blocked for that source. Open the page with
the extension installed and hit **Re-extract** — it'll capture the real content from your browser.

**`make eval` numbers dropped.** Something in chunking, embeddings, retrieval, or a prompt changed.
Check `git log` on `src/lib/search/`, `src/lib/embeddings/` and `prompts/`. See
[`prompts/CHANGELOG.md`](../prompts/CHANGELOG.md).

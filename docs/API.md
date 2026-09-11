# Sieve HTTP API — v1

> **Status:** Frozen contract (P0) · **Base path:** `/api/v1` · **Format:** JSON unless noted
> This is the single source of truth for Sieve's HTTP surface. The browser extension (P4) and
> the server-side route handlers (P8, P9, P11, P12, P13) are built by different agents, in
> parallel, from opposite sides of this document, without reading each other's code. If something
> here is ambiguous, fix this document — don't guess and don't diverge.
>
> Everything not in scope of this document (page routes, the PWA `/share` handler's internal
> wiring, job payload shapes, the DB schema) belongs to the phases that own those files. This doc
> only defines what crosses the wire.

## Table of contents

1. [Conventions](#1-conventions)
   1.1 [Base URL & versioning](#11-base-url--versioning)
   1.2 [Authentication](#12-authentication)
   1.3 [Content types & timestamps](#13-content-types--timestamps)
   1.4 [Response envelope](#14-response-envelope)
   1.5 [Error shape](#15-error-shape)
   1.6 [Pagination](#16-pagination)
   1.7 [Rate limits & payload caps](#17-rate-limits--payload-caps)
   1.8 [Extraction tier — degradation must be visible](#18-extraction-tier--degradation-must-be-visible)
2. [Shared types](#2-shared-types)
3. [Endpoints](#3-endpoints)
   - [`POST /api/v1/capture`](#31-post-apiv1capture)
   - [`GET /api/v1/search`](#32-get-apiv1search)
   - [`GET /api/v1/items`](#33-get-apiv1items)
   - [`GET /api/v1/items/:id`](#34-get-apiv1itemsid)
   - [`PATCH /api/v1/items/:id`](#35-patch-apiv1itemsid)
   - [`PATCH /api/v1/items/:id/status`](#36-patch-apiv1itemsidstatus)
   - [`POST /api/v1/items/:id/retry`](#37-post-apiv1itemsidretry)
   - [`POST /api/v1/chat`](#38-post-apiv1chat)
   - [`POST /api/v1/import`](#39-post-apiv1import)
   - [`GET /api/v1/import/:id`](#310-get-apiv1importid)
   - [`GET /api/v1/health`](#311-get-apiv1health)
4. [Design notes — ambiguities resolved while writing this contract](#4-design-notes--ambiguities-resolved-while-writing-this-contract)

---

## 1. Conventions

### 1.1 Base URL & versioning

All routes are versioned from the first endpoint: `/api/v1/...`. There is no unversioned API.
A future breaking change ships as `/api/v2/...` alongside `/api/v1/...`, never as an in-place
change to a v1 shape.

- Local dev: `http://localhost:3060/api/v1/...`
- Prod: `https://sieve.teknikki.com/api/v1/...`

### 1.2 Authentication

Sieve has exactly one user, but three different kinds of caller hit this API, and they don't all
have the same thing available to them:

| Caller | Mechanism | Header |
|---|---|---|
| Browser extension (P4) | Bearer token | `Authorization: Bearer <EXTENSION_TOKEN>` |
| Android PWA share target (P8.2/8.3) | Bearer token | `Authorization: Bearer <EXTENSION_TOKEN>` |
| Web app (logged-in browser session: paste box, library, board, chat, import) | Session cookie | Auth.js httpOnly cookie, sent automatically by the browser |

`EXTENSION_TOKEN` is a single static secret (see `.env.example`) configured once and pasted into
the extension's options page. It is **only** valid on `POST /api/v1/capture` — this is a
deliberate least-privilege boundary: a leaked extension token lets someone add items to your
library, never read, search, delete, or chat against it. Every other endpoint accepts the session
cookie only, established by signing in at `/login` (Auth.js, outside this document's scope).

> **Why the PWA also uses the bearer token, not the session cookie:** Android's Web Share Target
> POST is not guaranteed to attach a same-origin session cookie the same way an ordinary
> navigation does, especially for an installed, standalone-display-mode PWA across the range of
> Android/Chrome versions Sieve has to work on. Rather than build a fragile capture path that
> quietly breaks on some Android version, the `/share` route (P8-owned, not part of this
> versioned API) treats itself as another trusted headless caller and forwards to
> `POST /api/v1/capture` the same way the extension does. Don't "simplify" this to cookie-only
> auth without re-verifying that assumption on real devices first.

Per-endpoint auth is restated in every endpoint section below so neither building agent has to
cross-reference this table while implementing.

`GET /api/v1/health` is the one unauthenticated endpoint (needed by Docker's healthcheck and any
uptime monitor, per P1.3.3's middleware carve-out).

### 1.3 Content types & timestamps

- Request and response bodies are `application/json` unless stated otherwise (`POST /api/v1/import`
  accepts `multipart/form-data` for file upload; `POST /api/v1/chat` responds with
  `text/event-stream`).
- **Every timestamp in every response is UTC epoch-milliseconds** (a JSON number, e.g.
  `1789222985000`), never an ISO string, never a local time. Convert to a display format only in
  the UI layer. Request bodies that carry a timestamp (none currently do) would follow the same
  rule.
- IDs are opaque strings with a type-prefix (`itm_...` for items, `imp_...` for imports). Treat
  them as opaque — don't parse structure out of them, don't construct them client-side.

### 1.4 Response envelope

There are exactly three top-level response shapes in this API:

1. **Single resource** — the resource itself, as the top-level JSON object. Used by every
   endpoint that returns one item, one import, or a small custom ack (capture, retry).
2. **Collection** — `{ "data": [...], "page": { "next_cursor": string | null, "has_more": boolean } }`.
   Used by every list endpoint (§1.6).
3. **Error** — `{ "error": { ... } }` (§1.5). Used whenever the HTTP status is 4xx/5xx.

Nothing in this API wraps a single resource in a `data` key, and nothing returns a bare array —
both are common inconsistencies this rule exists to prevent.

### 1.5 Error shape

**One error shape, every endpoint, no exceptions:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "url is required",
    "details": { "field": "url", "reason": "missing" },
    "request_id": "req_01K4Q3ZJXENBWQXG3F6R8T9Y2M"
  }
}
```

- `code` — a stable, machine-matchable string from the table below. Clients switch on `code`,
  never on `message`.
- `message` — a short, **display-safe** human sentence. Safe to render directly in a toast.
- `details` — optional, `null` when there's nothing structured to add. Shape is endpoint-specific
  (e.g. field name for validation errors, `{from, to, allowed_next}` for a bad status transition).
  Never contains a stack trace, a raw driver/SQL error, or a file path.
- `request_id` — opaque, generated per request, also written to the server's structured log line
  for that request. It's how "the client saw error X" becomes "here's the actual stack trace in
  the logs" without ever putting that stack trace over the wire. Report this value back when
  filing a bug against Sieve itself.

**Internals are never leaked.** No response body, under any endpoint, under any failure mode,
ever contains a stack trace, a raw SQLite/driver error message, an internal file path, or an
env var value. `INTERNAL_ERROR` responses always carry the same generic message
(`"Something went wrong. Try again."`) regardless of what actually failed — the real detail lives
only in the server log, keyed by `request_id`.

| `code` | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query failed schema validation (Zod, at the boundary) |
| `UNAUTHORIZED` | 401 | Missing/invalid bearer token, or no/expired session |
| `FORBIDDEN` | 403 | Authenticated but not permitted. Reserved — Sieve is single-user today, so this shouldn't fire in practice; kept for when a second user exists |
| `NOT_FOUND` | 404 | No such resource, **or it exists but belongs to another user** — these are indistinguishable on purpose (never leak existence across the `user_id` boundary) |
| `INVALID_STATUS_TRANSITION` | 400 | The requested status change isn't a legal move from the item's current status (§3.6) |
| `CONFLICT` | 409 | The request conflicts with in-progress server state (e.g. a retry is already running for this item+stage) |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeded the endpoint's size cap (§1.7) |
| `RATE_LIMITED` | 429 | Too many requests; see the `Retry-After` header (seconds) |
| `LLM_BUDGET_EXHAUSTED` | 503 | The account-wide daily OpenRouter free-tier budget — including the 100-request interactive reserve — is spent. Only possible on `POST /api/v1/chat`; every other endpoint stays fully functional at zero budget (this is a core design property, see `.env.example` and CLAUDE.md's "Free-Tier Budget" section) |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### 1.6 Pagination

**Every list endpoint is cursor-paginated by default.** There is no offset/page-number pagination
anywhere in this API — offset pagination silently skips or repeats rows under concurrent writes,
which a single-user library absolutely will have (the worker is writing while you're scrolling).

Request query params, identical across every list endpoint:

| Param | Type | Default | Notes |
|---|---|---|---|
| `cursor` | string | — (first page) | Opaque. Pass back **exactly** the `next_cursor` value from the previous response. Never construct one. |
| `limit` | integer | `20` | Max `100`. Values outside `1..100` are clamped, not rejected. |

Response shape:

```json
{
  "data": [ /* array of the resource, newest-first unless a sort param says otherwise */ ],
  "page": {
    "next_cursor": "eyJjcmVhdGVkX2F0IjoxNzg5MDMwODAwMDAwLCJpZCI6Iml0bV8wMUo4WiJ9",
    "has_more": true
  }
}
```

`next_cursor` is `null` and `has_more` is `false` on the last page. The cursor encodes the sort
key plus the row id (so ties on the sort column don't drop or duplicate rows) — implementation
detail, callers must not depend on its internal structure.

### 1.7 Rate limits & payload caps

- `POST /api/v1/capture` is the one endpoint reachable with a long-lived bearer token instead of a
  live session, so it's the one most exposed if that token ever leaks. Default: **60 requests/min
  per token**, `429 RATE_LIMITED` beyond that with `Retry-After: <seconds>`. This number is a
  tunable default (P14 owns final hardening values), not a hard architectural constraint.
- `POST /api/v1/capture` request body: capped at **2 MB**. The extension itself caps its captured
  `html`/`transcript` payload at 1 MB with graceful truncation (P4.2.5) — the server enforces its
  own, slightly larger hard cap independently and rejects with `413 PAYLOAD_TOO_LARGE` rather than
  trusting the client to have truncated correctly.
- `POST /api/v1/import` file upload: capped at **50 MB** (P12.3). Beyond that, `413 PAYLOAD_TOO_LARGE`.
- `POST /api/v1/chat` message: capped at **4,000 characters**. `400 VALIDATION_ERROR` beyond that.

### 1.8 Extraction tier — degradation must be visible

Every item carries an `extraction_tier`, and every response that includes an item **must**
surface it. This is not optional polish — it's the difference between "Sieve quietly gives you a
worse result" and "Sieve tells you exactly how much it actually got, and how to get more."

| Value | Meaning |
|---|---|
| `full` | The extraction ladder's best rung succeeded — e.g. a full YouTube transcript, full article text, a complete GitHub README |
| `partial` | A middle rung succeeded — e.g. YouTube oEmbed + timedtext after the transcript scrape failed, or OG metadata plus a partial DOM capture |
| `metadata_only` | Every content rung failed; all Sieve has is title/thumbnail/URL (and whatever note you added) |

Clients (library cards, item detail, search results) show a visible tier indicator whenever tier
is not `full` (e.g. "⚠ metadata only — open with the extension to enrich"), and every surface that
shows an item also exposes a path to `POST /api/v1/items/:id/retry` with `stage: "extract"`. A UI
that hides this because "the summary still reads fine" defeats the entire point of tracking it —
see CLAUDE.md, "Never let extraction failure look like success."

---

## 2. Shared types

These are the wire shapes referenced throughout §3. They mirror (but are not identical to —
this is the *HTTP* contract, not the DB schema) the tables in the implementation plan §6.

```ts
type ItemKind = "github" | "video" | "article" | "social" | "pdf" | "audio" | "other";

type ItemStatus =
  | "queued"      // captured, not yet picked up by the pipeline — pipeline-owned
  | "processing"  // pipeline is running — pipeline-owned
  | "inbox"       // pipeline finished, unreviewed — first board column
  | "to_test"
  | "testing"
  | "tested"
  | "archived"
  | "dropped"
  | "failed";     // pipeline hit a permanent error — pipeline-owned, see failure_reason

type ExtractionTier = "full" | "partial" | "metadata_only";

type SourceSurface = "extension" | "pwa" | "web" | "import";

type JobStage = "resolve" | "extract" | "enrich" | "embed" | "relate" | "index";

type RelationType = "alternative" | "similar" | "supersedes";

interface Topic {
  slug: string;
  label: string;
  color: string;       // CSS color token, e.g. "#6366f1"
  confidence: number;  // 0..1, how sure the enrichment step was; 1.0 for a manual override
}

/** Returned in every list of items (search results, GET /items) */
interface ItemSummary {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  title: string | null;
  author: string | null;
  url: string;                 // as originally submitted
  canonical_url: string;       // normalized: utm_* / si / igshid stripped, shorteners resolved
  thumbnail_url: string | null;
  extraction_tier: ExtractionTier;
  source_surface: SourceSurface;
  summary_tldr: string | null;
  topic: Topic | null;         // the item's single primary topic — see §4
  tags: string[];               // tag labels, not ids
  starred: boolean;
  board_rank: number | null;
  created_at: number;          // epoch ms
  updated_at: number;
  last_opened_at: number | null;
}

/** GET /api/v1/items/:id and the object returned by mutating endpoints */
interface Item extends ItemSummary {
  summary_bullets: string[];              // 3-5 bullets from enrichment
  content_text: string | null;            // full extracted text/transcript, for the reader view
  published_at: number | null;            // from source metadata, not always known
  kind_fields: GithubKindFields | null;    // shape below; other kinds currently null
  note: string | null;                    // your own note; seeded by capture's `note`, editable
  outcome_note: string | null;            // "worked / didn't / why" — set once Tested (P11.7)
  failure_reason: string | null;          // human-readable, only set when status = "failed"
  relations: ItemRelation[];
}

interface GithubKindFields {
  language: string | null;
  stars: number;
  license: string | null;
  last_commit: number | null;   // epoch ms
  what_it_does: string | null;      // LLM-derived (P3.2.2)
  primary_use_case: string | null;  // LLM-derived (P3.2.2)
}

interface ItemRelation {
  item_id: string;
  title: string | null;
  kind: ItemKind;
  type: RelationType;
  rationale: string;
  score: number;   // 0..1
}
```

---

## 3. Endpoints

### 3.1 `POST /api/v1/capture`

**The most important endpoint in this document.** Read the callout below before touching it.

**Auth:** Bearer `EXTENSION_TOKEN` (extension, PWA share target) **or** session cookie (web paste
box, and any first-party web UI action that saves a link).

**Performance contract:** responds in **under 300 ms**, always. It enqueues a job and returns —
it **never** runs extraction, calls an LLM, or does any network I/O to the target URL inline. If
you find yourself wanting to `await` a fetch to the saved URL inside this route handler, stop:
that work belongs in the `resolve`/`extract` job stages (P7), not here.

#### Why this endpoint accepts client-captured `html` / `transcript` / `caption`

**Read this before "simplifying" this endpoint by dropping these fields.** Sieve's server runs on
a datacenter VPS IP. YouTube, Instagram, X, and Cloudflare-fronted sites treat datacenter IPs as
bots — `yt-dlp` and friends get `RequestBlocked`/429 after a couple hundred requests from that IP,
permanently, no matter how the retry logic is tuned. A server-only design degrades to
"title + thumbnail" for exactly the sources that make this tool worth having.

The fix is that **the browser extension is the extraction engine, not a convenience wrapper
around the API.** It runs in your actual browser, on your residential IP, already logged into
whatever site you're on, and does the extraction client-side: it reads the rendered DOM, opens and
scrapes YouTube's transcript panel, walks an X/Threads reply chain, or grabs an Instagram Reel's
caption from the open post — then POSTs the *result* here alongside the URL. The server never
talks to YouTube or Instagram directly for these fields; it just stores what the extension already
extracted. No proxies, no cookies on the server, no arms race with anti-bot systems, and it costs
literally nothing.

If a future maintainer removes `html`/`transcript`/`caption` from this contract to "clean up the
API," every YouTube video and Instagram Reel captured through the extension silently drops back to
`metadata_only`, and nothing will fail loudly to tell you that happened — it'll just look like
Sieve got worse at summarizing videos. Don't do that.

#### Request

```ts
interface CaptureRequest {
  url: string;              // required, http(s) only
  title?: string;            // page title, if the caller has one handy
  note?: string;              // free text; seeds items.note (see §4 re: "topic hint")
  html?: string;               // client-captured post-render outerHTML (article/X/Threads)
  transcript?: string;         // client-captured YouTube transcript, timestamped text
  caption?: string;            // Instagram Reel caption (or any short client-captured text)
  surface: SourceSurface;      // required — which capture path this came from
}
```

`url` and `surface` are the only required fields. Everything else is optional because not every
surface can produce it — the Android share sheet gives you a caption, not a DOM; the paste box
gives you a bare URL and nothing else.

#### Response

**New item:** `202 Accepted`

```json
{ "id": "itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ", "status": "queued", "duplicate": false }
```

**Duplicate `url_hash`:** `202 Accepted` (see §4 for why this isn't a 200/409) — `updated_at` is
touched, no new row is created, and the existing item's **current** status is returned (not
necessarily `"queued"` — if it already reached `inbox` days ago, that's what comes back):

```json
{ "id": "itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ", "status": "inbox", "duplicate": true }
```

If a duplicate capture arrives **with** `html`/`transcript`/`caption` that the stored item doesn't
already have — the "I re-shared this from the extension hoping to upgrade it past
`metadata_only`" case — the server stores the new content and automatically enqueues a re-run
from the `extract` stage. In that case `status` in the response is `"queued"` even though the item
isn't new, reflecting that the pipeline is running again.

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/invalid `url`, missing/invalid `surface` |
| 401 | `UNAUTHORIZED` | Bad/missing bearer token and no valid session |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 2 MB (§1.7) |
| 429 | `RATE_LIMITED` | Over 60 req/min for this token (§1.7) |

#### `curl` example

```bash
curl -sS -X POST "http://localhost:3060/api/v1/capture" \
  -H "Authorization: Bearer $EXTENSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "title": "Scaling agentic RAG evals to 10k queries",
    "surface": "extension",
    "transcript": "[00:00] Today we are looking at how eval harnesses break down past...(full timestamped transcript)..."
  }'
# => 202 {"id":"itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ","status":"queued","duplicate":false}
```

---

### 3.2 `GET /api/v1/search`

Hybrid search: FTS5 (`bm25()`) fused with `sqlite-vec` kNN via Reciprocal Rank Fusion (`k=60`).
Query embedding runs on the local embedding model — **search never spends OpenRouter quota**.

**Auth:** session cookie only.

#### Query parameters

| Param | Type | Required | Notes |
|---|---|---|---|
| `q` | string | **yes** | The search text |
| `kind` | comma-separated `ItemKind` | no | e.g. `kind=github,video` |
| `topic` | comma-separated topic slug | no | |
| `status` | comma-separated `ItemStatus` | no | |
| `tag` | comma-separated tag label | no | |
| `extraction_tier` | comma-separated `ExtractionTier` | no | |
| `date_from` | epoch ms | no | Inclusive lower bound on `created_at` |
| `date_to` | epoch ms | no | Inclusive upper bound on `created_at` |
| `cursor` | string | no | §1.6 |
| `limit` | integer | no | §1.6, default 20, max 100 |

All filters combine with AND; values within one filter combine with OR (`kind=github,video` means
"github or video"). Filters and `q` are URL-encoded and safe to persist in a shareable link
(P10.1.3's "shareable filter URLs" requirement applies here too).

#### Response — `200 OK`

```json
{
  "data": [
    {
      "id": "itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ",
      "kind": "video",
      "status": "inbox",
      "title": "this changes everything 🤯",
      "author": "@diffusion_daily",
      "url": "https://www.instagram.com/reel/Cxyz123/",
      "canonical_url": "https://www.instagram.com/reel/Cxyz123/",
      "thumbnail_url": "https://.../thumb.jpg",
      "extraction_tier": "full",
      "source_surface": "extension",
      "summary_tldr": "A walkthrough of fine-tuning a video diffusion model on a small dataset.",
      "topic": { "slug": "video-diffusion", "label": "Video Diffusion", "color": "#8b5cf6", "confidence": 0.86 },
      "tags": ["diffusion", "fine-tuning"],
      "starred": false,
      "board_rank": 1024,
      "created_at": 1789030800000,
      "updated_at": 1789030800000,
      "last_opened_at": null,
      "snippet": "...walking through fine-tuning a video diffusion checkpoint on a curated 2k-clip dataset before...",
      "score": 0.0421
    }
  ],
  "page": { "next_cursor": null, "has_more": false }
}
```

Each result is an `ItemSummary` plus two search-only fields:

- `snippet` — a short plain-text excerpt from the best-matching chunk. Returned as plain text, not
  pre-highlighted HTML, so the client controls how matched terms are visually marked (and so the
  server never has to trust its own HTML-injection into a response).
- `score` — the fused RRF score. Useful for debugging/tuning; not meant to be shown to the user
  as a raw number.

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `q`, or a filter value outside its enum |
| 401 | `UNAUTHORIZED` | No valid session |

#### `curl` example

```bash
curl -sS -G "http://localhost:3060/api/v1/search" \
  -H "Cookie: <session-cookie>" \
  --data-urlencode "q=video diffusion fine-tuning" \
  --data-urlencode "kind=video,social" \
  --data-urlencode "limit=10"
```

---

### 3.3 `GET /api/v1/items`

Unfiltered/filtered browsing for the Library UI (P10) — same filter vocabulary as search, minus
`q`, plus `sort`. Grouping (by kind/topic/status/date, P10.1.4) is a client-side view over this
same flat, sorted, filtered list — the server doesn't have a separate "grouped" response shape.

**Auth:** session cookie only.

#### Query parameters

Same as §3.2 (`kind`, `topic`, `status`, `tag`, `extraction_tier`, `date_from`, `date_to`,
`cursor`, `limit`), plus:

| Param | Type | Default | Notes |
|---|---|---|---|
| `sort` | `newest` \| `oldest` \| `recently_opened` \| `most_related` | `newest` | `newest`/`oldest` sort on `created_at`; `recently_opened` on `last_opened_at` (nulls last); `most_related` on relation count, descending |

#### Response — `200 OK`

Same collection envelope as search, `data: ItemSummary[]` (no `snippet`/`score`).

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A filter or `sort` value outside its enum |
| 401 | `UNAUTHORIZED` | No valid session |

---

### 3.4 `GET /api/v1/items/:id`

**Auth:** session cookie only.

#### Response — `200 OK`

The full `Item` shape from §2, including `content_text` (for the collapsible reader view,
P10.2.4), `kind_fields` (repo table, P10.2.2), and `relations` (alternatives panel, P10.2.3) —
this endpoint is the one place all three come back together, so the item detail page needs
exactly one request.

#### Errors

| Status | `code` | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | No such item, or it belongs to another user |

---

### 3.5 `PATCH /api/v1/items/:id`

Manual edits: note, star, tags, topic override. **Not** for status or outcome — see §3.6 for
status and note the state-machine validation lives there, deliberately separated from free-text
edits.

**Auth:** session cookie only.

#### Request

Every field is optional; omit a field to leave it unchanged. All fields use PATCH-merge semantics
except `tags`, which is a full replacement (see §4 for why).

```ts
interface ItemPatchRequest {
  note?: string | null;          // null clears it
  outcome_note?: string | null;  // null clears it
  starred?: boolean;
  tags?: string[];               // FULL REPLACEMENT of the item's tag set, not an add/remove diff
  topic?: string | null;         // topic slug to set as primary; null clears the override,
                                  // reverting to whatever the AI last assigned
}
```

Setting `topic` to a slug that doesn't exist yet **creates it** (this is a manual, human curation
action — distinct from the LLM's own topic-creation, which is threshold-gated per CLAUDE.md's
prompt-injection defenses; that gate constrains the model during enrichment, not you editing your
own library).

#### Response — `200 OK`

The full updated `Item` (§2).

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field fails validation (e.g. `tags` isn't an array of strings, or has more entries than the cap) |
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | No such item, or it belongs to another user |

---

### 3.6 `PATCH /api/v1/items/:id/status`

Board drag-and-drop (P11) lands here. **Every transition is validated against a fixed state
machine — invalid transitions are rejected with `400`, they do not silently clamp to the nearest
legal state.**

**Auth:** session cookie only.

#### Request

```json
{ "status": "to_test" }
```

#### The state machine

| From \ status | Allowed `to` |
|---|---|
| `queued` | — none (pipeline-owned; not reachable through this endpoint in either direction) |
| `processing` | — none (pipeline-owned) |
| `inbox` | `to_test`, `testing`, `tested`, `archived`, `dropped` |
| `to_test` | `inbox`, `testing`, `tested`, `archived`, `dropped` |
| `testing` | `inbox`, `to_test`, `tested`, `archived`, `dropped` |
| `tested` | `inbox`, `to_test`, `testing`, `archived`, `dropped` |
| `archived` | `inbox` only |
| `dropped` | `inbox` only |
| `failed` | — none. Use `POST /api/v1/items/:id/retry` instead |

In words: the four board columns (`inbox`/`to_test`/`testing`/`tested`) are freely
interchangeable in any direction — it's a kanban board, not a one-way pipeline, and you're
allowed to drag something backwards when you realize you need to re-test it. `archived` and
`dropped` are reachable from any of those four, and both restore only back to `inbox` (not
directly into `to_test`/`testing`/`tested` — restoring re-enters the triage queue rather than
jumping back to wherever it happened to be, which keeps this table small and keeps "restore"
meaning one thing). `queued`/`processing`/`failed` are pipeline-owned states nothing in the UI can
set directly.

#### Response — `200 OK`

The full updated `Item` (§2).

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `status` missing or not a valid `ItemStatus` value |
| 400 | `INVALID_STATUS_TRANSITION` | `status` is valid but not reachable from the item's current status. `details: { "from": "inbox", "to": "queued", "allowed_next": ["to_test","testing","tested","archived","dropped"] }` |
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | No such item, or it belongs to another user |

---

### 3.7 `POST /api/v1/items/:id/retry`

Re-runs the pipeline from a named stage — backs both the "Re-extract" and "Re-enrich" buttons
(P10.2.6), and the "retry from stage" mechanism used after any per-stage failure (P7.7/P7.8).
Enqueues only, same latency contract as capture (§3.1): responds fast, does no inline work.

**Auth:** session cookie only.

#### Request

```ts
interface RetryRequest {
  stage: JobStage;      // required — no default. Caller always knows which button was clicked
  html?: string;         // optional fresh client-captured content, same meaning as in capture
  transcript?: string;
  caption?: string;
}
```

`stage` is required rather than defaulting to a "sensible" stage — the two real buttons in the UI
(P10.2.6) are explicitly "Re-extract" (`stage: "extract"`) and "Re-enrich" (`stage: "enrich"`), so
the caller always knows exactly which one it wants. A silent default would hide a real choice.

If `html`/`transcript`/`caption` are provided, they overwrite the item's stored raw content before
the named stage runs — this is how "open the item, run the extension again now that you're logged
into the site, click Re-extract" is supposed to work.

#### Response — `202 Accepted`

```json
{ "id": "itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ", "status": "queued", "stage": "extract" }
```

#### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `stage` missing or not one of the six valid `JobStage` values |
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | No such item, or it belongs to another user |
| 409 | `CONFLICT` | A job for this item at this stage is already pending or running |

---

### 3.8 `POST /api/v1/chat`

Ask-my-library chat (P13). Retrieval (hybrid search over your chunks) happens first; the answer
streams over **Server-Sent Events**; citations are established *before* generation starts, since
retrieval already knows which chunks it handed the model.

**Auth:** session cookie only. The extension bearer token is never accepted here — chat isn't
something the extension does.

#### Request

```ts
interface ChatRequest {
  message: string;               // required, max 4,000 chars
  conversation_id?: string;       // omit to start a new conversation
  filters?: {
    kind?: ItemKind;
    topic?: string;               // topic slug — "only search my repos" (P13.6)
  };
}
```

#### Response

`200 OK`, `Content-Type: text/event-stream`. The initial `200` is sent only after the request body
has been fully validated and retrieval has started — a `VALIDATION_ERROR`/`UNAUTHORIZED` is a
normal JSON error response with the matching 4xx status, sent **before** the stream begins.
Once the stream starts, headers are already committed, so **failures after that point are
signaled as an SSE event, never an HTTP status** — there is no way to change the status code
mid-stream, and pretending otherwise is a bug.

Event sequence:

1. **`event: sources`** — sent once, immediately after retrieval, before any generation token.
   The numbered reference list the model was given and told to cite as `[1]`, `[2]`, etc.

   ```
   event: sources
   data: {"sources":[{"index":1,"item_id":"itm_01K4Q3ZJX8N6R0V8H3T2F9Y7WQ","title":"this changes everything 🤯"},{"index":2,"item_id":"itm_01K4Q3ZK1QF2H9V0T8R3Y7WNXM","title":"Video Diffusion Fine-Tuning Cookbook"}]}
   ```

2. **`event: token`** — repeated, one per incremental chunk of the answer. May contain inline
   `[1]`/`[2]` markers referencing the `sources` list above.

   ```
   event: token
   data: {"text":"You saved two things on this: a Reel walking through fine-tuning on a small clip dataset [1], and a cookbook-style repo covering the same technique in more depth [2]."}
   ```

3. **`event: done`** — always the final event on success.

   ```
   event: done
   data: {"conversation_id":"cnv_01K4Q3ZM7WYB2E9F0T6R8Y3NXP","message_id":"msg_01K4Q3ZM8AB3F1G2H7S9T4KLMN","grounded":true}
   ```

   `grounded: false` marks the "I have nothing saved about that" path (P13.5): when retrieval
   comes back too weak to answer from, the server **skips the generation call entirely** (an
   empty/weak retrieval answering "I don't know" doesn't need to spend free-tier quota to say so)
   and streams a single fixed `token` event with that message, followed by `done` with
   `sources: []` and `grounded: false`. Clients use this flag to suppress citation chips rather
   than trying to parse them out of a message that has none.

4. **`event: error`** — only if something fails *after* the stream has already started (model
   chain exhausted, timeout, budget hit mid-stream). Terminal — no `done` follows it.

   ```
   event: error
   data: {"error":{"code":"LLM_BUDGET_EXHAUSTED","message":"Today's AI budget is spent. Resumes at midnight UTC.","details":{"resets_at":1789257600000},"request_id":"req_01K4Q3ZN2C4D5E6F7G8H9J0KLQ"}}
   ```

#### Pre-stream errors

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `message` missing/empty/over 4,000 chars, or `filters` references an unknown enum value |
| 401 | `UNAUTHORIZED` | No valid session |
| 503 | `LLM_BUDGET_EXHAUSTED` | The interactive reserve is already spent *before* retrieval even starts (rare — see `.env.example`) |

#### `curl` example

```bash
curl -N -sS -X POST "http://localhost:3060/api/v1/chat" \
  -H "Cookie: <session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What did I save about long-context evals?"}'
```

(`-N` disables curl's output buffering so SSE events print as they arrive, not all at once at the
end.)

---

### 3.9 `POST /api/v1/import` + `GET /api/v1/import/:id`

WhatsApp backlog import (P12): upload → dry-run preview → commit → throttled, resumable backfill.

**Auth:** session cookie only (this is a manual, one-time-per-export web UI action, not something
the extension or PWA ever does).

This is the one pair of endpoints in this document handling more than a single request shape,
because the task list gives exactly two routes (`POST /api/v1/import`, `GET /api/v1/import/:id`)
to cover four distinct capabilities (upload, dry-run, progress, pause/resume). `POST` is
overloaded by content type and body shape rather than inventing extra routes — see §4.

#### 3.9.1 Starting an import — `POST /api/v1/import`, `multipart/form-data`

```
POST /api/v1/import
Content-Type: multipart/form-data

file: <_chat.txt or .zip export, max 50 MB>
mode: "dry_run" | "commit"     (optional, default "dry_run" — never commit by accident)
```

The file is parsed synchronously (it's local text parsing, no network/LLM calls, bounded even at
50 MB) and always persisted as an import record, regardless of `mode` — a later `commit` doesn't
need to re-upload it.

- **`mode: "dry_run"`** (or omitted): parses and returns a preview. Nothing is written to `items`.
- **`mode: "commit"`**: parses (if this is the first call for this file) and immediately begins
  queueing links for capture, respecting the daily LLM cap and auto-resuming the next UTC day
  (P12.5) — this call still returns immediately; the import drains in the background.

Response — `202 Accepted`:

```json
{
  "id": "imp_01K4Q3ZP5T6U7V8W9X0Y1Z2AB",
  "state": "previewed",
  "total_links": 812,
  "duplicate_count": 47,
  "by_kind": { "github": 210, "video": 340, "article": 190, "social": 60, "pdf": 12, "other": 0 }
}
```

`state: "previewed"` for a dry run, `state: "running"` if `mode: "commit"` was passed directly on
first upload.

#### 3.9.2 Controlling an existing import — `POST /api/v1/import`, `application/json`

```json
{ "import_id": "imp_01K4Q3ZP5T6U7V8W9X0Y1Z2AB", "action": "commit" }
```

`action` is one of:

| Action | Valid from `state` | Effect |
|---|---|---|
| `commit` | `previewed` | Starts queueing links, moves to `running` |
| `pause` | `running` | Stops queueing new links; already-queued jobs still drain; moves to `paused` |
| `resume` | `paused` | Moves back to `running` |
| `cancel` | `previewed`, `running`, `paused` | Stops for good; already-created items are kept, nothing further is queued; moves to `failed`* |

<sub>* `cancel` reuses the `failed` state value rather than adding a fifth state purely for
"cancelled" — `GET /api/v1/import/:id` distinguishes the two via `error` being `null` vs set.</sub>

Response — `200 OK`: the same shape as `GET /api/v1/import/:id` (§3.10), reflecting the new state.

#### Errors (both request shapes)

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | No file on a new upload, unparseable export, invalid `mode`/`action` |
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | `import_id` doesn't exist or belongs to another user |
| 409 | `CONFLICT` | `action` isn't valid from the import's current `state` (e.g. `resume` on something that's `running`) |
| 413 | `PAYLOAD_TOO_LARGE` | File over 50 MB |

---

### 3.10 `GET /api/v1/import/:id`

The import dashboard (P12.6): totals, progress, ETA. Progress survives a server restart because
it's derived from real job/item state, not in-memory counters.

**Auth:** session cookie only.

#### Response — `200 OK`

```json
{
  "id": "imp_01K4Q3ZP5T6U7V8W9X0Y1Z2AB",
  "state": "running",
  "total_links": 812,
  "duplicate_count": 47,
  "by_kind": { "github": 210, "video": 340, "article": 190, "social": 60, "pdf": 12, "other": 0 },
  "queued": 340,
  "done": 420,
  "failed": 5,
  "eta_ms": 41400000,
  "error": null,
  "created_at": 1789030800000,
  "updated_at": 1789222985000
}
```

`state` is one of `previewed | running | paused | completed | failed`. `eta_ms` is a rough
estimate derived from the remaining `queued` count and the current LLM daily-cap pacing (it will
be large — hours, possibly a day-plus — precisely because P12.5's throttled backfill deliberately
respects `LLM_DAILY_CAP` rather than bursting through the whole backlog at once).

Imported items carry `created_at` set to the **original WhatsApp share timestamp**, not the
moment the import ran (P12.2) — this is deliberate: it's what makes "sort by newest" in the
library still meaningful after importing a two-year-old backlog. Don't "fix" a bulk import that
appears to backdate everything; that's the feature working correctly.

#### Errors

| Status | `code` | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No valid session |
| 404 | `NOT_FOUND` | No such import, or it belongs to another user |

---

### 3.11 `GET /api/v1/health`

**Auth:** none. This is the one intentionally public endpoint (P1.3.3), for Docker's
`HEALTHCHECK` and any external uptime monitor.

#### Response

```json
{
  "status": "ok",
  "db": { "status": "ok", "wal_size_bytes": 2107392 },
  "queue": { "status": "ok", "pending": 3, "oldest_pending_age_ms": 4200, "worker_enabled": true },
  "disk": { "status": "ok", "free_bytes": 42949672960, "total_bytes": 155000000000 },
  "llm_quota": {
    "used_today": 214,
    "cap": 900,
    "interactive_reserve": 100,
    "remaining_background": 586,
    "remaining_interactive": 686,
    "resets_at": 1789257600000
  }
}
```

**The overall `status` and HTTP status code are driven only by `db.status`.** `200` when the
database is reachable, `503` when it isn't (the one condition where a container restart is a
plausible fix). `disk`, `queue`, and `llm_quota` are informational and never flip the HTTP status
— a full disk doesn't get fixed by Docker restarting the container (that would just churn
uselessly), and a spent LLM budget is an expected, graceful daily condition, not a health problem
(see CLAUDE.md: "the system stays useful at zero budget"). A monitoring dashboard that wants to
warn on low disk or a growing queue backlog should read those sub-fields itself rather than
relying on the top-level code turning non-2xx.

`llm_quota.remaining_background` and `remaining_interactive` differ because of the interactive
reserve (`LLM_INTERACTIVE_RESERVE`, see `.env.example`): background pipeline stages stop consuming
budget once `used_today` reaches `cap - interactive_reserve`, while interactive requests (chat,
manual re-enrich) can keep going until `used_today` reaches `cap`.

---

## 4. Design notes — ambiguities resolved while writing this contract

The plan and `CLAUDE.md` specify behavior at the product level; a few HTTP-shape decisions had to
be made to turn that into a contract two independent agents can build against without talking to
each other. Recorded here so neither P4 nor P8 (nor anyone reading this later) has to guess why:

| Decision | Resolution | Why |
|---|---|---|
| Capture response status code for a duplicate `url_hash` | `202 Accepted` in both the new-item and duplicate case (never `200`/`409`) | The client (extension badge) shouldn't have to branch on HTTP status to know what happened — it reads the `duplicate` boolean in the body instead. `202` is accurate either way: something was accepted, whether that's a new row or a re-extraction re-enqueued onto an existing one |
| Does a duplicate capture re-run the pipeline? | Only if it arrives with new `html`/`transcript`/`caption` the stored item didn't already have; a bare re-POST of the same URL just touches `updated_at` | Re-sharing from the extension specifically to upgrade a `metadata_only` item past its ceiling is a real, common flow (§3.1's whole reason for existing) and shouldn't require a separate manual retry click; a bare accidental duplicate share shouldn't burn a second enrichment call |
| P4.1.4's "topic hint" in the capture popup | Folded into `note` as free text for v1 — there's no dedicated `topic_hint` field on `CaptureRequest` | The frozen request shape (given directly for this contract) is `{url, title?, note?, html?, transcript?, caption?, surface}` — no topic field. Enrichment already reads `note` as context, so a hint travels the same path. Adding a dedicated field later is additive and backward-compatible if this turns out to matter |
| `PATCH /items/:id` `tags` semantics | Full replacement of the item's tag set, not an add/remove diff | A PATCH that's a diff needs its own verbs (add/remove) or a JSON-patch document; a flat array the client fully controls is simpler for the UI, and idempotent — sending the same body twice is a no-op either way |
| `item_topics` is a join table (plan §6), but PATCH takes a single `topic` slug | The API exposes one **primary** topic per item, not a set | Matches the product surface everywhere else it appears — `TopicChip` (P5.5), board/library grouping by topic (P10.1.4), and the plan's own singular phrasing, "topic override." The join table's confidence-scored, possibly-multiple rows are an enrichment/AI implementation detail, not something the HTTP contract needs to expose today |
| `outcome_note` doesn't appear in the task's literal `PATCH /items/:id` field list (`note, starred, tags, topic`) | Added to that same endpoint anyway, not to `PATCH .../status` | It's a plain user-editable text field structurally identical to `note` (P11.7); bolting it onto the status-transition endpoint would mix "validate a state machine transition" concerns with "edit free text," which is exactly the kind of merge CLAUDE.md's SRP principle argues against |
| Status transition graph | Fully spelled out in §3.6 (four board columns freely interchangeable; `archived`/`dropped` reachable from any of them and restore only to `inbox`; `queued`/`processing`/`failed` are pipeline-owned and unreachable through this endpoint) | The plan requires "transition validation" and "invalid → 400" but doesn't specify the graph. Left unspecified, P8 (route handler) and P10/P11 (board UI, which should pre-validate a drag before firing the optimistic update) would each have guessed independently and likely disagreed |
| `POST /api/v1/import` handling four capabilities (upload, dry-run, progress, pause/resume) through only two routes | Overloaded by content type: `multipart/form-data` for a new upload (`mode: dry_run \| commit`), `application/json` for state transitions on an existing import (`action: commit \| pause \| resume \| cancel`) | The endpoint list for this contract is fixed at `POST /api/v1/import` + `GET /api/v1/import/:id`. Splitting further (e.g. a `.../commit` sub-route) would be cleaner REST but is outside the two routes this document is scoped to specify |
| SSE error handling on `POST /api/v1/chat` | Pre-stream validation/auth errors are normal JSON + 4xx; anything failing after the stream opens is an `event: error` SSE frame, never a status code | Once `Content-Type: text/event-stream` and a `200` are sent, HTTP headers are committed — there is no mechanism to change the status code mid-response. This is easy to miss until it's a live bug |
| Retrieval-too-weak path (P13.5) skips the LLM call entirely | `event: done` carries `grounded: false` and `sources` is empty; the fixed "nothing saved about that" message is streamed as a normal `token` event | Consistent with the project's central budget constraint — answering "I don't know" doesn't need a free-tier request to say so |
| `GET /api/v1/health` HTTP status | Driven only by `db.status`; disk/queue/quota are informational-only fields that never produce a non-2xx | A container restart (what a failing Docker healthcheck triggers) doesn't fix low disk or a spent LLM budget, and treating a spent budget as unhealthy would directly contradict "the system stays useful at zero budget" |
| `LLM_CHAIN_ENRICH` / `LLM_CHAIN_CHAT` chain depth | **Resolved — `.env.example` now carries the full 6-deep chains from plan §5.1** | The shorter 5- and 4-model strings originally supplied for this file were an abridgement, not an intentional override. Plan §5.1 is authoritative: Chain A adds `nex-agi/nex-n2.5-mini:free`, Chain B adds `thinkingmachines/inkling-small:free` and `nvidia/nemotron-3-super-120b-a12b:free`. Correctly flagged rather than silently reproduced |

---

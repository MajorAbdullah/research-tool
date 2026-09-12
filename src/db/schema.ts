/**
 * Drizzle ORM schema (SQLite dialect) — the typed contract other phases build against.
 *
 * `items_fts` (FTS5) and `chunk_vec` (sqlite-vec) are deliberately NOT declared here: Drizzle's
 * schema DSL has no concept of a virtual table module, and faking one with `sqliteTable` would
 * make drizzle-kit try to manage it as a normal table, colliding with the real
 * `CREATE VIRTUAL TABLE` statement. Both are created directly in `drizzle/0000_init.sql`, along
 * with the triggers that keep `items_fts` in sync — see that file's header for why.
 *
 * Enums are defined once, in `src/types/contracts.ts`; this file imports them and never
 * redeclares a value set. Every enum-backed column also gets a SQL CHECK constraint (below) with
 * the same value set, so an invalid value is rejected at the DB layer even if some future caller
 * bypasses the TS layer entirely (a raw SQL script, a bug in a repository helper, etc).
 */

import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { ItemStatus, JobState } from '@/types/contracts'
import type {
  ItemKind,
  ExtractionTier,
  SourceSurface,
  RelationType,
  JobName,
  JobPayload,
} from '@/types/contracts'

/**
 * All timestamps are stored as plain UTC epoch-millis integers — NOT Drizzle's `timestamp_ms`
 * mode, which would hydrate them as `Date` objects. Plain numbers are what `contracts.ts` uses
 * everywhere (job payloads get JSON-serialized into `jobs.payload`, and `Date` does not survive a
 * JSON round-trip as a `Date`), so a DB row and an in-memory contract value are the same
 * representation with no conversion at the boundary. Requires SQLite >= 3.42 (unixepoch subsec);
 * better-sqlite3's bundled build is well past that.
 */
const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
)

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    urlHash: text('url_hash').notNull(),
    kind: text('kind').notNull().$type<ItemKind>(),
    status: text('status').notNull().default(ItemStatus.Queued).$type<ItemStatus>(),
    title: text('title'),
    author: text('author'),
    publishedAt: integer('published_at'),
    thumbnailUrl: text('thumbnail_url'),
    extractionTier: text('extraction_tier').$type<ExtractionTier>(),
    sourceSurface: text('source_surface').notNull().$type<SourceSurface>(),
    failureReason: text('failure_reason'),
    rawPayload: text('raw_payload', { mode: 'json' }).$type<unknown>(),
    contentText: text('content_text'),
    summaryTldr: text('summary_tldr'),
    summaryBullets: text('summary_bullets', { mode: 'json' }).$type<string[]>(),
    // Repo kind: {what_it_does, language, stars, license, last_commit, primary_use_case}. Shape
    // varies by kind and is the merged output of an extractor (P2) and the LLM (P3), so it stays
    // a loose bag rather than a typed column.
    kindFields: text('kind_fields', { mode: 'json' }).$type<Record<string, unknown>>(),
    note: text('note'),
    outcomeNote: text('outcome_note'),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    boardRank: real('board_rank'),
    lastOpenedAt: integer('last_opened_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('items_user_url_hash_unique').on(table.userId, table.urlHash),
    index('items_user_status_idx').on(table.userId, table.status), // research-status board columns
    index('items_user_kind_idx').on(table.userId, table.kind), // library "group by kind"
    check(
      'items_kind_check',
      sql`${table.kind} in ('github','video','article','social','pdf','audio','other')`,
    ),
    check(
      'items_status_check',
      sql`${table.status} in ('queued','processing','inbox','to_test','testing','tested','archived','dropped','failed')`,
    ),
    check(
      'items_extraction_tier_check',
      sql`${table.extractionTier} in ('full','partial','metadata_only')`,
    ),
    check(
      'items_source_surface_check',
      sql`${table.sourceSurface} in ('extension','pwa','web','import')`,
    ),
  ],
)

export const topics = sqliteTable(
  'topics',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    color: text('color'),
  },
  (table) => [uniqueIndex('topics_user_slug_unique').on(table.userId, table.slug)],
)

export const itemTopics = sqliteTable(
  'item_topics',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    topicId: integer('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    confidence: real('confidence').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.topicId] }),
    index('item_topics_topic_idx').on(table.topicId), // "everything in this topic" reverse lookup
    check('item_topics_confidence_check', sql`${table.confidence} between 0 and 1`),
  ],
)

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (table) => [uniqueIndex('tags_user_label_unique').on(table.userId, table.label)],
)

export const itemTags = sqliteTable(
  'item_tags',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.tagId] }),
    index('item_tags_tag_idx').on(table.tagId),
  ],
)

export const chunks = sqliteTable(
  'chunks',
  {
    // AUTOINCREMENT (unlike every other table's PK here) so a deleted chunk's id is never reused.
    // chunk_vec's rowid == chunks.id; if an id were reused before its old chunk_vec row was
    // cleaned up, a new chunk could silently inherit a stale vector for different text. The
    // AFTER DELETE trigger in the migration already deletes the matching chunk_vec row, but this
    // is a cheap second guard against exactly the failure the plan's risk register calls out as
    // high-impact ("silent vector corruption from an embedding-model swap").
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    text: text('text').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    // Denormalized (not just derivable via itemId join) on purpose: retrieval-layer access
    // control filters chunks by userId BEFORE the kNN, never after, and citations need
    // title/url/publishedAt without a join back to items at query time.
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    url: text('url'), // the item's canonical_url at chunk-creation time, for citation links
    publishedAt: integer('published_at'),
  },
  (table) => [
    index('chunks_item_ord_idx').on(table.itemId, table.ord), // fetch a item's chunks in order
    index('chunks_user_idx').on(table.userId), // pre-kNN access-control filter
  ],
)

export const relations = sqliteTable(
  'relations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemA: integer('item_a')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    itemB: integer('item_b')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    type: text('type').notNull().$type<RelationType>(),
    score: real('score').notNull(),
    rationale: text('rationale'),
  },
  (table) => [
    // itemA < itemB normalizes pair order so (A,B) and (B,A) are the same row — this, plus the
    // unique index below, is the "no duplicate inverse pairs" constraint P9.2.3 asks for. It also
    // rules out a self-relation for free (itemA < itemB implies itemA !== itemB).
    check('relations_order_check', sql`${table.itemA} < ${table.itemB}`),
    uniqueIndex('relations_pair_type_unique').on(table.itemA, table.itemB, table.type),
    // itemA is covered by the unique index above; itemB needs its own for the reverse lookup.
    index('relations_item_b_idx').on(table.itemB),
    check('relations_type_check', sql`${table.type} in ('alternative','similar','supersedes')`),
    check('relations_score_check', sql`${table.score} between 0 and 1`),
  ],
)

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().$type<JobName>(),
    // Typed via the same discriminated union P7's worker switches on exhaustively — the DB column
    // and the in-process job dispatch share one type, not two independently-maintained shapes.
    payload: text('payload', { mode: 'json' }).notNull().$type<JobPayload>(),
    state: text('state').notNull().default(JobState.Queued).$type<JobState>(),
    attempts: integer('attempts').notNull().default(0),
    runAt: integer('run_at').notNull().default(nowMs),
    lastError: text('last_error'),
  },
  (table) => [
    // Supports the worker loop's hot claim query:
    // WHERE state='queued' AND name=? AND run_at<=? ORDER BY run_at.
    index('jobs_claim_idx').on(table.state, table.name, table.runAt),
    check(
      'jobs_name_check',
      sql`${table.name} in ('resolve','extract','enrich','embed','relate','index')`,
    ),
    check('jobs_state_check', sql`${table.state} in ('queued','active','completed','failed')`),
  ],
)

export const llmCalls = sqliteTable('llm_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  modelRequested: text('model_requested').notNull(),
  modelResolved: text('model_resolved').notNull(),
  promptVersion: text('prompt_version').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  createdAt: integer('created_at').notNull().default(nowMs),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// ---------------------------------------------------------------------------
// P13 — Ask-My-Library Chat. Three additive tables, owned by src/lib/rag/**:
//   conversations   — one row per chat thread (docs/API.md §3.8's `conversation_id`)
//   chat_messages   — every turn, both roles; assistant rows also carry the sources/grounded
//                      flag/retrieved-chunk log needed to render history and to diagnose a bad
//                      answer as retrieval-vs-generation without guessing (CLAUDE.md → RAG,
//                      "log retrieved chunks with every answer")
//   chat_cache      — exact-match response cache keyed on question+scope (P13.9): a repeated
//                      question costs zero free-tier requests
//
// JSON columns here are intentionally loose (`unknown`), not typed against src/lib/rag/*'s own
// shapes — same reasoning as `items.kindFields` above: this is the lowest layer every phase
// depends on, so it must never depend back on one phase's own types. src/lib/rag/** validates
// what it reads/writes.
// ---------------------------------------------------------------------------

export const conversations = sqliteTable(
  'conversations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // First user message, truncated — a human-readable label for a future history list. Set once
    // at creation, never edited.
    title: text('title'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (table) => [index('conversations_user_updated_idx').on(table.userId, table.updatedAt)],
)

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // Denormalized (not just derivable via conversationId join), same rationale as
    // `chunks.userId` above: every query touching this table is scoped by user_id directly.
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<'user' | 'assistant'>(),
    content: text('content').notNull(),
    // The numbered reference list this message cited (docs/API.md §3.8's `sources` event) — null
    // on a `user` row.
    sources: text('sources', { mode: 'json' }).$type<unknown[] | null>(),
    // null on a `user` row; `false` marks the "I have nothing saved about that" path (P13.5).
    grounded: integer('grounded', { mode: 'boolean' }),
    // Every candidate chunk retrieval considered for this turn, win or lose — null on a `user`
    // row. This is the "diagnosable as retrieval-vs-generation without guessing" log (P13.8).
    retrievedChunks: text('retrieved_chunks', { mode: 'json' }).$type<unknown[] | null>(),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (table) => [
    index('chat_messages_conversation_idx').on(table.conversationId, table.id),
    check('chat_messages_role_check', sql`${table.role} in ('user','assistant')`),
  ],
)

export const chatCache = sqliteTable(
  'chat_cache',
  {
    // sha256(userId + normalized question + filter scope) — see src/lib/rag/cache.ts. Exact-match
    // only, deliberately: no fuzzy/semantic cache key, so a hit is always provably the same
    // question under the same scope (P13.9).
    cacheKey: text('cache_key').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answer: text('answer').notNull(),
    sources: text('sources', { mode: 'json' }).notNull().$type<unknown[]>(),
    grounded: integer('grounded', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (table) => [index('chat_cache_user_idx').on(table.userId)],
)

-- Sieve — initial schema migration (P0).
--
-- The relational tables below (users..settings) are the output of `drizzle-kit generate` against
-- `src/db/schema.ts`, reordered parent-before-child and with `IF NOT EXISTS` added throughout for
-- idempotent-safe re-runs. Everything after `settings` is hand-written: FTS5 and sqlite-vec are
-- virtual table modules with no equivalent in Drizzle's schema DSL, so drizzle-kit cannot generate
-- them — they, and the triggers that keep the FTS5 index in sync, are maintained here by hand.
--
-- Two non-obvious things worth reading before touching the FTS5 section:
--
-- 1. `items_fts` is declared with `content='items_fts_source'`, a VIEW, not `content='items'`
--    directly. SQLite's fts5 module resolves every declared column of an external-content table
--    BY NAME against the content table on every row lookup (not just the ones a query selects) —
--    verified empirically against the exact better-sqlite3/sqlite-vec versions this project
--    pins. `items` has no `tldr`/`tags`/`content` columns (they're `summary_tldr`/a
--    tags/item_tags join/`content_text`), so pointing `content=` straight at `items` fails with
--    "no such column" on ordinary reads. The view aliases items' columns to the fts5 names and
--    adds `tags` as a computed `group_concat` over item_tags/tags, satisfying fts5's by-name
--    lookup without adding a redundant `tags` column to `items` itself.
--
-- 2. `items_fts_ad` fires BEFORE DELETE, not AFTER (unlike the ai/au triggers). Also verified
--    empirically: an `ON DELETE CASCADE` from `items` to `item_tags` is processed BETWEEN a row's
--    own BEFORE and AFTER delete triggers, so by the time an AFTER DELETE trigger on `items` would
--    run, this item's item_tags rows are already gone — a tags subquery in that trigger would see
--    an empty set instead of the tags that were actually indexed, and the fts5 'delete' command
--    would tokenize the wrong text, leaving a stale entry that still matches searches for an item
--    that no longer exists. Firing BEFORE DELETE reads item_tags while it's still intact. Do not
--    "simplify" this back to AFTER DELETE to match its siblings — it was AFTER DELETE originally
--    and that is exactly what produced the stale-match bug.

-- ============================================================================
-- users
-- ============================================================================
CREATE TABLE IF NOT EXISTS `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
--> statement-breakpoint

-- ============================================================================
-- items
-- ============================================================================
CREATE TABLE IF NOT EXISTS `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`url_hash` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`title` text,
	`author` text,
	`published_at` integer,
	`thumbnail_url` text,
	`extraction_tier` text,
	`source_surface` text NOT NULL,
	`failure_reason` text,
	`raw_payload` text,
	`content_text` text,
	`summary_tldr` text,
	`summary_bullets` text,
	`kind_fields` text,
	`note` text,
	`outcome_note` text,
	`starred` integer DEFAULT false NOT NULL,
	`board_rank` real,
	`last_opened_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_kind_check" CHECK("items"."kind" in ('github','video','article','social','pdf','audio','other')),
	CONSTRAINT "items_status_check" CHECK("items"."status" in ('queued','processing','inbox','to_test','testing','tested','archived','dropped','failed')),
	CONSTRAINT "items_extraction_tier_check" CHECK("items"."extraction_tier" in ('full','partial','metadata_only')),
	CONSTRAINT "items_source_surface_check" CHECK("items"."source_surface" in ('extension','pwa','web','import'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `items_user_url_hash_unique` ON `items` (`user_id`,`url_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `items_user_status_idx` ON `items` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `items_user_kind_idx` ON `items` (`user_id`,`kind`);
--> statement-breakpoint

-- ============================================================================
-- topics / item_topics
-- ============================================================================
CREATE TABLE IF NOT EXISTS `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`color` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `topics_user_slug_unique` ON `topics` (`user_id`,`slug`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `item_topics` (
	`item_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`confidence` real NOT NULL,
	PRIMARY KEY(`item_id`, `topic_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_topics_confidence_check" CHECK("item_topics"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_topics_topic_idx` ON `item_topics` (`topic_id`);
--> statement-breakpoint

-- ============================================================================
-- tags / item_tags
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tags_user_label_unique` ON `tags` (`user_id`,`label`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `item_tags` (
	`item_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_tags_tag_idx` ON `item_tags` (`tag_id`);
--> statement-breakpoint

-- ============================================================================
-- chunks
-- ============================================================================
CREATE TABLE IF NOT EXISTS `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`ord` integer NOT NULL,
	`text` text NOT NULL,
	`embedding_model` text NOT NULL,
	`user_id` integer NOT NULL,
	`title` text,
	`url` text,
	`published_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chunks_item_ord_idx` ON `chunks` (`item_id`,`ord`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chunks_user_idx` ON `chunks` (`user_id`);
--> statement-breakpoint

-- ============================================================================
-- relations
-- ============================================================================
CREATE TABLE IF NOT EXISTS `relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_a` integer NOT NULL,
	`item_b` integer NOT NULL,
	`type` text NOT NULL,
	`score` real NOT NULL,
	`rationale` text,
	FOREIGN KEY (`item_a`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_b`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "relations_order_check" CHECK("relations"."item_a" < "relations"."item_b"),
	CONSTRAINT "relations_type_check" CHECK("relations"."type" in ('alternative','similar','supersedes')),
	CONSTRAINT "relations_score_check" CHECK("relations"."score" between 0 and 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `relations_pair_type_unique` ON `relations` (`item_a`,`item_b`,`type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `relations_item_b_idx` ON `relations` (`item_b`);
--> statement-breakpoint

-- ============================================================================
-- jobs
-- ============================================================================
CREATE TABLE IF NOT EXISTS `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_error` text,
	CONSTRAINT "jobs_name_check" CHECK("jobs"."name" in ('resolve','extract','enrich','embed','relate','index')),
	CONSTRAINT "jobs_state_check" CHECK("jobs"."state" in ('queued','active','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_claim_idx` ON `jobs` (`state`,`name`,`run_at`);
--> statement-breakpoint

-- ============================================================================
-- llm_calls
-- ============================================================================
CREATE TABLE IF NOT EXISTS `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_requested` text NOT NULL,
	`model_resolved` text NOT NULL,
	`prompt_version` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- items_fts: FTS5 external-content index over items (+ tags via item_tags/tags)
-- ============================================================================
CREATE VIEW IF NOT EXISTS `items_fts_source` AS
	SELECT
		i.id AS id,
		i.title AS title,
		i.summary_tldr AS tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tags,
		i.content_text AS content
	FROM items i;
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `items_fts` USING fts5(
	title,
	tldr,
	tags,
	content,
	content='items_fts_source',
	content_rowid='id'
);
--> statement-breakpoint
-- Keeps items_fts in sync with items' own columns. See file header note (2) for why this is
-- BEFORE DELETE, not AFTER.
CREATE TRIGGER IF NOT EXISTS `items_fts_ai` AFTER INSERT ON `items` BEGIN
	INSERT INTO items_fts(rowid, title, tldr, tags, content)
	VALUES (
		new.id,
		new.title,
		new.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = new.id),
		new.content_text
	);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `items_fts_ad` BEFORE DELETE ON `items` BEGIN
	INSERT INTO items_fts(items_fts, rowid, title, tldr, tags, content)
	VALUES (
		'delete',
		old.id,
		old.title,
		old.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = old.id),
		old.content_text
	);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `items_fts_au` AFTER UPDATE ON `items` BEGIN
	INSERT INTO items_fts(items_fts, rowid, title, tldr, tags, content)
	VALUES (
		'delete',
		old.id,
		old.title,
		old.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = old.id),
		old.content_text
	);
	INSERT INTO items_fts(rowid, title, tldr, tags, content)
	VALUES (
		new.id,
		new.title,
		new.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = new.id),
		new.content_text
	);
END;
--> statement-breakpoint
-- items_fts's `tags` column is derived from a join, not a column on `items` itself, so a tag
-- being attached to or removed from an item (item_tags changing) has to resync the FTS row too,
-- independently of whatever triggered the items_ai/ad/au triggers above. Guarded with `WHEN
-- EXISTS (... items ...)` so a cascade-delete's own item_tags removal (already handled by
-- items_fts_ad, above) is a no-op here instead of re-inserting a row for an item that's gone.
CREATE TRIGGER IF NOT EXISTS `item_tags_fts_ai` AFTER INSERT ON `item_tags`
WHEN EXISTS (SELECT 1 FROM items WHERE id = new.item_id)
BEGIN
	INSERT INTO items_fts(items_fts, rowid, title, tldr, tags, content)
	SELECT
		'delete', i.id, i.title, i.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND it.tag_id <> new.tag_id),
		i.content_text
	FROM items i WHERE i.id = new.item_id;
	INSERT INTO items_fts(rowid, title, tldr, tags, content)
	SELECT
		i.id, i.title, i.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id),
		i.content_text
	FROM items i WHERE i.id = new.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `item_tags_fts_ad` AFTER DELETE ON `item_tags`
WHEN EXISTS (SELECT 1 FROM items WHERE id = old.item_id)
BEGIN
	INSERT INTO items_fts(items_fts, rowid, title, tldr, tags, content)
	SELECT
		'delete', i.id, i.title, i.summary_tldr,
		-- COALESCE is load-bearing: SQLite's || collapses the whole expression to NULL when
		-- group_concat returns NULL (i.e. this was the item's LAST tag). Without it the 'delete'
		-- command is handed a NULL tags value, fails to match the row actually in the index, and
		-- leaves a STALE entry — a search for the just-removed tag keeps returning the item.
		-- Reproduced and pinned by tests/integration/schema.test.ts.
		trim(COALESCE((SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id), '') || ' ' || COALESCE((SELECT label FROM tags WHERE id = old.tag_id), '')),
		i.content_text
	FROM items i WHERE i.id = old.item_id;
	INSERT INTO items_fts(rowid, title, tldr, tags, content)
	SELECT
		i.id, i.title, i.summary_tldr,
		(SELECT group_concat(t.label, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id),
		i.content_text
	FROM items i WHERE i.id = old.item_id;
END;
--> statement-breakpoint

-- ============================================================================
-- chunk_vec: sqlite-vec index over chunks. rowid == chunks.id (see schema.ts for why chunks.id
-- is AUTOINCREMENT). 384 dims is bge-small-en-v1.5's fixed, known output size for the local
-- embedding path (P3.3.1) — not a guess and not configurable per-request, so it's a plain literal
-- rather than something read from settings.
-- ============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS `chunk_vec` USING vec0(
	embedding float[384]
);
--> statement-breakpoint
-- Embeddings are computed externally (an ONNX model call) and can't be produced by a trigger, so
-- unlike items_fts there's no insert/update-sync trigger here — P7's `embed` job writes chunk_vec
-- rows directly. This trigger only prevents orphaned vectors: without it, deleting a chunk (or
-- cascading from an item delete) would leave its embedding behind, forever matching kNN queries
-- against text that no longer exists.
CREATE TRIGGER IF NOT EXISTS `chunks_vec_ad` AFTER DELETE ON `chunks` BEGIN
	DELETE FROM chunk_vec WHERE rowid = old.id;
END;
--> statement-breakpoint

-- ============================================================================
-- P13 — Ask-My-Library Chat (conversations, chat_messages, chat_cache). Additive, hand-appended
-- to this same file per migrate.ts's header: there is no drizzle/meta journal here, so a fresh
-- numbered migration file would never actually run — every statement below follows the same
-- `IF NOT EXISTS` idempotency rule as the rest of this file. See src/db/schema.ts for the typed
-- Drizzle definitions these mirror.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversations_user_updated_idx` ON `conversations` (`user_id`,`updated_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sources` text,
	`grounded` integer,
	`retrieved_chunks` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_messages_role_check" CHECK("chat_messages"."role" in ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_messages_conversation_idx` ON `chat_messages` (`conversation_id`,`id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `chat_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`answer` text NOT NULL,
	`sources` text NOT NULL,
	`grounded` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_cache_user_idx` ON `chat_cache` (`user_id`);

/**
 * `pnpm reembed` (P3.3.4) — re-embeds every stored chunk and rebuilds `chunk_vec` from scratch.
 * This is the ONLY sanctioned way to change the embedding model on a database that already has
 * embedded chunks (CLAUDE.md: "never a silent fallback"; ADR 0003). Idempotent: re-running it
 * (e.g. after a crash mid-run) just re-embeds and re-writes every row again.
 *
 * `reembedAll()` is the testable core — it takes an already-open DB handle and an
 * `EmbeddingProvider`, both dependency-injected, so unit tests exercise the real batching/
 * BigInt-rowid/transaction logic against a real in-memory SQLite database without touching the
 * network or a 350 MB model. `main()` below is the thin CLI wrapper `tsx` actually runs; it opens
 * the real `better-sqlite3` connection, loads the `sqlite-vec` extension, and only runs when this
 * file is executed directly (not when a test imports `reembedAll` in isolation).
 */

import type { EmbeddingProvider } from '@/types/contracts'
import { createEmbeddingProvider, selectEmbeddingProviderFromEnv } from './factory'
import { recordEmbeddingModel } from './settings-guard'
import { createSqliteSettingsPort, type SqliteLike } from '@/lib/ai/settings-store'

export interface ChunkRow {
  id: number
  text: string
}

/** The minimal slice of `better-sqlite3.Database` this script needs — structural, like
 *  `settings-store.ts`'s `SqliteLike`, but with the two extra methods (`.all()`, `.exec()`) batch
 *  re-embedding needs that a simple key-value settings read/write doesn't. A real
 *  `better-sqlite3.Database` instance satisfies this with no adapter code. */
export interface ReembedDb extends SqliteLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  exec(sql: string): unknown
}

export interface ReembedDeps {
  db: ReembedDb
  provider: EmbeddingProvider
  batchSize?: number
  onProgress?: (processed: number, total: number) => void
}

export interface ReembedResult {
  chunksProcessed: number
}

const DEFAULT_BATCH_SIZE = 64

export async function reembedAll(deps: ReembedDeps): Promise<ReembedResult> {
  const { db, provider } = deps
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE

  const totalRow = db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number } | undefined
  const total = totalRow?.n ?? 0

  const selectBatch = db.prepare('SELECT id, text FROM chunks ORDER BY id LIMIT ? OFFSET ?')
  const deleteVec = db.prepare('DELETE FROM chunk_vec WHERE rowid = ?')
  const insertVec = db.prepare('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)')
  const updateModel = db.prepare('UPDATE chunks SET embedding_model = ? WHERE id = ?')

  db.exec('BEGIN')
  let processed = 0
  try {
    for (let offset = 0; offset < total; offset += batchSize) {
      const rows = selectBatch.all(batchSize, offset) as ChunkRow[]
      if (rows.length === 0) break

      // One embed() call per batch, not per chunk — batching embeddings is a non-negotiable
      // (CLAUDE.md) even here, where it's about ONNX call-count/throughput rather than quota.
      const vectors = await provider.embed(rows.map((r) => r.text))

      rows.forEach((row, i) => {
        const vector = vectors[i]
        if (!vector) return
        deleteVec.run(row.id)
        // sqlite-vec rejects a plain JS number as a chunk_vec rowid — "Only integers are allows
        // for primary key values" — verified against better-sqlite3 13.0.3 / sqlite-vec 0.1.9.
        // Must bind as BigInt, not number.
        //
        // `Array.from(vector)` before stringifying: a live smoke test of this exact CLI caught
        // fastembed returning `Float32Array` vectors at runtime (despite its own types claiming
        // `number[]`) — `JSON.stringify()` on a typed array produces `{"0":...}`, not `[...]`,
        // which sqlite-vec's insert rejects. `local-provider.ts` now normalizes this at the
        // source, but this line writes directly to the database on a re-embed, so it defends
        // itself too rather than trusting every current and future `EmbeddingProvider` to comply.
        insertVec.run(BigInt(row.id), JSON.stringify(Array.from(vector)))
        updateModel.run(provider.model, row.id)
      })

      processed += rows.length
      deps.onProgress?.(processed, total)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { chunksProcessed: processed }
}

/** What `main()` additionally needs beyond `ReembedDb`, to set up the raw connection before
 *  handing it to `reembedAll()`. Kept separate from `ReembedDb` so a test double for
 *  `reembedAll()` only has to implement `prepare`/`exec`, never connection setup it doesn't do. */
interface RawSqliteConnection extends ReembedDb {
  pragma(source: string): unknown
  loadExtension(path: string): unknown
  close(): unknown
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === `file://${entry}`
}

async function main(): Promise<void> {
  const providerKind = selectEmbeddingProviderFromEnv()
  if (providerKind === 'openrouter') {
    throw new Error(
      "EMBEDDING_PROVIDER=openrouter is not auto-wired by 'pnpm reembed' — there is no safe " +
        'default dimension to assume for a hosted embedding model. Write a small wrapper script ' +
        'that calls createEmbeddingProvider({ provider: "openrouter", openRouter: {...} }) and ' +
        'reembedAll() directly with explicit options. See src/lib/embeddings/openrouter-provider.ts.',
    )
  }
  const provider = createEmbeddingProvider({ provider: providerKind })

  const sqlitePath = process.env.SQLITE_PATH ?? './data/sieve.db'
  // Dynamic imports: this CLI is the only place in src/lib/embeddings/** that opens its own raw
  // DB connection (P3 doesn't own src/db/client.ts — see settings-store.ts's header comment), and
  // keeping the real better-sqlite3/sqlite-vec modules out of reembed.ts's top-level imports means
  // a test can import `reembedAll` without ever loading those native modules at all.
  const { default: BetterSqlite3 } = await import('better-sqlite3')
  const sqliteVec = await import('sqlite-vec')

  const db = new BetterSqlite3(sqlitePath) as unknown as RawSqliteConnection
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  sqliteVec.load(db)

  console.log(
    `[reembed] ${sqlitePath}: re-embedding all chunks with '${provider.model}' (${provider.dimensions}d)`,
  )
  const result = await reembedAll({
    db,
    provider,
    onProgress: (processed, total) => console.log(`[reembed] ${processed}/${total}`),
  })
  recordEmbeddingModel(provider.model, createSqliteSettingsPort(db))
  console.log(
    `[reembed] done — ${result.chunksProcessed} chunk(s) re-embedded; settings.embedding_model = '${provider.model}'`,
  )
  db.close()
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error('[reembed] failed:', err)
    process.exitCode = 1
  })
}

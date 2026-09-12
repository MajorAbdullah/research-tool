import type { TestDb } from './db'
import { fakeEmbedding } from './db'

const now = () => Date.now()

export function makeUser(db: TestDb, id = 1, email = `u${id}@example.test`): number {
  db.prepare('insert into users (id, email, password_hash, created_at) values (?,?,?,?)').run(
    id,
    email,
    'argon2-placeholder-not-a-real-hash',
    now(),
  )
  return id
}

export interface ItemOverrides {
  id?: number
  userId?: number
  url?: string
  kind?: string
  status?: string
  extractionTier?: string
  sourceSurface?: string
  title?: string | null
  tldr?: string | null
  content?: string | null
}

export function makeItem(db: TestDb, o: ItemOverrides = {}): number {
  const id = o.id ?? Math.floor(Math.random() * 1e9)
  const url = o.url ?? `https://example.test/${id}`
  db.prepare(
    `insert into items
       (id, user_id, url, canonical_url, url_hash, kind, status, extraction_tier,
        source_surface, title, summary_tldr, content_text, created_at, updated_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    o.userId ?? 1,
    url,
    url,
    `hash-${id}`,
    o.kind ?? 'github',
    o.status ?? 'inbox',
    o.extractionTier ?? 'full',
    o.sourceSurface ?? 'extension',
    o.title ?? `Item ${id}`,
    o.tldr ?? null,
    o.content ?? null,
    now(),
    now(),
  )
  return id
}

export function tagItem(db: TestDb, itemId: number, label: string, userId = 1): void {
  let row = db.prepare('select id from tags where user_id = ? and label = ?').get(userId, label) as
    { id: number } | undefined
  if (!row) {
    const info = db.prepare('insert into tags (user_id, label) values (?,?)').run(userId, label)
    row = { id: Number(info.lastInsertRowid) }
  }
  db.prepare('insert into item_tags (item_id, tag_id) values (?,?)').run(itemId, row.id)
}

/**
 * Insert a chunk and its vector.
 *
 * NOTE the BigInt: sqlite-vec rejects a plain JS number as a vec0 rowid with
 * "Only integers are allows for primary key values". See CLAUDE.md.
 */
export function makeChunk(
  db: TestDb,
  itemId: number,
  text: string,
  opts: { userId?: number; ord?: number; seed?: number; model?: string } = {},
): number {
  const info = db
    .prepare(
      `insert into chunks (item_id, user_id, ord, text, embedding_model)
       values (?,?,?,?,?)`,
    )
    .run(itemId, opts.userId ?? 1, opts.ord ?? 0, text, opts.model ?? 'bge-small-en-v1.5')
  const id = Number(info.lastInsertRowid)
  db.prepare('insert into chunk_vec (rowid, embedding) values (?,?)').run(
    BigInt(id),
    fakeEmbedding(opts.seed ?? 1),
  )
  return id
}

/**
 * Shared type alias for "either the app-wide Drizzle client, or a transaction callback's `tx`
 * handle" — several service helpers (topics.ts, tags.ts, items-service.ts) need to run either
 * standalone or as part of a caller's transaction, and Drizzle's `.transaction()` callback
 * parameter is a structurally different (narrower) type than `getDb()`'s return type, even though
 * both support the same `.select()/.insert()/.update()/.delete()` builder used here.
 *
 * Derived from `getDb`'s own transaction method signature (rather than importing Drizzle's
 * internal `SQLiteTransaction<...>` generic directly) so this stays correct across a drizzle-orm
 * version bump without needing to track its exact internal type name.
 */

import type { getDb } from '@/db/client'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type DbOrTx = Db | Tx

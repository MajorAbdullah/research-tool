/**
 * Job dispatch: maps a claimed job's `payload.name` to a handler.
 *
 * P1 ships every handler as a no-op placeholder — P7 (ingest pipeline orchestration) replaces
 * each entry in `registry` with real logic without touching this file's dispatch mechanism.
 * `dispatch`'s `switch` is exhaustive over the `JobName` union: if `JobPayload` ever grows a
 * seventh variant and nobody adds a case here, `assertNever`'s `never` parameter makes that a
 * compile error instead of a silently-ignored job at runtime.
 */

import { JobName } from '@/types/contracts'
import type {
  EmbedJobPayload,
  EnrichJobPayload,
  ExtractJobPayload,
  IndexJobPayload,
  JobPayload,
  RelateJobPayload,
  ResolveJobPayload,
} from '@/types/contracts'
import { logger } from '@/lib/logger'

export type JobHandler<P extends JobPayload> = (payload: P) => Promise<void>

export interface JobRegistry {
  [JobName.Resolve]: JobHandler<ResolveJobPayload>
  [JobName.Extract]: JobHandler<ExtractJobPayload>
  [JobName.Enrich]: JobHandler<EnrichJobPayload>
  [JobName.Embed]: JobHandler<EmbedJobPayload>
  [JobName.Relate]: JobHandler<RelateJobPayload>
  [JobName.Index]: JobHandler<IndexJobPayload>
}

function placeholder<P extends JobPayload>(name: P['name']): JobHandler<P> {
  return async (payload) => {
    logger.warn({ jobName: name, payload }, `worker: '${name}' has no real handler yet (P7 placeholder) — no-op`)
  }
}

/**
 * Mutable on purpose: P7 replaces individual entries (`registry.enrich = realEnrichHandler`)
 * rather than needing to touch `dispatch` or re-export a new object — Open/Closed per CLAUDE.md.
 */
export const registry: JobRegistry = {
  [JobName.Resolve]: placeholder(JobName.Resolve),
  [JobName.Extract]: placeholder(JobName.Extract),
  [JobName.Enrich]: placeholder(JobName.Enrich),
  [JobName.Embed]: placeholder(JobName.Embed),
  [JobName.Relate]: placeholder(JobName.Relate),
  [JobName.Index]: placeholder(JobName.Index),
}

function assertNever(value: never): never {
  throw new Error(`worker: unhandled job name in dispatch: ${JSON.stringify(value)}`)
}

/** Exhaustively switches on `payload.name` and calls the matching registry handler. */
export async function dispatch(payload: JobPayload): Promise<void> {
  switch (payload.name) {
    case JobName.Resolve:
      return registry[JobName.Resolve](payload)
    case JobName.Extract:
      return registry[JobName.Extract](payload)
    case JobName.Enrich:
      return registry[JobName.Enrich](payload)
    case JobName.Embed:
      return registry[JobName.Embed](payload)
    case JobName.Relate:
      return registry[JobName.Relate](payload)
    case JobName.Index:
      return registry[JobName.Index](payload)
    default:
      return assertNever(payload)
  }
}

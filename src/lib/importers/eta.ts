const MINUTE_PACE_LIMIT = 18 // req/min — matches P3.1.7's token bucket (kept under OpenRouter's 20/min ceiling)
const DEFAULT_REQUESTS_PER_ITEM = 1.05 // ADR 0004: ~1 enrichment + ~0.05 batched relation-labeling per item

export interface EtaInput {
  remainingItems: number
  now: number
  /** Background budget left TODAY specifically. */
  remainingBudgetToday: number
  /** Full daily background budget (e.g. `LLM_DAILY_CAP - LLM_INTERACTIVE_RESERVE`). */
  dailyBackgroundBudget: number
  /** UTC epoch-ms of the next daily reset. */
  resetsAt: number
  requestsPerItem?: number
}

/**
 * Rough ETA (docs/API.md §3.10 calls it exactly that) for draining `remainingItems`
 * against the daily background LLM budget. Deliberately not sub-second precise — its
 * job is to answer "hours, or days?", per ADR 0004's own framing of a ~900-link
 * backlog taking about a day to drain.
 */
export function estimateEtaMs(input: EtaInput): number {
  const requestsPerItem = input.requestsPerItem ?? DEFAULT_REQUESTS_PER_ITEM
  if (input.remainingItems <= 0) return 0
  if (input.dailyBackgroundBudget <= 0) return Number.POSITIVE_INFINITY

  const msPerItem = (60_000 / MINUTE_PACE_LIMIT) * requestsPerItem
  const capacityToday = Math.floor(Math.max(0, input.remainingBudgetToday) / requestsPerItem)

  if (input.remainingItems <= capacityToday) {
    return Math.ceil(input.remainingItems * msPerItem)
  }

  const leftoverAfterToday = input.remainingItems - capacityToday
  const fullDayCapacity = Math.max(1, Math.floor(input.dailyBackgroundBudget / requestsPerItem))
  const extraFullDays = Math.floor(leftoverAfterToday / fullDayCapacity)
  const remainderItems = leftoverAfterToday - extraFullDays * fullDayCapacity
  const msUntilReset = Math.max(0, input.resetsAt - input.now)

  return Math.ceil(msUntilReset + extraFullDays * 86_400_000 + remainderItems * msPerItem)
}

const DURATION_UNITS: ReadonlyArray<readonly [string, number]> = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
]

/** e.g. `41_400_000` -> `"11h 30m"` — a compact, human-readable rendering of an ETA in ms. */
export function formatDurationHuman(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown'
  if (ms <= 0) return 'done'
  if (ms < 60_000) return '<1m'

  const parts: string[] = []
  let remaining = ms
  for (const [label, unitMs] of DURATION_UNITS) {
    const value = Math.floor(remaining / unitMs)
    if (value > 0) {
      parts.push(`${value}${label}`)
      remaining -= value * unitMs
    }
    if (parts.length === 2) break // two units of precision is plenty for a rough ETA
  }
  return parts.join(' ')
}

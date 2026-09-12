/**
 * The free-tier request budget (ADR 0004, CLAUDE.md "The Free-Tier Budget", P3.1.5/3.1.6).
 *
 * Persists a UTC-day request counter in `settings` under the two keys the plan's own data model
 * names for this (`docs/plans/.../2026-09-12-sieve-implementation-plan.md` §6): `settings.value`
 * for keys `llm_requests_used_today` and `quota_reset_utc`. `quota_reset_utc` is the epoch-ms
 * instant of the next UTC midnight — once `now() >= quota_reset_utc`, the counter rolls over.
 *
 * Two lanes share one counter but see different ceilings: `background` (pipeline stages: enrich,
 * relate) stops at `dailyCap - interactiveReserve`; `interactive` (chat, manual re-enrich) keeps
 * going until the full `dailyCap`. This is what keeps a WhatsApp backlog import from starving your
 * own chat queries — see ADR 0004.
 */

import type { UtcMillis } from '@/types/contracts'
import type { SettingsPort } from './settings-store'

export type BudgetLane = 'interactive' | 'background'

export interface BudgetReservation {
  ok: true
  lane: BudgetLane
  /** Requests left in this lane's share of today's budget, after this reservation. */
  remaining: number
}

export interface BudgetExhausted {
  ok: false
  lane: BudgetLane
  /** UTC epoch-ms of the next reset — surface this as "resumes in Xh" per the plan. */
  resetAt: UtcMillis
}

export type BudgetReserveResult = BudgetReservation | BudgetExhausted

export interface BudgetStatus {
  usedToday: number
  dailyCap: number
  interactiveReserve: number
  backgroundLimit: number
  resetAt: UtcMillis
}

const USED_TODAY_KEY = 'llm_requests_used_today'
const RESET_AT_KEY = 'quota_reset_utc'

function nextUtcMidnight(nowMs: UtcMillis): UtcMillis {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0)
}

export class BudgetManager {
  private readonly store: SettingsPort
  private readonly dailyCap: number
  private readonly interactiveReserve: number
  private readonly now: () => UtcMillis

  constructor(
    store: SettingsPort,
    dailyCap: number,
    interactiveReserve: number,
    now: () => UtcMillis = Date.now,
  ) {
    if (interactiveReserve >= dailyCap) {
      throw new Error(
        `interactiveReserve (${interactiveReserve}) must be less than dailyCap (${dailyCap})`,
      )
    }
    this.store = store
    this.dailyCap = dailyCap
    this.interactiveReserve = interactiveReserve
    this.now = now
  }

  private backgroundLimit(): number {
    return this.dailyCap - this.interactiveReserve
  }

  private limitFor(lane: BudgetLane): number {
    return lane === 'interactive' ? this.dailyCap : this.backgroundLimit()
  }

  /**
   * Rolls the counter to a fresh UTC day if the stored reset time has passed (or was never set —
   * first boot). Idempotent, cheap, safe to call on every `reserve()`/`status()`.
   */
  private rollIfNeeded(): { usedToday: number; resetAt: UtcMillis } {
    const nowMs = this.now()
    const storedResetAtRaw = this.store.get(RESET_AT_KEY)
    const storedResetAt = storedResetAtRaw ? Number(storedResetAtRaw) : 0
    if (!storedResetAt || Number.isNaN(storedResetAt) || nowMs >= storedResetAt) {
      const resetAt = nextUtcMidnight(nowMs)
      this.store.set(USED_TODAY_KEY, '0')
      this.store.set(RESET_AT_KEY, String(resetAt))
      return { usedToday: 0, resetAt }
    }
    const usedRaw = this.store.get(USED_TODAY_KEY)
    const usedToday = usedRaw ? Number(usedRaw) : 0
    return { usedToday: Number.isNaN(usedToday) ? 0 : usedToday, resetAt: storedResetAt }
  }

  /**
   * Atomically checks and reserves one request against `lane`'s share of today's budget.
   *
   * Synchronous by design. The backing `SettingsPort` (better-sqlite3 underneath, in production)
   * is synchronous, so there is no `await` between the read and the write here — no interleaving
   * window where two concurrent callers could both slip through right at the cap. Returns a plain
   * discriminated result rather than throwing: this is the non-throwing half of budget handling
   * (see `errors.ts`'s `BudgetExhaustedError` for the half of the story that crosses the frozen
   * `LLMProvider` boundary, which has no room in its return type for this).
   */
  reserve(lane: BudgetLane): BudgetReserveResult {
    const { usedToday, resetAt } = this.rollIfNeeded()
    const limit = this.limitFor(lane)
    if (usedToday >= limit) {
      return { ok: false, lane, resetAt }
    }
    const next = usedToday + 1
    this.store.set(USED_TODAY_KEY, String(next))
    return { ok: true, lane, remaining: limit - next }
  }

  /** For a future settings/health surface (`GET /api/v1/health`'s `llm_quota` block per
   *  .env.example) — not built here, just made available. */
  status(): BudgetStatus {
    const { usedToday, resetAt } = this.rollIfNeeded()
    return {
      usedToday,
      dailyCap: this.dailyCap,
      interactiveReserve: this.interactiveReserve,
      backgroundLimit: this.backgroundLimit(),
      resetAt,
    }
  }
}

/**
 * Small, dependency-free display formatters. No `date-fns`/`dayjs` dependency exists in
 * package.json and this phase cannot run `pnpm install` (see the phase brief) — `Intl` is a
 * runtime built-in that covers everything needed here without adding one.
 *
 * CLAUDE.md: "store UTC everywhere; convert only at the display layer." Every wire timestamp
 * (`created_at`, `published_at`, `kind_fields.last_commit`, …) is UTC epoch-ms (docs/API.md §1.3)
 * — these functions are that conversion boundary, and are only ever called from render code.
 */

/** "Sep 12, 2026" — used for created/published/last-commit dates across item cards and detail. */
export function formatDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(epochMs))
}

/** "Sep 12, 2026, 3:04 PM" — the one place a timestamp needs time-of-day precision too. */
export function formatDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(epochMs),
  )
}

/** `91557` -> `"91.6K"` — GitHub star counts in the repo table. One decimal place, standard `Intl` compact notation. */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

// ---------------------------------------------------------------------------
// Date-range filter <-> <input type="date"> — the filter rail's date_from/date_to fields
// ---------------------------------------------------------------------------

/** epoch ms -> `"yyyy-mm-dd"` in the *local* timezone (matches what `<input type="date">` shows/accepts), or `""` for an unset bound. */
export function epochMsToDateInputValue(epochMs: number | undefined): string {
  if (epochMs === undefined) return ''
  const d = new Date(epochMs)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * `"yyyy-mm-dd"` -> epoch ms of that local calendar day's start (`boundary: 'start'`) or end
 * (`boundary: 'end'`) — `date_from`/`date_to` are documented as inclusive bounds on `created_at`
 * (docs/API.md §3.2), so a one-day range needs both ends of the same calendar day. Returns
 * `undefined` for an empty/unparseable value rather than throwing — an in-progress or cleared
 * date input is a normal state, not an error.
 */
export function dateInputValueToEpochMs(
  value: string,
  boundary: 'start' | 'end',
): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, yearStr, monthStr, dayStr] = match
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const date =
    boundary === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999)
  return date.getTime()
}

import type { DateComponentOrder, DateFormatInfo } from './types'

/** The raw numeric pieces pulled off a header line, before day/month order is known. */
export interface RawTimestampComponents {
  /** First numeric date component as written — ambiguously day or month. */
  comp1: number
  /** Second numeric date component as written — ambiguously month or day. */
  comp2: number
  /** Already normalized to 4 digits (see {@link normalizeYear}). */
  year: number
  /** As written: 0-23 if `meridiem` is `null`, 1-12 if `meridiem` is set. */
  hour: number
  minute: number
  second: number
  meridiem: 'AM' | 'PM' | null
}

/**
 * WhatsApp didn't exist before 2000, so any 2-digit year in a personal chat export is
 * safely `2000 + YY`. 4-digit years pass through unchanged.
 */
export function normalizeYear(rawYear: string): number {
  return rawYear.length <= 2 ? 2000 + Number(rawYear) : Number(rawYear)
}

/**
 * WhatsApp exports never carry a date-format flag, so day/month order has to be
 * inferred from the data itself: whichever position ever holds a value over 12 cannot
 * be a month, so that position must be the day — unambiguous the moment any single
 * line in the export is past the 12th of its month, which is true for the large
 * majority of exports spanning more than a couple of weeks.
 *
 * Only a file confined entirely to the 1st-12th of every month is genuinely
 * ambiguous. For that case we fall back to DD/MM/YYYY — WhatsApp's own international
 * default outside the US — and say so explicitly via `confidence: 'assumed'` rather
 * than silently guessing (P12.1's "detect, don't assume, and report which you
 * inferred").
 */
export function detectDateOrder(
  pairs: ReadonlyArray<{ comp1: number; comp2: number }>,
): DateFormatInfo {
  for (const { comp1, comp2 } of pairs) {
    if (comp1 > 12) return { order: 'DMY', confidence: 'certain' }
    if (comp2 > 12) return { order: 'MDY', confidence: 'certain' }
  }
  return { order: 'DMY', confidence: 'assumed' }
}

/** Correct day count for `year`/`month` (1-12), leap years included. */
export function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of "next month" is the last day of `month1to12` — lets the platform's own
  // calendar math handle leap years instead of a hand-rolled table.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export type BuildTimestampResult = { ok: true; timestampMs: number } | { ok: false; reason: string }

/**
 * Turns raw header components into a UTC epoch-ms timestamp, validating ranges along
 * the way (an out-of-range day/month/hour/minute/second means this wasn't actually a
 * valid timestamp header, however much it looked like one — see chat-parser.ts).
 *
 * No timezone is ever recorded in a WhatsApp export, only the exporting phone's local
 * wall-clock time — there is nothing in the file to recover a real UTC offset from.
 * Like every other WhatsApp-export parser, we take the wall-clock value literally as
 * UTC rather than guessing a timezone. This is a deliberate, documented assumption,
 * not a silent one.
 */
export function buildTimestampMs(
  components: RawTimestampComponents,
  order: DateComponentOrder,
): BuildTimestampResult {
  const day = order === 'DMY' ? components.comp1 : components.comp2
  const month = order === 'DMY' ? components.comp2 : components.comp1
  const { year, minute, second, meridiem } = components
  let hour = components.hour

  if (month < 1 || month > 12) {
    return { ok: false, reason: `month ${month} out of range 1-12` }
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return {
      ok: false,
      reason: `day ${day} out of range for ${year}-${String(month).padStart(2, '0')}`,
    }
  }
  if (minute < 0 || minute > 59) {
    return { ok: false, reason: `minute ${minute} out of range 0-59` }
  }
  if (second < 0 || second > 59) {
    return { ok: false, reason: `second ${second} out of range 0-59` }
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { ok: false, reason: `hour ${hour} out of range 1-12 for a 12-hour clock` }
    }
    // 12 AM -> 0, 1-11 AM unchanged, 12 PM -> 12, 1-11 PM -> 13-23.
    hour = hour % 12
    if (meridiem === 'PM') hour += 12
  } else if (hour < 0 || hour > 23) {
    return { ok: false, reason: `hour ${hour} out of range 0-23 for a 24-hour clock` }
  }

  return { ok: true, timestampMs: Date.UTC(year, month - 1, day, hour, minute, second) }
}

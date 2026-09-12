/**
 * Client-side grouping (plan §10.1.4 / deliverable #4 — "create a group sort of LLMs, websites
 * based on their kind, like videos, text and audio"). Pure re-bucketing of an already
 * fetched/filtered/sorted flat list — docs/API.md §3.3 is explicit that grouping has no server
 * shape of its own, so this is the entire implementation of it, and it's exercised directly by
 * `tests/unit/library/group-items.test.ts` with no rendering involved.
 */

import type { GroupBy, ItemStatus, ItemKind, ItemSummary } from '@/components/library/types'

export interface ItemGroup<T> {
  key: string
  label: string
  items: T[]
}

// Canonical display order — deliberately not alphabetical. Repos/videos/articles are the three
// kinds the user named explicitly; the rest follow in roughly-descending frequency for a
// research library. Only kinds actually present render a heading (an empty "PDFs" section would
// be noise, not information).
const KIND_ORDER: readonly ItemKind[] = [
  'github',
  'video',
  'article',
  'social',
  'audio',
  'pdf',
  'other',
]
const KIND_GROUP_LABELS: Record<ItemKind, string> = {
  github: 'Repos',
  video: 'Videos',
  article: 'Articles',
  social: 'Social',
  audio: 'Audio',
  pdf: 'PDFs',
  other: 'Other links',
}

// Same order as the research-status pipeline (gallery's ALL_STATUSES / status-pill.tsx's semantic
// grouping) — pipeline-owned states first, then the four board columns, then the two terminal ones.
const STATUS_ORDER: readonly ItemStatus[] = [
  'queued',
  'processing',
  'inbox',
  'to_test',
  'testing',
  'tested',
  'archived',
  'dropped',
  'failed',
]
const STATUS_GROUP_LABELS: Record<ItemStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  inbox: 'Inbox',
  to_test: 'To test',
  testing: 'Testing',
  tested: 'Tested',
  archived: 'Archived',
  dropped: 'Dropped',
  failed: 'Failed',
}

const NO_TOPIC_KEY = '__no_topic__'
const MS_PER_DAY = 86_400_000

function startOfDay(epochMs: number): number {
  const d = new Date(epochMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface DateBucket {
  key: string
  label: string
  /** Lower rank sorts first (more recent first) — the grid always reads newest-bucket-first. */
  rank: number
}

/**
 * Buckets a timestamp relative to `now` into Today / Yesterday / This week / This month / a named
 * "Month YYYY" bucket for anything older. Calendar-day math is done in the runtime's local
 * timezone deliberately — "Today" is a display-layer, human-clock concept (CLAUDE.md: convert
 * from UTC only at the display layer), and this only ever runs client-side.
 */
export function dateBucketFor(createdAtMs: number, nowMs: number = Date.now()): DateBucket {
  const dayDiff = Math.round((startOfDay(nowMs) - startOfDay(createdAtMs)) / MS_PER_DAY)

  // A negative diff (item timestamped in the future — clock skew, imported backdated-but-not-that
  // backdated data, etc.) still reads as "Today" rather than a nonsensical bucket.
  if (dayDiff <= 0) return { key: 'today', label: 'Today', rank: 0 }
  if (dayDiff === 1) return { key: 'yesterday', label: 'Yesterday', rank: 1 }
  if (dayDiff <= 6) return { key: 'this-week', label: 'This week', rank: 2 }

  const now = new Date(nowMs)
  const created = new Date(createdAtMs)
  if (created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) {
    return { key: 'this-month', label: 'This month', rank: 3 }
  }

  const monthsAgo =
    (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth())
  const key = `${created.getFullYear()}-${String(created.getMonth()).padStart(2, '0')}`
  const label = created.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return { key, label, rank: 3 + monthsAgo }
}

/** Groups `items` by kind, in `KIND_ORDER`, omitting kinds with zero items. */
function groupByKind<T extends ItemSummary>(items: readonly T[]): ItemGroup<T>[] {
  const byKind = new Map<ItemKind, T[]>()
  for (const item of items) {
    const list = byKind.get(item.kind)
    if (list) list.push(item)
    else byKind.set(item.kind, [item])
  }
  return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    key: kind,
    label: KIND_GROUP_LABELS[kind],
    items: byKind.get(kind) as T[],
  }))
}

/** Groups `items` by research status, in pipeline order, omitting statuses with zero items. */
function groupByStatus<T extends ItemSummary>(items: readonly T[]): ItemGroup<T>[] {
  const byStatus = new Map<ItemStatus, T[]>()
  for (const item of items) {
    const list = byStatus.get(item.status)
    if (list) list.push(item)
    else byStatus.set(item.status, [item])
  }
  return STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({
    key: status,
    label: STATUS_GROUP_LABELS[status],
    items: byStatus.get(status) as T[],
  }))
}

/** Groups by the item's primary topic, most-populous first (topics are unbounded/dynamic, unlike kind/status). "No topic" always sorts last regardless of its count — it's a residual bucket, not a real topic. */
function groupByTopic<T extends ItemSummary>(items: readonly T[]): ItemGroup<T>[] {
  const groups = new Map<string, { label: string; items: T[] }>()
  for (const item of items) {
    const key = item.topic?.slug ?? NO_TOPIC_KEY
    const existing = groups.get(key)
    if (existing) existing.items.push(item)
    else groups.set(key, { label: item.topic?.label ?? 'No topic', items: [item] })
  }
  return [...groups.entries()]
    .sort(([keyA, a], [keyB, b]) => {
      if (keyA === NO_TOPIC_KEY) return 1
      if (keyB === NO_TOPIC_KEY) return -1
      if (b.items.length !== a.items.length) return b.items.length - a.items.length
      return a.label.localeCompare(b.label)
    })
    .map(([key, { label, items }]) => ({ key, label, items }))
}

/** Groups by `dateBucketFor(item.created_at)`, most-recent bucket first. */
function groupByDate<T extends ItemSummary>(items: readonly T[], now: number): ItemGroup<T>[] {
  const groups = new Map<string, { label: string; rank: number; items: T[] }>()
  for (const item of items) {
    const bucket = dateBucketFor(item.created_at, now)
    const existing = groups.get(bucket.key)
    if (existing) existing.items.push(item)
    else groups.set(bucket.key, { label: bucket.label, rank: bucket.rank, items: [item] })
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([key, { label, items }]) => ({ key, label, items }))
}

/**
 * Entry point used by the library grid. `'none'` isn't handled here — the grid renders a flat
 * list itself in that case rather than a single synthetic group, so callers should branch on
 * `groupBy === 'none'` before reaching for this function.
 */
export function groupItems<T extends ItemSummary>(
  items: readonly T[],
  groupBy: Exclude<GroupBy, 'none'>,
  now: number = Date.now(),
): ItemGroup<T>[] {
  switch (groupBy) {
    case 'kind':
      return groupByKind(items)
    case 'status':
      return groupByStatus(items)
    case 'topic':
      return groupByTopic(items)
    case 'date':
      return groupByDate(items, now)
  }
}

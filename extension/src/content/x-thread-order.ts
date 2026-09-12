/**
 * Pure ordering/dedup logic for an X/Threads thread walk (P4.2.3).
 *
 * Why sort by ID instead of trusting DOM order: X/Twitter status IDs are
 * Snowflake IDs — 64-bit integers that are monotonically increasing with
 * creation time, a property of Twitter's ID-generation scheme since ~2010.
 * That has nothing to do with their DOM/markup and so, unlike almost
 * everything else about scraping X, is not at risk of silently rotting the
 * next time their frontend changes. The DOM's *visual* order is not always
 * chronological — quote-tweets, "Show more replies" insertions, and ads can
 * interleave — so this sorts on the numeric ID rather than trusting
 * document order.
 *
 * Generic over any `{ id: string }`-shaped item so it's testable with plain
 * fixture data, independent of whatever DOM element type the real walker
 * (`x-thread.ts`) attaches to each entry.
 */

export interface Identified {
  id: string
}

export function orderThreadPosts<T extends Identified>(posts: readonly T[]): T[] {
  const seen = new Set<string>()
  const deduped = posts.filter((post) => {
    if (seen.has(post.id)) return false
    seen.add(post.id)
    return true
  })

  return deduped.sort((a, b) => {
    const diff = BigInt(a.id) - BigInt(b.id)
    if (diff < 0n) return -1
    if (diff > 0n) return 1
    return 0
  })
}

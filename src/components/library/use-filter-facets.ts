'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchItemsPage } from '@/components/library/api-client'

export interface TopicFacet {
  slug: string
  label: string
  color: string
}

export interface FilterFacets {
  topics: TopicFacet[]
  tags: string[]
}

/**
 * Populates the topic/tag multi-selects in the filter rail. There is no dedicated "list all
 * topics/tags" endpoint in docs/API.md — the only vocabulary this phase can build a facet list
 * from is the items themselves, so this pulls one reasonably large unfiltered page (Sieve is a
 * single-user library; CLAUDE.md's scale reality is hundreds of items, not millions, so 100
 * covers realistic libraries without needing real pagination here) and derives the distinct
 * topic/tag values client-side. `kind`/`status`/`extraction_tier` don't need this treatment — the
 * API's fixed enums are already known statically (see filter-rail.tsx).
 */
export function useFilterFacets(): FilterFacets & { isLoading: boolean } {
  const query = useQuery({
    queryKey: ['library', 'facets'],
    queryFn: async () => {
      const page = await fetchItemsPage(new URLSearchParams(), { limit: 100 })
      const topics = new Map<string, TopicFacet>()
      const tags = new Set<string>()
      for (const item of page.data) {
        if (item.topic && !topics.has(item.topic.slug)) {
          topics.set(item.topic.slug, {
            slug: item.topic.slug,
            label: item.topic.label,
            color: item.topic.color,
          })
        }
        for (const tag of item.tags) tags.add(tag)
      }
      return {
        topics: [...topics.values()].sort((a, b) => a.label.localeCompare(b.label)),
        tags: [...tags].sort((a, b) => a.localeCompare(b)),
      }
    },
    staleTime: 60_000,
  })

  return {
    topics: query.data?.topics ?? [],
    tags: query.data?.tags ?? [],
    isLoading: query.isPending,
  }
}

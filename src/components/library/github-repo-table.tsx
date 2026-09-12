import { Star } from 'lucide-react'

import { formatCompactNumber, formatDate } from '@/components/library/format'
import type { GithubKindFields } from '@/components/library/types'

export interface GithubRepoTableProps {
  fields: GithubKindFields
}

/**
 * Deliverable #7 — "what it does, language, stars, last commit, licence" — rendered as a real
 * `<table>` (key/value rows, not a multi-column spreadsheet) so it never risks the horizontal
 * scroll the phase's hard mobile requirement forbids: two columns, values wrap naturally at
 * 390 px. `primary_use_case` (also present on `kind_fields`, docs/API.md §2) is included as a
 * bonus sixth row since the live API always returns it alongside `what_it_does` and dropping data
 * the model already produced would be wasteful.
 */
export function GithubRepoTable({ fields }: GithubRepoTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Repository details</caption>
        <tbody>
          {fields.what_it_does && (
            <tr className="border-b border-border">
              <th
                scope="row"
                className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
              >
                What it does
              </th>
              <td className="px-4 py-3 text-foreground">{fields.what_it_does}</td>
            </tr>
          )}
          <tr className="border-b border-border">
            <th
              scope="row"
              className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
            >
              Language
            </th>
            <td className="px-4 py-3 text-foreground">{fields.language ?? '—'}</td>
          </tr>
          <tr className="border-b border-border">
            <th
              scope="row"
              className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
            >
              Stars
            </th>
            <td className="px-4 py-3 text-foreground">
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 text-warning" aria-hidden="true" />
                {formatCompactNumber(fields.stars)}
              </span>
            </td>
          </tr>
          <tr className="border-b border-border">
            <th
              scope="row"
              className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
            >
              Last commit
            </th>
            <td className="px-4 py-3 text-foreground">
              {fields.last_commit ? formatDate(fields.last_commit) : '—'}
            </td>
          </tr>
          <tr className={fields.primary_use_case ? 'border-b border-border' : undefined}>
            <th
              scope="row"
              className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
            >
              License
            </th>
            <td className="px-4 py-3 text-foreground">{fields.license ?? '—'}</td>
          </tr>
          {fields.primary_use_case && (
            <tr>
              <th
                scope="row"
                className="w-32 shrink-0 px-4 py-3 text-left align-top font-medium text-muted-foreground sm:w-40"
              >
                Primary use case
              </th>
              <td className="px-4 py-3 text-foreground">{fields.primary_use_case}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

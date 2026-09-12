/**
 * Free-text label -> a URL/identifier-safe slug. Used by the topic override editor: a human
 * types a plain label ("Agent Frameworks"), and `PATCH /api/v1/items/:id`'s `topic` field wants a
 * slug (docs/API.md §3.5: "setting `topic` to a slug that doesn't exist yet creates it"). Kept as
 * its own tiny, independently-testable module rather than folded into format.ts — that file is
 * about *display* formatting (wire value -> human string); this is the opposite direction.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

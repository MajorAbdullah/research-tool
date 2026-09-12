/**
 * Root route. There is no distinct "home" surface in the product brief — `/library` (see
 * `src/components/common/nav-items.ts`, which every nav shell already points at) is the closest
 * thing Sieve has to a landing page, so `/` permanently redirects there rather than duplicating
 * the library's rendering in two places (KISS/DRY: one implementation, one URL that means
 * "the library").
 *
 * `permanentRedirect` (308), not `redirect` (307/303) — this is a fixed structural fact about the
 * app's routing, not a situational/conditional redirect, so the semantically-correct permanent
 * status is the right one. Before this file existed, `/` 404'd outright (nothing was mounted at
 * the route) — see this phase's final report.
 */

import { permanentRedirect } from 'next/navigation'

export default function RootPage(): never {
  permanentRedirect('/library')
}

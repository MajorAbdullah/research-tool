# ADR 0006: The browser extension is the extraction engine, not a convenience

**Status:** Accepted · **Date:** 2026-09-12

## Context

The VPS has a **datacenter IP**. YouTube, Instagram, X, and Cloudflare-fronted blogs treat datacenter
IPs as bots. Server-side extraction libraries (`youtube-transcript-api`, `yt-dlp`) verifiably die
after **~100–200 requests** with `RequestBlocked`/429 responses when run from one. A server-only
design degrades to "title + thumbnail" (`metadata_only`) for exactly the sources — YouTube,
Instagram Reels, X/Threads — that motivated building Sieve in the first place: the second success
criterion is finding videos whose titles never mention the topic being searched, which is
impossible without their actual transcript or caption text.

This is not a solved problem being needlessly reinvented: Karakeep, the closest prior art, has the
identical gap. YouTube transcript extraction is an **open, unresolved feature request** in
Karakeep's own tracker (`karakeep-app/karakeep#1629`), confirming the extension-based path would
have to be built regardless of whether Sieve forked Karakeep or not (see ADR 0002).

## Decision

The browser extension runs client-side, in the user's own browser, on the user's **residential IP**,
already authenticated and logged into these sites. It captures the rendered DOM, the YouTube
transcript panel, the tweet thread, or the Reel caption directly, then POSTs that captured text to
the server alongside the URL. No proxies, no server-held cookies or session tokens for these sites.

This extension-captured path is rung 1 of the extraction ladder for YouTube, article/blog, and
X/Threads (GitHub and PDF go straight through APIs/direct fetch, since those aren't blocked).
Server-side fallback (oEmbed/timedtext, Readability, OG metadata) is rung 2+, explicitly expected to
sometimes fail or degrade rather than to be the primary path.

Every item records an `extraction_tier` (`full` / `partial` / `metadata_only`) so degradation is
visible in the UI ("⚠ metadata only — open with the extension to enrich") and recoverable via a
**Re-extract** button — never silent.

## Consequences

- The extension (P4) sits on the critical path for the product's core value proposition, not as an
  optional client — it is built and tested with the same rigor as the server, including its own
  client-side YouTube transcript-panel scraper (P4.2.2) and DOM/thread walkers (P4.2.1, P4.2.3,
  P4.2.4).
- No scraping-detection arms race to fight on the VPS: the hard part is solved by using an IP and
  session that were never going to be flagged in the first place, rather than by proxies or
  cookie-jar tricks.
- Anything captured only through the paste box or the PWA share target (no extension involved) is
  expected to land at `partial` or `metadata_only` tier for these specific sources — a known,
  accepted, UI-surfaced limitation, not a bug to eventually fix server-side.
- Depends on the extension actually being installed and invoked at capture time. A link shared from
  a phone via the Android share sheet has no extension available on mobile Chrome, so full
  extraction for YouTube/Instagram/X specifically requires later opening it on desktop with the
  extension, or accepting the lower tier.

## What would reverse this

- YouTube/Instagram/X/Cloudflare stop blocking datacenter-IP scraping traffic for these content
  types — unlikely, and not something to plan around, but it would remove the premise entirely.
- The VPS gains a residential or rotating-proxy egress path at acceptably low cost and reliability,
  removing the datacenter-IP-blocking problem at its root without needing a browser at all.
- A hosted extraction/transcription API becomes available at zero or near-zero cost and works
  reliably from a datacenter IP. The plan already flags one promising v2 candidate for this —
  `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, which accepts audio + video directly at
  256k context — but this is explicitly deferred and unverified for v1, not a v1 justification.
- Karakeep or another prior-art project ships and open-sources a robust server-side YouTube
  transcript solution that also survives datacenter-IP blocking in practice — at that point the
  ladder's rung ordering could invert for that source.

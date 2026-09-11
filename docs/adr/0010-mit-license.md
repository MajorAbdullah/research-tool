# ADR 0010: MIT licence

**Status:** Accepted · **Date:** 2026-09-12

## Context

Sieve was built from scratch rather than forking Karakeep (ADR 0002), specifically to avoid
inheriting Karakeep's AGPL license and the source-disclosure obligations that come with building on
AGPL-licensed code. Because no AGPL code was forked, Sieve carries no upstream license obligations
of its own — the choice of license for an eventual open-source release is unconstrained by history,
not dictated by it.

The plan anticipates a public release once the system is hardened (P14.8: license, `CONTRIBUTING`,
issue templates — "Ready to open-source").

## Decision

License Sieve under **MIT**.

## Consequences

- Maximizes reuse: anyone — including for commercial or closed-source use — can adopt, fork, or
  embed Sieve's code with minimal obligation (attribution only), which is the explicit goal for an
  eventual open-source release.
- Unlike AGPL, MIT places no requirement on downstream users to disclose their own modifications or
  network-served changes — a deliberate tradeoff favoring adoption over "protecting" Sieve's own
  code from closed-source derivatives.
- Consistent with not having forked AGPL-licensed code in the first place (ADR 0002) — there is no
  upstream license conflict to reconcile, and nothing prevents this choice.

## What would reverse this

- A future decision to incorporate AGPL- or GPL-licensed code directly into Sieve (e.g., adopting a
  copyleft-licensed dependency, or actually merging in code from Karakeep or another AGPL project
  later) would force relicensing the whole project, almost certainly toward copyleft.
- A strategic decision to monetize Sieve as a hosted product, paired with a concern that a
  permissive license makes it easy for a third party to host a competing copy — this would need to
  be weighed explicitly against the "maximize reuse" goal that motivated MIT here, since the two
  trade directly against each other.

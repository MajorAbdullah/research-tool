# ADR 0008: No multi-tenancy, billing, entitlements, or SSO

**Status:** Accepted · **Date:** 2026-09-12

## Context

Sieve has exactly one user: the person deploying it for themselves. `CLAUDE.md` and the underlying
`Best Practices/` docs, however, are written for a multi-tenant SaaS platform and default to
expecting billing, entitlements/plans, per-tenant quotas, and SSO/SAML as standard requirements.

The project's own KISS/YAGNI rule, stated directly in `CLAUDE.md`, authorizes declining this
machinery explicitly rather than by omission:

> "Prefer the simplest thing that solves the actual, current requirement. Do not build for
> speculative future scale, tenants, plans, or providers you don't have yet."

## Decision

- Do **not** build multi-tenancy, a billing-provider integration, entitlements/plans, SSO/SAML, or
  per-tenant quotas.
- **Do** still put `user_id` on every table from day one, and route every query through **one**
  `user_id`-scoping helper — rather than implicitly hardcoding "the one user" ad hoc across the
  codebase — so the isolation *mechanism* exists even though only one user occupies it today.
- Auth itself stays real: Auth.js, credentials + passkey, argon2-hashed password, a single seeded
  user. Declining multi-tenancy is not declining authentication or authorization — every protected
  route still checks auth server-side.

## Consequences

- Whole categories of SaaS engineering work (billing integration, plan/entitlement checks, tenant
  admin surfaces, SSO configuration) are simply absent — smaller surface area, faster to build and
  to audit.
- Enabling a second user later is scoped, by design, to adding a signup path pointed at the existing
  scoping helper — **a signup page, not a migration** — because every table and every query already
  carries and enforces `user_id`.
- This claim only holds if every query actually goes through the scoping helper; an unscoped query
  is a latent multi-tenancy bug today, and more immediately, an access-control bug even with one
  user — `CLAUDE.md` calls this out as something to catch in code review, not something the
  architecture alone guarantees.
- The `saas-platform-best-practices.md` doc is marked "largely out of scope," with exactly one
  surviving rule (tenant resolution comes from the authenticated session, never client input) — if
  multi-tenancy is ever revisited, that whole doc needs a fresh read, not an incremental diff.

## What would reverse this

- **A second real user** (not hypothetical) needs an account. Per `CLAUDE.md`'s own instruction,
  this ADR and `saas-platform-best-practices.md` get revisited *before* building anything — and the
  "signup page, not a migration" claim gets tested for real, including whether every query actually
  was scoped correctly all along.
- Sieve is open-sourced (ADR 0010) and someone wants to run a **shared/hosted** instance rather than
  everyone self-hosting their own copy — that is a hosted-multi-tenant product decision distinct
  from "someone else deploys their own copy," and would need billing/entitlements designed from
  scratch, not retrofitted from the scoping helper alone.

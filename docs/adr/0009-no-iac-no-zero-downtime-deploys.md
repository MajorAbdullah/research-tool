# ADR 0009: No Terraform/Pulumi IaC, and no zero-downtime deploys

**Status:** Accepted · **Date:** 2026-09-12

## Context

The entire infrastructure footprint is **one nginx vhost** (added to the existing per-subdomain
vhost pattern in `/etc/nginx/sites-enabled/*.teknikki.com` on the Contabo VPS) and **one Docker
Compose file**, targeting a single container bound to `127.0.0.1:3060`. There is no second
environment, no second service, and no load balancer.

`architecture-infra-best-practices.md` (summarized in `CLAUDE.md`) calls for IaC tooling and points
to zero-downtime/canary/blue-green deploys as general best practice — both written with a
multi-service, multi-environment SaaS deployment in mind, which this is not.

## Decision

- Do **not** introduce Terraform, Pulumi, or any other IaC tool. Treat `deploy/` + `compose*.yml`,
  committed to git and reviewed like code, as the versioned infrastructure definition at this scale.
- Do **not** build zero-downtime, canary, or blue-green deployment mechanics. Accept a plain
  container restart (`compose up -d` after a GHCR image pull) as the deploy mechanism.
- **Do** keep the one part of "safe deploys" that actually matters for a single-user tool: a tested,
  fast rollback to the previous GHCR image tag.

## Consequences

- Deploys are a straightforward pull-and-restart (P6.3): simple to reason about and debug, nothing
  to orchestrate across multiple instances or a load balancer.
- A deploy causes a real, user-visible outage of **approximately 5 seconds** (container restart
  time) — judged acceptable because there is one user and no SLA beyond not annoying the person
  running it.
- No infrastructure-drift protection beyond normal git history and code review of the compose/nginx
  files — acceptable because the infrastructure surface is genuinely small (one vhost, one compose
  file) and unlikely to drift the way a larger Terraform-managed estate might.
- If a bad deploy ships, recovery is "redeploy the previous GHCR tag" — which must actually be
  tested and fast. This is the one piece of the larger best-practices doc explicitly kept rather
  than dropped alongside zero-downtime tooling.

## What would reverse this

- The infrastructure surface grows past "one vhost, one compose file" — e.g., a second environment
  (staging), a second service, or a second host — at which point hand-edited files stop being
  reliably reviewable as *the* infrastructure definition, and IaC tooling earns its overhead.
- The ~5 second restart window stops being acceptable — e.g., a second user depends on uptime during
  that window, or usage patterns change such that restarts collide with active use often enough to
  be a real, recurring complaint.
- A bad deploy actually happens and the "fast rollback to the previous GHCR tag" is discovered not to
  work when tested — that specific failure needs its own fix before revisiting whether the broader
  zero-downtime tooling is still unnecessary.

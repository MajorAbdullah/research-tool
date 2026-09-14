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

---

## Amendment — 2026-09-15: rollback is now automatic

**Status:** Accepted · Supplements the Decision above; reverses nothing in it.

When this ADR was written, deploys were assumed to be run by a human who would watch the result.
`deploy/deploy.sh` encoded that assumption in its failure path, printing:

> Deploy did NOT roll back automatically — that is deliberate, see
> docs/adr/0009-no-iac-no-zero-downtime-deploys.md

That message attributed a rule to this ADR that this ADR never stated. The Decision above asks for
"a tested, fast rollback to the previous GHCR image tag" and says it "must actually be tested" —
it says nothing about who or what triggers it.

Deploys are now **ungated and automatic on every push to `master`** (the repo owner's explicit
choice — tests still run and report, but do not block). Nobody is watching a deploy at the moment
it fails, so "stop and wait to be noticed" means the site stays down for however long it takes
someone to look. `deploy.sh` therefore now records the running image before pulling and, if the
new container does not report healthy within the existing 120 s window, brings the previous image
back and exits non-zero.

This **serves** the original decision rather than contradicting it. The ADR's stated requirement
was that the rollback path be *tested*; running it automatically on every failed deploy is the
strongest form of that — it is no longer an emergency-only path that might be broken when it is
finally needed.

Deliberately unchanged:

- Still one code path for deploy and rollback — the rollback is the same shell function, called
  with a different image, not a second script.
- It does **not** recurse. A rollback that also fails stops and says so loudly rather than looping.
- A deploy that ends on anything other than the requested image exits non-zero, so Actions shows
  red even when the rollback saved the site. A green run means the new image is live.
- Nothing here adds zero-downtime, canary, or blue-green machinery. The ~5 s restart window stands,
  and a rollback simply costs a second one.

**What would reverse this amendment:** rollbacks firing on transient health-check flakiness rather
than genuinely broken images — at which point the fix is a more accurate health check, not a
return to manual recovery.

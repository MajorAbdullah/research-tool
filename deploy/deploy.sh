#!/usr/bin/env bash
# =============================================================================
# deploy/deploy.sh — pull a GHCR image tag and roll the Sieve container.
#
# This is the ONE code path used for every deploy AND every rollback. There
# is no separate rollback script — see docs/adr/0009-no-iac-no-zero-downtime-deploys.md:
# the thing that must actually work is a fast, tested path back to a
# previous image, and the way to keep it tested is to make it the exact
# same path used on every normal deploy, not a bespoke script that only
# gets exercised in an emergency.
#
# Runs ON THE VPS, invoked over SSH by .github/workflows/deploy.yml, from
# the deploy directory (see deploy/README.md for first-time setup — this
# expects compose.yml, compose.prod.yml, and a real .env to already be
# present alongside it, at:  ~/apps/sieve/).
#
# Usage — normal deploy (what CI runs automatically on every push to main):
#   bash deploy.sh ghcr.io/OWNER/sieve:sha-abc1234
#
# Usage — manual rollback (what a human runs; identical mechanism):
#   ssh contabo
#   cd ~/apps/sieve
#   bash deploy.sh ghcr.io/OWNER/sieve:sha-<previous-good-sha>
#
# Idempotent: re-running with the same tag is a safe no-op-ish redeploy;
# re-running with a different tag is exactly what a rollback or roll-
# forward is. Safe to run any number of times.
#
# Does NOT run database migrations. Sieve's migration runner is idempotent
# and runs at application boot (src/db/migrate.ts, called from
# instrumentation.ts) — that is the one and only place migrations run.
# This script never touches the database directly, and never should.
# =============================================================================

set -euo pipefail

IMAGE_REF="${1:?Usage: deploy.sh <full-ghcr-image-ref>, e.g. ghcr.io/OWNER/sieve:sha-abc1234}"

# Resolve paths relative to THIS script's location, not the caller's $PWD,
# so `bash deploy.sh ...` works the same whether invoked from cron, CI, or
# an interactive shell in a different directory.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"

echo "==> Deploying ${IMAGE_REF} in ${DEPLOY_DIR}"

if [ ! -f .env ]; then
  echo "!! No .env found in ${DEPLOY_DIR}. Copy .env.example, fill in real values," >&2
  echo "!! and place it here as .env before running this script. See deploy/README.md." >&2
  exit 1
fi

if [ ! -f compose.yml ] || [ ! -f compose.prod.yml ]; then
  echo "!! compose.yml / compose.prod.yml missing from ${DEPLOY_DIR}." >&2
  echo "!! These are shipped by the deploy workflow on every run — see deploy/README.md" >&2
  echo "!! if this is a fresh box and they haven't landed yet." >&2
  exit 1
fi

# The container runs as uid:gid 1001:1001 (see Dockerfile's `nextjs` user).
# Docker auto-creates a missing bind-mount source directory as root, which
# a non-root container then can't write to — so this directory must exist,
# with the right owner, before `compose up` ever runs. Idempotent: safe to
# re-run against directories that already exist and are already owned
# correctly.
echo "==> Ensuring ./data and ./.fastembed_cache exist with the right owner"
mkdir -p "${DEPLOY_DIR}/data" "${DEPLOY_DIR}/.fastembed_cache"
sudo chown -R 1001:1001 "${DEPLOY_DIR}/data" "${DEPLOY_DIR}/.fastembed_cache"

echo "==> Pulling ${IMAGE_REF}"
docker pull "${IMAGE_REF}"

echo "==> Rolling the container"
export SIEVE_IMAGE="${IMAGE_REF}"
docker compose -f compose.yml -f compose.prod.yml up -d --remove-orphans

echo "==> Waiting for the container to report healthy"
ATTEMPTS=24   # 24 x 5s = 120s ceiling; HEALTHCHECK start_period alone is 30s
STATUS="starting"
for i in $(seq 1 "${ATTEMPTS}"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' sieve 2>/dev/null || echo "unknown")"
  if [ "${STATUS}" = "healthy" ]; then
    break
  fi
  echo "    [$i/${ATTEMPTS}] container health: ${STATUS} — waiting..."
  sleep 5
done

echo "==> docker compose ps"
docker compose -f compose.yml -f compose.prod.yml ps

if [ "${STATUS}" != "healthy" ]; then
  echo "!! Container did not become healthy (last status: ${STATUS})." >&2
  echo "!! Deploy did NOT roll back automatically — that is deliberate, see" >&2
  echo "!! docs/adr/0009-no-iac-no-zero-downtime-deploys.md. Investigate with:" >&2
  echo "!!   docker logs --since 5m sieve" >&2
  echo "!! and roll back by hand once you know the previous good tag:" >&2
  echo "!!   bash deploy.sh ghcr.io/OWNER/sieve:sha-<previous-good-sha>" >&2
  exit 1
fi

echo "==> Health endpoint response:"
curl -fsS http://127.0.0.1:3060/api/v1/health && echo

# Prune only OLD SIEVE image tags, keeping the most recent few for fast
# rollback. Deliberately scoped by repository name — this box runs ~45
# other containers and this script must never touch anything that isn't
# unambiguously ours (no host-wide `docker image prune`). Untagging (not
# `-f` forcing) means a tag that's somehow still in active use just fails
# to remove, harmlessly, instead of yanking a running container's image.
KEEP=5
REPO="${IMAGE_REF%:*}"
echo "==> Pruning old ${REPO} tags (keeping the ${KEEP} most recent)"
docker images "${REPO}" --format '{{.CreatedAt}}|{{.Tag}}' \
  | sort -r \
  | cut -d'|' -f2 \
  | grep -v '^<none>$' \
  | tail -n +$((KEEP + 1)) \
  | while read -r old_tag; do
      [ -n "${old_tag}" ] || continue
      echo "    removing ${REPO}:${old_tag}"
      docker rmi "${REPO}:${old_tag}" 2>/dev/null || true
    done

echo "==> Deploy complete: ${IMAGE_REF}"

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
# Runs ON THE VPS, invoked over SSH by .github/workflows/deploy.yml. Expected
# layout — this script lives in deploy/, one level BELOW the app root, which
# is where compose.yml, compose.prod.yml, .env and the bind mounts live (see
# deploy/README.md for first-time setup):
#
#   ~/apps/sieve/
#   ├── .env                 <- by hand, never shipped by CI
#   ├── compose.yml          ┐ re-shipped by CI on every deploy
#   ├── compose.prod.yml     ┘
#   ├── data/                <- the SQLite DB.  bind mount, uid 1001
#   ├── .fastembed_cache/    <- the 128 MB model. bind mount, uid 1001
#   └── deploy/              <- deploy.sh (this file), backup.sh, nginx/
#
# backup.sh resolves the app root the same way (dirname/..). They MUST agree:
# if this script computed a different root, it would bind-mount the database
# somewhere backup.sh never looks, and the nightly backup would quietly
# archive nothing at all.
#
# Usage — normal deploy (what CI runs automatically on every push to master):
#   bash deploy.sh ghcr.io/OWNER/sieve:sha-abc1234
#
# Usage — manual rollback (what a human runs; identical mechanism):
#   ssh contabo
#   bash ~/apps/sieve/deploy/deploy.sh ghcr.io/OWNER/sieve:sha-<previous-good-sha>
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
# an interactive shell in a different directory. The `/..` is load-bearing:
# this script sits in deploy/ but everything it touches (.env, the compose
# files, the bind mounts) lives one level up, and backup.sh resolves the app
# root the same way. See the layout diagram at the top.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Deploying ${IMAGE_REF} in ${APP_DIR}"

if [ ! -f .env ]; then
  echo "!! No .env found in ${APP_DIR}. Copy .env.example, fill in real values," >&2
  echo "!! and place it here as .env before running this script. See deploy/README.md." >&2
  exit 1
fi

if [ ! -f compose.yml ] || [ ! -f compose.prod.yml ]; then
  echo "!! compose.yml / compose.prod.yml missing from ${APP_DIR}." >&2
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
mkdir -p "${APP_DIR}/data" "${APP_DIR}/.fastembed_cache"
sudo chown -R 1001:1001 "${APP_DIR}/data" "${APP_DIR}/.fastembed_cache"

# Remember what is running BEFORE anything changes, so a failed deploy has
# somewhere to go back to. Empty on a first deploy — handled below.
PREVIOUS_IMAGE="$(docker inspect --format='{{.Config.Image}}' sieve 2>/dev/null || true)"
if [ -n "${PREVIOUS_IMAGE}" ]; then
  echo "==> Currently running: ${PREVIOUS_IMAGE}"
else
  echo "==> No sieve container running — treating this as the first deploy."
fi

# roll_to <image-ref> — bring the stack up on that image and wait for it to
# report healthy. Returns 0 if it does, 1 if it doesn't. Deliberately does
# NOT call this script recursively: a rollback is the same *function*, not a
# nested process, so a rollback that also fails stops instead of looping.
roll_to() {
  local ref="$1"
  local attempts=24   # 24 x 5s = 120s ceiling; HEALTHCHECK start_period alone is 30s
  local status="starting"
  local i

  echo "==> Rolling the container to ${ref}"
  SIEVE_IMAGE="${ref}" docker compose -f compose.yml -f compose.prod.yml up -d --remove-orphans

  echo "==> Waiting for the container to report healthy"
  for i in $(seq 1 "${attempts}"); do
    status="$(docker inspect --format='{{.State.Health.Status}}' sieve 2>/dev/null || echo "unknown")"
    if [ "${status}" = "healthy" ]; then
      echo "    healthy after ~$((i * 5))s"
      return 0
    fi
    echo "    [${i}/${attempts}] container health: ${status} — waiting..."
    sleep 5
  done

  echo "!! Did not become healthy within $((attempts * 5))s (last status: ${status})." >&2
  return 1
}

echo "==> Pulling ${IMAGE_REF}"
docker pull "${IMAGE_REF}"

if ! roll_to "${IMAGE_REF}"; then
  docker compose -f compose.yml -f compose.prod.yml ps
  echo "!! Last 50 log lines from the failed container:" >&2
  docker logs --tail 50 sieve 2>&1 | sed 's/^/!!   /' >&2

  # Automatic rollback. ADR 0009 originally recorded "no automatic rollback"
  # as a deliberate choice — but that reasoning assumed a human ran the
  # deploy and was watching it fail. Deploys are now ungated and automatic on
  # every push to master, so nobody is watching, and "stop and wait to be
  # noticed" means the site stays down until someone happens to look. See the
  # amendment in docs/adr/0009-no-iac-no-zero-downtime-deploys.md.
  if [ -z "${PREVIOUS_IMAGE}" ]; then
    echo "!! Nothing to roll back to — no container was running before this deploy." >&2
    echo "!! The site is NOT up. Investigate:  docker logs --since 10m sieve" >&2
    exit 1
  fi

  if [ "${PREVIOUS_IMAGE}" = "${IMAGE_REF}" ]; then
    echo "!! The previously-running image IS ${IMAGE_REF}. Rolling back would just" >&2
    echo "!! redeploy the same broken image, so this stops here rather than looping." >&2
    exit 1
  fi

  echo "!! Rolling back to ${PREVIOUS_IMAGE}" >&2
  if roll_to "${PREVIOUS_IMAGE}"; then
    echo "!! ROLLED BACK. The site is up on ${PREVIOUS_IMAGE}." >&2
    echo "!! ${IMAGE_REF} is broken and is NOT deployed — fix it and push again." >&2
  else
    echo "!! ROLLBACK ALSO FAILED. The site is DOWN. Investigate now:" >&2
    echo "!!   docker logs --since 10m sieve" >&2
  fi

  # Non-zero either way: a deploy that ended on anything but the requested
  # image must show red in Actions, even when the rollback saved the site.
  exit 1
fi

echo "==> docker compose ps"
docker compose -f compose.yml -f compose.prod.yml ps

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

# The list is collected FIRST, with `|| true`, rather than piped straight into
# the loop. Under `set -o pipefail`, `grep -v` returns 1 when its input is
# empty (nothing to prune) — which used to propagate through `set -e` and kill
# the script *after a completely successful deploy*, before it printed "Deploy
# complete", making it exit non-zero.
#
# That matters more than it looks: deploys are automatic and ungated now, so a
# green run is the only signal that the new image is actually live, and a
# rollback deliberately exits non-zero. A housekeeping step that can report a
# good deploy as failed trains you to ignore red exactly when red started
# meaning something. Pruning must never decide whether a deploy succeeded.
OLD_TAGS="$(docker images "${REPO}" --format '{{.CreatedAt}}|{{.Tag}}' \
  | sort -r \
  | cut -d'|' -f2 \
  | grep -v '^<none>$' \
  | tail -n +$((KEEP + 1)) || true)"

if [ -z "${OLD_TAGS}" ]; then
  echo "    nothing to prune"
else
  while read -r old_tag; do
    [ -n "${old_tag}" ] || continue
    echo "    removing ${REPO}:${old_tag}"
    docker rmi "${REPO}:${old_tag}" 2>/dev/null || true
  done <<< "${OLD_TAGS}"
fi

echo "==> Deploy complete: ${IMAGE_REF}"

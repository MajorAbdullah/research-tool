# syntax=docker/dockerfile:1
# =============================================================================
# Sieve — production image
# =============================================================================
# Multi-stage build for a single Next.js 16 `output: 'standalone'` service.
# See docs/adr/0007-single-container-in-process-worker.md — there is exactly
# ONE image and ONE service; the in-process worker ships inside it.
#
# Why the extra stages, not just "builder -> runner":
#   better-sqlite3, argon2, sqlite-vec, and fastembed's own onnxruntime-node
#   dependency all compile or ship real native `.node` / `.so` binaries.
#   next.config.ts lists these (plus onnxruntime-node directly) in
#   `serverExternalPackages` so webpack/turbopack never bundles them — they
#   stay real `require()`s against real files on disk at runtime. Next's
#   `output: standalone` copies only what its file-tracer (@vercel/nft)
#   can *statically* see, and native-binding loaders resolve their .node/.so
#   paths dynamically (via process.platform/process.arch), which is a
#   documented tracing blind spot. So: build the full, real `node_modules`
#   for the *production* dependency set in its own stage (`prod-deps`), and
#   layer those specific packages' real directories on top of the traced
#   standalone output (`assemble`) instead of trusting the trace alone for
#   them. Everything else in the app (all pure JS/TS) is still served by the
#   normal, minimal standalone trace, which is what keeps the final image
#   small.
#
# Base image: Debian slim (glibc), deliberately NOT Alpine. Confirmed by
# inspecting the resolved dependency tree: sqlite-vec and fastembed's
# tokenizer dependency both ship prebuilt binaries as `-linux-x64-gnu`
# platform packages with no musl counterpart. Alpine would force a from-
# source compile of packages that don't reliably support it (or fail
# outright), for zero benefit at this project's scale.
# =============================================================================

ARG NODE_IMAGE=node:24-slim

# -----------------------------------------------------------------------------
# base — pnpm via corepack, pinned to the version package.json declares
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
# Keep in sync with package.json's "packageManager" field.
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

# This image is linux/amd64 ONLY, on purpose — the assemble stage copies
# `sqlite-vec-linux-x64` by name, and onnxruntime's non-linux binaries are
# pruned by path. The VPS and the CI runners are both amd64, so nothing in
# the deploy path is affected.
#
# Fail here, in seconds, rather than 40 minutes later at a `COPY ... not
# found` for a package that was never going to be installed on this arch.
# Building on an Apple Silicon Mac needs `--platform=linux/amd64` (correct,
# but QEMU-emulated and very slow) — so on arm64 the right move is usually
# to let CI build it instead.
ARG TARGETARCH
RUN if [ -n "${TARGETARCH}" ] && [ "${TARGETARCH}" != "amd64" ]; then \
      echo "ERROR: this Dockerfile builds linux/amd64 only (got '${TARGETARCH}')." >&2; \
      echo "       Retry with:  docker build --platform=linux/amd64 ..." >&2; \
      echo "       On Apple Silicon that runs under emulation and is very slow;" >&2; \
      echo "       pushing to CI is usually faster. See deploy/README.md." >&2; \
      exit 1; \
    fi

# -----------------------------------------------------------------------------
# toolchain — the native build chain, isolated in its own layer so both
# install stages below (deps, prod-deps) can share it without duplicating
# the apt-get work.
# -----------------------------------------------------------------------------
FROM base AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# deps — full install (incl. devDependencies) needed to run `next build`,
# which also lints and typechecks (next.config.ts: ignoreDuringBuilds: false).
# -----------------------------------------------------------------------------
FROM toolchain AS deps
WORKDIR /app
COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# builder — the actual Next.js build. `output: 'standalone'` in
# next.config.ts produces .next/standalone (a self-contained server.js +
# traced node_modules) and .next/static (immutable hashed assets).
# -----------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholders so any module-level env validation (P1.2.6's Zod config
# loader) that happens to run during `next build`'s page-data collection
# doesn't fail the build on missing secrets. These values are NEVER copied
# into the runner stage below and are meaningless at runtime — real config
# comes from the container's actual environment (compose env_file), not
# from anything baked into the image.
ENV AUTH_SECRET=build-time-placeholder-unused-at-runtime \
    EXTENSION_TOKEN=build-time-placeholder-unused-at-runtime \
    OPENROUTER_API_KEY=build-time-placeholder-unused-at-runtime \
    SEED_USER_EMAIL=build@example.invalid \
    SEED_USER_PASSWORD=build-time-placeholder-unused-at-runtime
RUN pnpm build
# The browser extension ships INSIDE the image so Settings can serve it as a
# download. Without this, /api/v1/extension/download 404s in production — and
# that is precisely where it matters most, since on a VPS the machine you
# install the extension on is not the machine the source is on.
RUN pnpm build:ext

# -----------------------------------------------------------------------------
# prod-deps — a clean, production-only install. This is the source of truth
# for every native-binding package copied into the final image: real files,
# not a best-effort trace.
# -----------------------------------------------------------------------------
FROM toolchain AS prod-deps
WORKDIR /app
COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# -----------------------------------------------------------------------------
# assemble — standalone output, reinforced with the real native packages.
# -----------------------------------------------------------------------------
FROM base AS assemble
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Built extension, served by /api/v1/extension/download.
COPY --from=builder /app/extension/dist ./extension/dist

# Drop whatever the standalone trace happened to pick up for these specific
# packages, then replace with the complete real directories from prod-deps.
# native-binding packages named by the task, plus everything
# `serverExternalPackages` (next.config.ts) marks as un-bundled, plus
# fastembed's own dependency chain (it privately pins its own
# onnxruntime-node version, which is why both 1.29.0 and 1.21.0 exist side
# by side — see pnpm-lock.yaml).
RUN rm -rf \
      node_modules/better-sqlite3 \
      node_modules/argon2 \
      node_modules/onnxruntime-node \
      node_modules/sqlite-vec \
      node_modules/sqlite-vec-linux-x64 \
      node_modules/fastembed \
      node_modules/@anush008 \
      node_modules/@huggingface \
      node_modules/tar \
      node_modules/progress

COPY --from=prod-deps /app/node_modules/better-sqlite3       ./node_modules/better-sqlite3
COPY --from=prod-deps /app/node_modules/argon2                ./node_modules/argon2
COPY --from=prod-deps /app/node_modules/onnxruntime-node       ./node_modules/onnxruntime-node
COPY --from=prod-deps /app/node_modules/sqlite-vec             ./node_modules/sqlite-vec
COPY --from=prod-deps /app/node_modules/sqlite-vec-linux-x64   ./node_modules/sqlite-vec-linux-x64
COPY --from=prod-deps /app/node_modules/fastembed              ./node_modules/fastembed
COPY --from=prod-deps /app/node_modules/@anush008              ./node_modules/@anush008
COPY --from=prod-deps /app/node_modules/@huggingface           ./node_modules/@huggingface
COPY --from=prod-deps /app/node_modules/tar                    ./node_modules/tar
COPY --from=prod-deps /app/node_modules/progress               ./node_modules/progress

# onnxruntime-node bundles win32/darwin/linux binaries in one npm package.
# We deploy to linux/amd64 only — drop the other platforms' binaries to
# keep the image inside the < 350 MB target.
RUN find node_modules/onnxruntime-node/bin -mindepth 2 -maxdepth 2 -type d \
      \( -name darwin -o -name win32 \) -prune -exec rm -rf {} \; 2>/dev/null || true

# -----------------------------------------------------------------------------
# runner — final image. Slim base, non-root user, nothing but the built
# artifact + its runtime dependencies.
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3060 \
    HOSTNAME=0.0.0.0

# Fixed, documented uid/gid (referenced by deploy/backup.sh and
# deploy/README.md for bind-mount ownership) rather than "whatever the base
# image happens to allocate next".
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

COPY --from=assemble --chown=nextjs:nodejs /app ./

# ./data (SQLite + WAL/SHM) and ./.fastembed_cache (local embedding model
# cache) are bind-mounted by compose.yml — create them here too so a first
# `docker run` without compose (or a mount that races container start)
# still has a writable, correctly-owned directory instead of failing shut.
RUN mkdir -p /app/data /app/.fastembed_cache \
    && chown -R nextjs:nodejs /app/data /app/.fastembed_cache

USER nextjs

EXPOSE 3060

# GET /api/v1/health is intentionally unauthenticated (docs/API.md §3.11)
# specifically so Docker's HEALTHCHECK can call it directly. Only `db`
# drives the HTTP status (200 ok / 503 db down) — a spent LLM budget or a
# full disk is informational, not a restart-worthy condition, so checking
# the status code alone is the correct signal. No curl/wget in this image;
# Node itself makes the request to avoid installing anything extra.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT||3060,path:'/api/v1/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"]

CMD ["node", "server.js"]

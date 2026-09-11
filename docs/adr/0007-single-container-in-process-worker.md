# ADR 0007: Single container with an in-process worker

**Status:** Accepted · **Date:** 2026-09-12

## Context

The ingest pipeline (`resolve → extract → enrich → embed → relate → index`) is mostly I/O-bound:
HTTP fetches, OpenRouter calls, and DB writes. The one CPU-bound stage is local embedding
(ADR 0003). It runs via `onnxruntime-node`, which uses its own **native thread pool, off the JS
event loop** — so it does not block Next.js's request handling from inside the same process,
provided its thread usage is bounded.

The host has 6 vCPUs and already runs ~45 other containers (see ADR 0001). The plan caps
onnxruntime's intra-op threads at **2 of 6 vCPUs** specifically so embedding work cannot monopolize
the host, and caps worker concurrency at 2 job slots. Given the pipeline's I/O-bound shape and the
one CPU stage being boundable this way, a separate worker container is not required just to keep
the app responsive.

## Decision

- Run the Next.js app, its API routes, and the background job worker in **one container/process**.
  The worker loop starts from `instrumentation.ts`, polls the `jobs` table, and runs at
  **concurrency 2**.
- Cap onnxruntime's intra-op thread pool at **2 of 6 vCPUs** so the one CPU-bound stage can't starve
  the rest of the host or the app's own request handling.
- Ship **`WORKER_ENABLED=false`** as a documented, already-designed escape hatch: if the in-process
  worker is ever observed starving request handling, it can be switched off in this container and
  run as a second container instead, without a schema or contract change — the `jobs` table and job
  registry are already the interface between "the thing that enqueues" and "the thing that runs
  jobs," so splitting them later is a deploy change, not a redesign.

## Consequences

- One container to deploy, monitor, restart, and fit inside the 512 MB `mem_limit` — only one more
  container added to the ~45 already on the box, not two.
- Simpler operational model: one process to log, one health check
  (`/api/v1/health` reporting `db`/`queue`/`disk`/`llm_quota` together), one restart path, one
  `docker stats` line to watch.
- A bug or crash in worker code shares a fault domain with the web-serving process — mitigated by
  SIGTERM drain-in-flight-jobs handling and by every job stage being independently retryable and
  re-runnable from the UI, not by process isolation.
- Ingest concurrency has a hard ceiling of 2 job-workers and 2 embedding threads inside one process;
  a much larger ingest burst needs the escape hatch below, not a config bump.

## What would reverse this

- The **200-item burst load test (P14.2)** shows the container approaching or exceeding the 512 MB
  `mem_limit`, or shows host load average climbing enough to put the other ~45 containers at risk —
  this is the documented trigger for flipping `WORKER_ENABLED=false` and running the worker as its
  own container.
- Local embedding, or a future CPU-bound stage, measurably delays foreground request handling (e.g.,
  API p95 latency regressing during active ingest) despite the native-thread-pool/2-vCPU cap.
- Ingest volume grows enough that concurrency 2 — not the ~900 items/day OpenRouter ceiling from
  ADR 0004 — becomes the binding constraint, implying a pipeline shape this design didn't anticipate.

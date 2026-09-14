# Deploying Sieve

Sieve runs as **one Docker container** behind the Contabo box's existing nginx, at
<https://sieve.teknikki.com>. Every push to `master` builds an image, pushes it to GHCR, and rolls
the container — no manual step, no gate.

This file is the first-time setup. Day-to-day, you `git push` and read Actions.

> **The box is shared.** ~45 other containers and 20+ other vhosts live here (ERPNext, BillionMail,
> …). Nothing in this directory may touch anything that isn't unambiguously Sieve's — which is why
> `deploy.sh` prunes images *by repository name* and never runs a host-wide `docker image prune`.

---

## Layout on the VPS

`deploy.sh` and `backup.sh` both resolve the app root as **their own directory's parent**. They
have to agree: if they didn't, one would bind-mount the database somewhere the other never looks,
and the nightly backup would archive nothing while exiting 0. Keep this shape.

```
~/apps/sieve/
├── .env                 ← by hand. Never in git, never shipped by CI.
├── compose.yml          ┐ overwritten by CI on every deploy —
├── compose.prod.yml     ┘ edit them in the repo, not here.
├── data/                ← the SQLite DB. bind mount, must be owned by uid 1001
├── .fastembed_cache/    ← the 128 MB embedding model. bind mount, uid 1001
├── backup.log           ← cron output
└── deploy/              ← deploy.sh, backup.sh, RESTORE.md, nginx/  (also overwritten by CI)
```

Everything except `.env`, `data/` and `.fastembed_cache/` is disposable — CI reships it each run,
so the box always matches the commit that deployed.

---

## First-time setup

### 1. DNS — do this first, everything else waits on it

Add an **A record** for `sieve` → `45.85.147.52` in the `teknikki.com` zone (nameservers are
`ns1`/`ns2.dyna-ns.net`). Confirm before continuing:

```bash
dig +short sieve.teknikki.com     # must print 45.85.147.52
```

Certbot's HTTP-01 challenge needs the name to resolve to this box, and **HTTPS is not optional
here**: service workers, the install prompt, and Web Share Target all refuse to work without it.
No DNS → no certificate → no installable app.

### 2. Directories and ownership

The container runs as uid:gid **1001:1001** (the `nextjs` user in the Dockerfile). Docker creates a
missing bind-mount source as **root**, which a non-root container then can't write to — so create
these yourself, with the right owner, before anything starts:

```bash
mkdir -p ~/apps/sieve/{data,.fastembed_cache}
sudo chown -R 1001:1001 ~/apps/sieve/data ~/apps/sieve/.fastembed_cache
sudo apt-get install -y sqlite3     # backup.sh exits early without it
```

`deploy.sh` re-runs the `mkdir`/`chown` on every deploy, so this is belt-and-braces — but the
`sqlite3` install is not, and a backup script that can't run is not a backup.

### 3. `~/apps/sieve/.env`

Same variables as `.env.example`, with these differences. **Generate fresh production secrets** —
don't paste your laptop's:

| Variable | Production value |
|---|---|
| `APP_URL` | `https://sieve.teknikki.com` — used to build absolute links; wrong value breaks OAuth callbacks and the extension's target |
| `NODE_ENV` | `production` |
| `AUTH_SECRET` | **new** — `openssl rand -hex 32` |
| `EXTENSION_TOKEN` | **new** — `openssl rand -hex 32`. Re-pair the browser extension against this one |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | your real login. Seeds on first boot |
| `OPENROUTER_API_KEY` | same key is fine — the free-tier budget is per-account, so laptop and VPS share one 1,000/day pool |
| `GITHUB_PAT` | recommended: lifts GitHub's API limit from 60 → 5,000 req/hr |
| `SQLITE_PATH` | leave as the compose default — it points inside the container, not at the host path |

`chmod 600 ~/apps/sieve/.env`. CI never reads, writes, or ships this file.

### 4. nginx + TLS

The vhost is committed at `deploy/nginx/sieve.teknikki.com.conf` — it matches the per-subdomain
pattern already on the box, and carries two things that are load-bearing rather than decorative:
`client_max_body_size 50M` (WhatsApp export uploads) and `proxy_buffering off` on `/api/v1/chat`
(without it, nginx buffers the SSE stream and chat answers arrive in one lump at the end instead of
token by token).

```bash
sudo cp ~/apps/sieve/deploy/nginx/sieve.teknikki.com.conf /etc/nginx/sites-available/
sudo ln -s ../sites-available/sieve.teknikki.com.conf /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/certbot -d sieve.teknikki.com
sudo nginx -t && sudo systemctl reload nginx
```

**`nginx -t` before every reload.** A syntax error takes down all 20+ sites on this box, not just
Sieve.

### 5. GitHub secrets and the GHCR package

Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `VPS_HOST` | `45.85.147.52` |
| `VPS_USER` | `teknikki` |
| `VPS_SSH_KEY` | private half of a **new, deploy-only** keypair — not your personal key |

```bash
ssh-keygen -t ed25519 -C "github-actions-sieve" -f ~/.ssh/sieve_deploy -N ""
# public half onto the VPS:
ssh-copy-id -i ~/.ssh/sieve_deploy.pub teknikki@45.85.147.52
# private half into VPS_SSH_KEY (whole file, including BEGIN/END lines):
cat ~/.ssh/sieve_deploy
```

`deploy.sh` runs `sudo chown`, so this user needs passwordless sudo. It has it.

Then make the package **public**: GitHub → your profile → Packages → `research-tool` → Package
settings → Change visibility → Public. The VPS then pulls with no credentials and never needs
`docker login`. The image contains no secrets — all config comes from the container's environment —
so this is a code-visibility choice, not a security one.

> **The GHCR trap, which costs people hours:** a **fine-grained** PAT cannot push packages, and
> fails in a way that looks like an auth typo. `deploy.yml` sidesteps it entirely by using the
> automatic `GITHUB_TOKEN` with `packages: write`. If you ever push by hand, use a **classic** PAT
> with `write:packages`.

### 6. Nightly backups

```bash
crontab -e
```
```cron
0 3 * * * /home/teknikki/apps/sieve/deploy/backup.sh >> /home/teknikki/apps/sieve/backup.log 2>&1
```

`VACUUM INTO` a timestamped copy in `~/backups/sieve`, 14-day retention, safe while the app is
running. Then **actually verify it**, because the failure mode is silent:

```bash
bash ~/apps/sieve/deploy/backup.sh
ls -lh ~/backups/sieve/                                    # non-zero size?
sqlite3 ~/backups/sieve/sieve-$(date -u +%F).db 'select count(*) from items;'
```

A backup you have never restored is not a backup — walk `RESTORE.md` once, now, while nothing is
on fire.

### 7. Warm the embedding model

The local embedder downloads **~128 MB on first use**. Cold, your first captured link sits in a
job for ~8 minutes looking exactly like a hang.

Don't try to run `pnpm warm:model` in the container — it goes through `tsx`, which is a dev
dependency and is deliberately not in the production image. **Copy your laptop's warmed cache
instead.** It's 7 files of ONNX weights and tokenizer JSON, all architecture-independent, so an
arm64 Mac's cache works verbatim on the x86 VPS:

```bash
# from the repo on your laptop, after `make model-warm` has run at least once
scp -r .fastembed_cache/fast-bge-small-en-v1.5 \
    teknikki@45.85.147.52:~/apps/sieve/.fastembed_cache/
ssh contabo 'sudo chown -R 1001:1001 ~/apps/sieve/.fastembed_cache && du -sh ~/apps/sieve/.fastembed_cache'
# expect ~128M
```

The bind mount keeps it across every future deploy. If you'd rather not copy, capturing one link
through the UI and waiting it out once has the same end state — the download is a one-time cost
either way, just an opaque one.

---

## Deploying

```bash
git push origin master
```

`.github/workflows/deploy.yml` builds, pushes `sha-<short>` and `latest` to GHCR, reships the
compose files and `deploy/`, then runs `deploy.sh` over SSH. Watch it in Actions.

`ci.yml` (lint, typecheck, tests, gitleaks) runs on the same push and **reports without blocking** —
a red CI run does not stop the deploy. That's a deliberate choice; the safety net is the rollback
below, not the gate.

### Rollback

**Automatic.** `deploy.sh` records the running image before pulling. If the new container doesn't
report healthy within 120 s, it brings the previous image back and exits non-zero — so a bad push
self-reverts in about two minutes instead of leaving the site down. It does not recurse: a rollback
that also fails stops and says so.

A **red** Actions run therefore means one of:

| Message | What happened |
|---|---|
| `ROLLED BACK. The site is up on …` | Site fine, your commit isn't deployed. Fix and push again |
| `ROLLBACK ALSO FAILED. The site is DOWN.` | Investigate now: `docker logs --since 10m sieve` |
| `Nothing to roll back to` | First deploy failed; nothing was running before |

**By hand**, to any tag (identical mechanism, which is what keeps it tested):

```bash
ssh contabo
bash ~/apps/sieve/deploy/deploy.sh ghcr.io/majorabdullah/research-tool:sha-<previous-good-sha>
```

`deploy.sh` keeps the 5 most recent tags on disk, so recent rollbacks don't even need a pull.

---

## Everyday commands

```bash
curl https://sieve.teknikki.com/api/v1/health          # status, DB, remaining LLM quota
ssh contabo 'cd ~/apps/sieve && docker compose -f compose.yml -f compose.prod.yml logs -f'
ssh contabo 'docker stats --no-stream sieve'           # must stay under the 1g cap
ssh contabo 'bash ~/apps/sieve/deploy/backup.sh'       # back up right now
```

---

## When something is wrong

**Container won't start / restarts in a loop.** `docker logs --since 10m sieve`. Most likely a
missing or malformed `.env` — the app validates its environment at boot and exits rather than
running half-configured.

**`memswap_limit` errors on `compose up`.** `memswap_limit` is *total* memory + swap, not a
separate swap allowance, and must be **≥** `mem_limit`. Equal means zero additional swap, which is
what we want on a box that's already short on it. Lower is rejected outright.

**Permission denied writing the database.** `data/` isn't owned by 1001 — Docker created it as
root. `sudo chown -R 1001:1001 ~/apps/sieve/data`.

**Chat answers arrive all at once instead of streaming.** nginx is buffering the SSE stream. Check
`proxy_buffering off` survived in the `/api/v1/chat` location block.

**Phone won't offer "Install app".** Needs all of: valid HTTPS, a reachable
`/manifest.webmanifest`, and a registered service worker. In Chrome on Android, DevTools →
Application → Manifest states which one is missing.

**Summaries stop appearing; capture and search still work.** The day's free-tier LLM budget is
spent. `/api/v1/health` shows `llm_quota`. By design — items are still captured, extracted,
embedded and indexed; only summaries wait for the UTC-midnight reset. Nothing is lost.

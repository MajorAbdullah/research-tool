import { AlertTriangle, Check, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { getSqlite } from '@/db/client'
import { loadAiConfig } from '@/lib/ai'
import { requireSessionUserIdOrRedirect } from '@/services/auth-context'

import { ConnectDevices } from './connect-devices'

export const metadata = { title: 'Settings · Sieve' }
export const dynamic = 'force-dynamic'

/**
 * Read-only by design.
 *
 * Every knob here lives in `.env` and is read at boot — the model chains, the daily cap, the
 * embedding provider. Editing them from a web form would mean a second source of truth that
 * silently disagrees with the file, and CLAUDE.md's non-negotiables require model chains to
 * come from env precisely so a change is visible in version control. So this page tells you
 * what the running process actually resolved, and where to change it.
 */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${ok ? 'text-foreground' : 'text-warning'}`}>
      {ok ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      {ok ? yes : no}
    </span>
  )
}

function mask(value: string | undefined): string {
  if (!value) return 'not set'
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 6)}••••${value.slice(-4)}`
}

export default async function SettingsPage() {
  await requireSessionUserIdOrRedirect()

  const db = getSqlite()
  const one = <T,>(sql: string): T => db.prepare(sql).get() as T
  const all = <T,>(sql: string): T[] => db.prepare(sql).all() as T[]
  const ai = loadAiConfig()

  const totalItems = one<{ c: number }>('select count(*) c from items').c
  const byKind = all<{ kind: string; c: number }>(
    'select kind, count(*) c from items group by kind order by c desc',
  )
  const byTier = all<{ extraction_tier: string; c: number }>(
    'select extraction_tier, count(*) c from items group by extraction_tier order by c desc',
  )
  const topics = all<{ label: string; c: number }>(
    `select t.label, count(*) c from item_topics it
       join topics t on t.id = it.topic_id group by t.label order by c desc`,
  )
  const chunks = one<{ c: number }>('select count(*) c from chunks').c
  const relations = one<{ c: number }>('select count(*) c from relations').c
  const tags = one<{ c: number }>('select count(*) c from tags').c
  const callsByModel = all<{ model_resolved: string; prompt_version: string; c: number }>(
    `select model_resolved, prompt_version, count(*) c from llm_calls
       group by model_resolved, prompt_version order by c desc`,
  )
  const usedToday = one<{ v: string | null }>(
    "select value v from settings where key = 'llm_requests_used_today'",
  )?.v
  const used = Number(usedToday ?? 0)
  const background = ai.dailyCap - ai.interactiveReserve
  const hasPat = Boolean(process.env.GITHUB_PAT)
  const degraded = byTier.filter((t) => t.extraction_tier !== 'full').reduce((n, t) => n + t.c, 0)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Read-only. Every value here comes from <code className="text-xs">.env</code> and is read at
        boot — change it there and restart.
      </p>

      <div className="mt-6 grid gap-4">
        <ConnectDevices
          appUrl={process.env.APP_URL ?? 'http://localhost:3060'}
          hasToken={Boolean(process.env.EXTENSION_TOKEN)}
        />

        <Section
          title="Daily AI budget"
          hint="OpenRouter's free tier is 1,000 requests/day, account-wide across every :free model. Ingest draws from the background share only, so it can never starve your own chat queries."
        >
          <Row label="Used today" value={`${used} of ${ai.dailyCap}`} />
          <Row label="Background (ingest)" value={`${Math.max(0, background - used)} left`} />
          <Row label="Reserved for chat" value={ai.interactiveReserve} />
          {used >= background ? (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                The ingest budget is spent. Capture, extraction, embedding and search all keep
                working — only summaries wait for the reset. Nothing is lost.
              </span>
            </p>
          ) : null}
        </Section>

        <Section title="Library">
          <Row label="Items" value={totalItems} />
          <Row
            label="By kind"
            value={
              byKind.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {byKind.map((k) => (
                    <Badge key={k.kind} variant="outline">
                      {k.kind} {k.c}
                    </Badge>
                  ))}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Row
            label="Topics"
            value={
              topics.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {topics.map((t) => (
                    <Badge key={t.label} variant="secondary">
                      {t.label} {t.c}
                    </Badge>
                  ))}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Row label="Tags" value={tags} />
          <Row label="Search chunks" value={chunks} />
          <Row label="Relations" value={relations} />
          <Row
            label="Incomplete extraction"
            value={
              degraded === 0 ? (
                'none'
              ) : (
                <span className="text-warning">
                  {degraded} item{degraded === 1 ? '' : 's'} — open with the extension and
                  re-extract
                </span>
              )
            }
          />
        </Section>

        <Section
          title="Models"
          hint="Tried in order; the next one is used on a 429 or a deprecation. Only 6 of the 22 free models enforce a JSON schema, which is why enrichment and chat use different chains."
        >
          <Row
            label="Embedding"
            value={`${process.env.EMBEDDING_PROVIDER ?? 'local'} · 384 dims`}
          />
          <div className="mt-2">
            <p className="text-xs font-medium text-muted-foreground">Enrichment chain</p>
            <ol className="mt-1 space-y-1">
              {ai.chainEnrich.map((m, i) => (
                <li key={m} className="truncate font-mono text-xs text-foreground">
                  {i + 1}. {m}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">Chat chain</p>
            <ol className="mt-1 space-y-1">
              {ai.chainChat.map((m, i) => (
                <li key={m} className="truncate font-mono text-xs text-foreground">
                  {i + 1}. {m}
                </li>
              ))}
            </ol>
          </div>
        </Section>

        {callsByModel.length ? (
          <Section
            title="Which model actually answered"
            hint="Logged per call. A :free alias can be repointed by the provider without notice, so the resolved model is recorded next to the prompt version — a change here explains a quality shift that would otherwise look like a mystery."
          >
            {callsByModel.map((c) => (
              <Row
                key={`${c.model_resolved}:${c.prompt_version}`}
                label={c.model_resolved}
                value={`${c.prompt_version} · ${c.c} call${c.c === 1 ? '' : 's'}`}
              />
            ))}
          </Section>
        ) : null}

        <Section title="Configuration">
          <Row
            label="OPENROUTER_API_KEY"
            value={
              <YesNo
                ok={Boolean(process.env.OPENROUTER_API_KEY)}
                yes="configured"
                no="missing — enrichment will fail"
              />
            }
          />
          <Row
            label="GITHUB_PAT"
            value={<YesNo ok={hasPat} yes="configured · 5,000 req/hr" no="not set · 60 req/hr" />}
          />
          <Row
            label="EXTENSION_TOKEN"
            value={<code className="text-xs">{mask(process.env.EXTENSION_TOKEN)}</code>}
          />
          {!hasPat ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Without a GitHub token, repo enrichment stalls after roughly 60 repos in an hour. Add{' '}
              <code className="text-xs">GITHUB_PAT</code> to <code className="text-xs">.env</code>{' '}
              and restart.
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  )
}

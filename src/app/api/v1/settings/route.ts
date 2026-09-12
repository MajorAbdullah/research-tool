/**
 * `GET /api/v1/settings` — library stats plus the effective, non-secret configuration.
 *
 * Deliberately returns NO secrets. The OpenRouter key, auth secret and GitHub PAT are reported
 * only as `configured: true/false`, because the page's job is answering "is this set up
 * correctly", which never requires echoing a value. The extension token is the one exception
 * and comes back masked, since pairing the extension is a real task and the user needs to
 * recognise which token they're looking at.
 *
 * Reuses P8's shared error envelope and session helper rather than re-deriving either.
 */
import { NextResponse } from 'next/server'

import { getSqlite } from '@/db/client'
import { loadAiConfig } from '@/lib/ai'
import { requireSessionUserId } from '@/services/auth-context'
import { errorResponse, generateRequestId } from '@/services/http'

function mask(value: string | undefined): string | null {
  if (!value) return null
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 6)}••••${value.slice(-4)}`
}

export async function GET() {
  const requestId = generateRequestId()
  try {
    await requireSessionUserId()

    const db = getSqlite()
    const one = <T>(sql: string): T => db.prepare(sql).get() as T
    const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[]
    const ai = loadAiConfig()

    return NextResponse.json({
      library: {
        total_items: one<{ c: number }>('select count(*) c from items').c,
        by_kind: all<{ kind: string; c: number }>(
          'select kind, count(*) c from items group by kind order by c desc',
        ),
        by_status: all<{ status: string; c: number }>(
          'select status, count(*) c from items group by status order by c desc',
        ),
        by_extraction_tier: all<{ extraction_tier: string; c: number }>(
          'select extraction_tier, count(*) c from items group by extraction_tier order by c desc',
        ),
        topics: all<{ label: string; c: number }>(
          `select t.label, count(*) c from item_topics it
             join topics t on t.id = it.topic_id group by t.label order by c desc`,
        ),
        tag_count: one<{ c: number }>('select count(*) c from tags').c,
        chunk_count: one<{ c: number }>('select count(*) c from chunks').c,
        relation_count: one<{ c: number }>('select count(*) c from relations').c,
      },
      ai: {
        chain_enrich: ai.chainEnrich,
        chain_chat: ai.chainChat,
        daily_cap: ai.dailyCap,
        interactive_reserve: ai.interactiveReserve,
        embedding_provider: process.env.EMBEDDING_PROVIDER ?? 'local',
        // model_resolved is recorded per call so a silent provider-side swap of a `:free`
        // alias shows up here instead of looking like a mystery regression.
        calls_by_model: all<{ model_resolved: string; prompt_version: string; c: number }>(
          `select model_resolved, prompt_version, count(*) c from llm_calls
             group by model_resolved, prompt_version order by c desc`,
        ),
      },
      configured: {
        openrouter_api_key: Boolean(process.env.OPENROUTER_API_KEY),
        // Absent only drops the GitHub API from 5,000 to 60 req/hr — a degradation, not a failure.
        github_pat: Boolean(process.env.GITHUB_PAT),
        auth_secret: Boolean(process.env.AUTH_SECRET),
        extension_token_masked: mask(process.env.EXTENSION_TOKEN),
      },
    })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

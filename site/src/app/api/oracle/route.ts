/**
 * Optional narration of a deterministic Oracle result. Off unless ANTHROPIC_API_KEY is set; the
 * Oracle is complete without it. The model only ever sees the facts the browser already computed,
 * and the UI labels its words as generated.
 */
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 220
const MAX_BODY = 6_000

// Per-instance limits. Serverless instances each keep their own window, which only makes them stricter.
const PER_MINUTE = 4
const PER_DAY = 40
const GLOBAL_PER_DAY = 600
const hits = new Map<string, number[]>()
let global: { day: number; count: number } = { day: 0, count: 0 }

function limited(ip: string): boolean {
  const now = Date.now()
  const day = Math.floor(now / 86_400_000)
  if (global.day !== day) global = { day, count: 0 }
  if (global.count >= GLOBAL_PER_DAY) return true
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 86_400_000)
  const lastMinute = list.filter((t) => now - t < 60_000).length
  if (lastMinute >= PER_MINUTE || list.length >= PER_DAY) return true
  list.push(now)
  hits.set(ip, list)
  global.count++
  if (hits.size > 10_000) hits.clear()
  return false
}

export function GET() {
  const enabled = Boolean(process.env.ANTHROPIC_API_KEY)
  return Response.json(enabled ? { enabled, model: MODEL } : { enabled })
}

interface Facts {
  intent: string
  detected: string[]
  agents: string[]
  loadout: {
    id: string
    name: string
    summary: string
    level: string
    uplift: string
    delta: number | null
    ci95: number[] | null
    matched: string[]
  }[]
}

function parseFacts(raw: unknown): Facts | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Partial<Facts>
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
  const strs = (v: unknown, n: number) =>
    Array.isArray(v) ? v.slice(0, n).map((x) => str(x, 60)) : []
  if (typeof f.intent !== 'string' || !Array.isArray(f.loadout) || f.loadout.length === 0)
    return null
  return {
    intent: str(f.intent, 400),
    detected: strs(f.detected, 12),
    agents: strs(f.agents, 6),
    loadout: f.loadout.slice(0, 6).map((c) => ({
      id: str(c?.id, 80),
      name: str(c?.name, 80),
      summary: str(c?.summary, 200),
      level: str(c?.level, 20),
      uplift: str(c?.uplift, 20),
      delta: typeof c?.delta === 'number' ? Math.round(c.delta) : null,
      ci95: Array.isArray(c?.ci95) ? c.ci95.slice(0, 2).map((x) => Math.round(Number(x))) : null,
      matched: strs(c?.matched, 4),
    })),
  }
}

const SYSTEM = `You narrate a result that a deterministic search engine already computed for a developer.
Write two or three plain sentences, under 70 words, no lists, no markdown.
Say which capability covers which part of their task. Use only the facts given.
Never invent or round numbers; quote uplift only as given (percentage points with the 95% interval).
If a capability is untested or inconclusive, say so plainly. Do not recommend anything not listed.`

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return new Response('narration is off', { status: 503 })
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  if (limited(ip)) return new Response('rate limited', { status: 429 })
  const text = await req.text()
  if (text.length > MAX_BODY) return new Response('too large', { status: 413 })
  let facts: Facts | null = null
  try {
    facts = parseFacts(JSON.parse(text))
  } catch {
    facts = null
  }
  if (!facts) return new Response('bad request', { status: 400 })

  const client = new Anthropic()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Facts (JSON):\n${JSON.stringify(facts)}` }],
  })
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        const final = await stream.finalMessage()
        if (final.stop_reason === 'refusal')
          controller.enqueue(encoder.encode(' [narration declined]'))
      } catch {
        controller.enqueue(encoder.encode(' [narration unavailable]'))
      } finally {
        controller.close()
      }
    },
    cancel() {
      stream.abort()
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

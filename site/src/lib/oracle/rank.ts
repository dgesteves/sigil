/**
 * The Oracle's search and weighing. Deterministic and inspectable: every score is
 * relevance x evidence, and both parts carry the reasons that produced them.
 */
import type { AgentId } from '@core/ids'
import { AGENT_LABEL, type CapView, humanize, TYPE_LABEL } from '@/lib/model'
import { type Signals, stem, type Tech, tokenize } from './intent'

export interface Ranked {
  cap: CapView
  relevance: number
  evidence: number
  score: number
  why: string[]
  weigh: string[]
  excluded?: string
}

interface Doc {
  cap: CapView
  tf: Map<string, number>
  len: number
}

export interface Index {
  docs: Doc[]
  df: Map<string, number>
  avg: number
}

const FIELD_WEIGHT = { name: 3, techs: 2.5, id: 2, summary: 2, facets: 1.5, text: 1 }

export function buildIndex(caps: readonly CapView[]): Index {
  const df = new Map<string, number>()
  const docs = caps.map((cap) => {
    const tf = new Map<string, number>()
    const add = (text: string, w: number) => {
      for (const t of tokenize(text)) {
        const s = stem(t)
        tf.set(s, (tf.get(s) ?? 0) + w)
      }
    }
    add(cap.name, FIELD_WEIGHT.name)
    add(cap.technologies.join(' '), FIELD_WEIGHT.techs)
    add(cap.id.replace(/[/-]/g, ' '), FIELD_WEIGHT.id)
    add(cap.summary, FIELD_WEIGHT.summary)
    add(
      [...cap.domains, ...cap.industries, ...cap.lifecycle, TYPE_LABEL[cap.type]]
        .join(' ')
        .replace(/-/g, ' '),
      FIELD_WEIGHT.facets,
    )
    add(cap.text, FIELD_WEIGHT.text)
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    const len = [...tf.values()].reduce((a, b) => a + b, 0)
    return { cap, tf, len }
  })
  const avg = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length)
  return { docs, df, avg }
}

function bm25(doc: Doc, terms: readonly string[], index: Index): number {
  const k1 = 1.2
  const b = 0.75
  const N = index.docs.length
  let score = 0
  for (const t of new Set(terms)) {
    const f = doc.tf.get(t)
    if (!f) continue
    const n = index.df.get(t) ?? 0
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * doc.len) / index.avg))
  }
  return score
}

export interface SearchResult {
  hits: Ranked[]
  considered: number
}

export const RELEVANCE_FLOOR = 1.2

/** Step 2: relevance only. Technologies, facets and full text; evidence plays no part yet. */
export function search(index: Index, s: Signals, techs: Map<string, Tech>): SearchResult {
  const hits: Ranked[] = []
  for (const doc of index.docs) {
    const cap = doc.cap
    const why: string[] = []
    let relevance = 0
    for (const t of cap.technologies) {
      const direct = s.techs.get(t)
      if (direct) {
        relevance += 3 * direct.weight
        why.push(techs.get(t)?.name ?? t)
        continue
      }
      // A capability for the parent covers the child (a React skill for a Next.js app), and the
      // other way round slightly less.
      for (const [id, sig] of s.techs) {
        if (techs.get(id)?.parent === t) {
          relevance += 1.6 * sig.weight
          why.push(`${techs.get(t)?.name ?? t} (via ${techs.get(id)?.name ?? id})`)
          break
        }
        if (techs.get(t)?.parent === id) {
          relevance += 1.1 * sig.weight
          why.push(`${techs.get(t)?.name ?? t} (builds on ${techs.get(id)?.name ?? id})`)
          break
        }
      }
    }
    for (const d of cap.domains) {
      const w = s.domains.get(d)
      if (w) {
        relevance += 1.2 * w
        why.push(humanize(d).toLowerCase())
      }
    }
    for (const i of cap.industries) {
      const w = s.industries.get(i)
      if (w) {
        relevance += 1.6 * w
        why.push(humanize(i).toLowerCase())
      }
    }
    for (const l of cap.lifecycle) {
      const w = s.lifecycle.get(l)
      if (w) {
        relevance += 0.6 * w
        why.push(`${l} stage`)
      }
    }
    const tw = s.types.get(cap.type)
    if (tw) {
      relevance += 0.9 * tw
      why.push(TYPE_LABEL[cap.type].toLowerCase())
    }
    const text = bm25(doc, s.terms, index)
    if (text > 0) relevance += Math.min(4, text * 0.55)
    if (relevance >= RELEVANCE_FLOOR)
      hits.push({
        cap,
        relevance,
        evidence: 1,
        score: relevance,
        why: [...new Set(why)],
        weigh: [],
      })
  }
  return { hits, considered: index.docs.length }
}

export interface WeighResult {
  ranked: Ranked[]
  excluded: Ranked[]
}

/** Step 3: evidence. Multipliers for trust and measured uplift; exclusions are never silent. */
export function weigh(hits: readonly Ranked[], agents: readonly AgentId[]): WeighResult {
  const out = hits.map((h): Ranked => {
    const cap = h.cap
    const weigh: string[] = []
    let evidence = 1
    let excluded: string | undefined
    if (cap.level === 'revoked') excluded = 'verification revoked'
    else if (cap.uplift === 'harmful') excluded = 'measured harmful'
    else if (cap.canary === 'fail') excluded = 'canary sandbox tripped'
    else if (cap.security === 'fail') excluded = 'security scan failed'
    if (cap.level === 'verified') {
      evidence *= 1.3
      weigh.push('verified ×1.3')
    } else if (cap.level === 'submitted') {
      evidence *= 0.75
      weigh.push('not yet validated ×0.75')
    }
    if (cap.uplift === 'proven') {
      const lo = Math.max(0, Math.min(0.5, cap.lead?.ci95[0] ?? 0))
      evidence *= 1.4 + lo
      weigh.push(`proven ×${(1.4 + lo).toFixed(2)}`)
    } else if (cap.uplift === 'no-effect') {
      evidence *= 0.55
      weigh.push('no measurable effect ×0.55')
    } else if (cap.uplift === 'untested') {
      evidence *= 0.85
      weigh.push('untested ×0.85')
    }
    if (cap.canary === 'pass') {
      evidence *= 1.05
      weigh.push('canary passed ×1.05')
    }
    const missing = agents.filter((a) =>
      cap.compiled.length ? !cap.compiled.includes(a) : !cap.targets.includes(a) && a !== 'generic',
    )
    if (missing.length) {
      evidence *= 0.85
      weigh.push(`not compiled for ${missing.map((a) => AGENT_LABEL[a]).join(', ')} ×0.85`)
    }
    return {
      ...h,
      evidence,
      score: h.relevance * evidence,
      weigh,
      ...(excluded ? { excluded } : {}),
    }
  })
  out.sort((a, b) => b.score - a.score || a.cap.id.localeCompare(b.cap.id))
  return { ranked: out.filter((r) => !r.excluded), excluded: out.filter((r) => r.excluded) }
}

/** A loadout is the few that matter: top scores, one per type and technology, nothing marginal. */
export function compose(ranked: Ranked[], max = 5): Ranked[] {
  const top = ranked[0]?.score ?? 0
  const chosen: Ranked[] = []
  const seen = new Set<string>()
  for (const r of ranked) {
    if (chosen.length >= max) break
    if (r.score < top * 0.2) break
    const key = `${r.cap.type}:${r.cap.technologies[0] ?? r.cap.domains[0]}`
    if (seen.has(key) && r.score < top * 0.8) continue
    seen.add(key)
    chosen.push(r)
  }
  return chosen
}

export function installLine(ids: readonly string[], agents: readonly AgentId[]): string {
  return `npx sigil add ${ids.join(' ')} --agent ${agents.join(',')}`
}

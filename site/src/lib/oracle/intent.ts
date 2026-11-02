import type { CapabilityType, Domain, Industry, LifecycleStage } from '@core/ids'
import {
  AMBIGUOUS,
  DOMAIN_WORDS,
  INDUSTRY_WORDS,
  LIFECYCLE_WORDS,
  STOPWORDS,
  TECH_ALIASES,
  TECH_CONTEXT,
  TYPE_WORDS,
} from './vocab'

export interface Tech {
  id: string
  name: string
  kind: string
  parent?: string
  detect?: Record<string, string[] | undefined>
}

export interface Signal {
  weight: number
  /** Why we believe it: "package.json → next", "you wrote “postgres”". */
  source: string
}

export interface Signals {
  techs: Map<string, Signal>
  domains: Map<Domain, number>
  industries: Map<Industry, number>
  lifecycle: Map<LifecycleStage, number>
  types: Map<CapabilityType, number>
  /** Content words for full-text ranking. */
  terms: string[]
}

export function emptySignals(): Signals {
  return {
    techs: new Map(),
    domains: new Map(),
    industries: new Map(),
    lifecycle: new Map(),
    types: new Map(),
    terms: [],
  }
}

const GITHUB =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = GITHUB.exec(input.trim())
  if (!m) return null
  return { owner: m[1]!, repo: m[2]! }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[“”"'`]/g, ' ')
    .split(/[^a-z0-9+#./-]+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ''))
    .filter(Boolean)
}

export function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3)
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`
  if (t.length > 4 && t.endsWith('es') && /(ss|sh|ch|x)es$/.test(t)) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  if (t.length > 5 && t.endsWith('ed')) return t.slice(0, -2)
  return t
}

function addMax<K>(m: Map<K, number>, k: K, w: number) {
  m.set(k, Math.max(m.get(k) ?? 0, w))
}

export function addTech(s: Signals, techs: Map<string, Tech>, id: string, signal: Signal) {
  const prev = s.techs.get(id)
  if (!prev || prev.weight < signal.weight) s.techs.set(id, signal)
  // A framework implies its parent (nextjs → react), at lower confidence.
  const parent = techs.get(id)?.parent
  if (parent && !s.techs.has(parent)) {
    s.techs.set(parent, {
      weight: signal.weight * 0.7,
      source: `implied by ${techs.get(id)?.name ?? id}`,
    })
  }
}

/** "React app", "a Go service", "REST": yes. "react to", "next week", "let's go": no. */
export function meantAsTech(text: string, word: string): boolean {
  const re = new RegExp(
    `(^|[^A-Za-z0-9])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-z0-9])`,
    'gi',
  )
  for (const m of text.matchAll(re)) {
    const found = m[2]!
    const at = (m.index ?? 0) + m[1]!.length
    const before = text.slice(0, at).trimEnd()
    const initial = before === '' || /[.!?]$/.test(before)
    if (found.length <= 4 && found === found.toUpperCase() && /[A-Z]/.test(found)) return true
    if (/^[A-Z]/.test(found) && !initial) return true
    const prev =
      before
        .split(/\s+/)
        .at(-1)
        ?.toLowerCase()
        .replace(/[^a-z]/g, '') ?? ''
    const next =
      text
        .slice(at + found.length)
        .trimStart()
        .split(/\s+/)[0]
        ?.toLowerCase()
        .replace(/[^a-z]/g, '') ?? ''
    if (TECH_CONTEXT.has(next) || TECH_CONTEXT.has(prev) || (prev === 'in' && /^[A-Z]/.test(found)))
      return true
  }
  return false
}

/** Reads a plain-language intent. Phrases first, then single words; every hit says why. */
export function readText(text: string, techs: Map<string, Tech>, into = emptySignals()): Signals {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  const tokens = tokenize(text)
  const phrase = (p: string) =>
    lower.includes(` ${p} `) || lower.includes(` ${p},`) || lower.includes(` ${p}.`)

  const names = new Map<string, string>()
  for (const t of techs.values()) {
    names.set(t.id, t.id)
    names.set(t.name.toLowerCase(), t.id)
  }
  for (const [alias, id] of Object.entries(TECH_ALIASES)) if (techs.has(id)) names.set(alias, id)
  for (const [word, id] of names) {
    if (word.length < 2) continue
    const hit = word.includes(' ') ? phrase(word) : tokens.includes(word)
    if (!hit) continue
    if (AMBIGUOUS.has(word) && !meantAsTech(text, word)) continue
    addTech(into, techs, id, { weight: 1, source: `you wrote “${word}”` })
  }

  const scan = <K extends string>(table: Partial<Record<K, string[]>>, m: Map<K, number>) => {
    for (const [key, words] of Object.entries(table) as [K, string[]][]) {
      for (const w of words) {
        const hit = w.includes(' ')
          ? phrase(w)
          : tokens.includes(w) || tokens.map(stem).includes(stem(w))
        if (hit) addMax(m, key, w.includes(' ') ? 1 : 0.8)
      }
    }
  }
  scan(DOMAIN_WORDS, into.domains)
  scan(INDUSTRY_WORDS, into.industries)
  scan(LIFECYCLE_WORDS, into.lifecycle)
  scan(TYPE_WORDS, into.types)
  into.terms.push(...tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1).map(stem))
  return into
}

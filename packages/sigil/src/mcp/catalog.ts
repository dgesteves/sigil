import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { CompileError, compile } from '../compile/compile.js'
import { detectAgents } from '../compile/detect.js'
import { openSession, stageInstall } from '../compile/install.js'
import { describePermissions, hookCommands } from '../compile/preview.js'
import {
  DEFAULT_REGISTRY,
  type FetchLike,
  openRegistry,
  type RegistryHandle,
  type Resolved,
  resolveFromRegistry,
} from '../compile/source.js'
import type { AgentId, Level, UpliftVerdict } from '../core/ids.js'
import type { RegistryEntry, Tally, UpliftRun } from '../core/schema.js'
import { loadTaxonomy, Technology } from '../core/taxonomy.js'
import { detectStack, type ProjectStack } from './project.js'

/** What the trust levels promise, in words an agent can pass on to its user. */
export const LEVEL_MEANING: Record<Level, string> = {
  submitted: 'Sigil has not validated this exact content. Read it before installing.',
  validated: 'Structure and security checks pass for this exact digest.',
  verified: 'Validated, a clean canary run in the sandbox, and approved by a maintainer.',
  revoked: 'Verification was withdrawn. Do not install.',
}

export const UPLIFT_MEANING: Record<UpliftVerdict, string> = {
  proven: 'Agents passed more hidden tests with it than without (95% interval above zero).',
  'no-effect': 'Measured, and it made no difference within the margin.',
  inconclusive: 'Measured, but the interval is too wide to call.',
  harmful: 'Agents did measurably worse with it.',
  untested: 'Not measured in the lab yet.',
}

const LEVEL_BOOST: Record<Level, number> = {
  verified: 1.3,
  validated: 1.1,
  submitted: 1,
  revoked: 0,
}
const UPLIFT_BOOST: Record<UpliftVerdict, number> = {
  proven: 1.5,
  inconclusive: 1,
  untested: 1,
  'no-effect': 0.9,
  harmful: 0,
}
/** Technology kinds too broad to make a capability relevant on their own. */
const GENERAL_KINDS = new Set(['language', 'runtime'])

const evidenceBoost = (e: RegistryEntry) => LEVEL_BOOST[e.level] * UPLIFT_BOOST[e.uplift]
/** Revoked and harmful capabilities are never suggested; `get` still explains them by id. */
const suggestible = (e: RegistryEntry) => evidenceBoost(e) > 0

export interface SearchFilters {
  type?: string | undefined
  technology?: string | undefined
  domain?: string | undefined
  agent?: AgentId | undefined
  provenOnly?: boolean | undefined
  limit: number
}

export class CatalogError extends Error {}

/**
 * The read side of the registry for `sigil mcp`: search, recommend, explain, plan. Nothing here
 * writes to the project; installing stays a human decision made with `sigil add`.
 */
export class Catalog {
  private handle?: Promise<RegistryHandle>
  private techs?: Promise<Technology[]>

  constructor(
    readonly root: string,
    readonly spec: string | undefined,
    private readonly fetchFn: FetchLike,
  ) {}

  get label(): string {
    return this.spec ?? DEFAULT_REGISTRY
  }

  registry(): Promise<RegistryHandle> {
    this.handle ??= openRegistry(this.spec, this.root, this.fetchFn).catch((e) => {
      this.handle = undefined
      throw e
    })
    return this.handle
  }

  /** The taxonomy travels with the registry: next to it online, in taxonomy/ in a checkout. */
  technologies(): Promise<Technology[]> {
    this.techs ??= this.loadTechnologies().catch((e) => {
      this.techs = undefined
      throw e
    })
    return this.techs
  }

  private async loadTechnologies(): Promise<Technology[]> {
    const label = this.label
    if (/^https:\/\//.test(label)) {
      const url = new URL('taxonomy.json', label).href
      const res = await this.fetchFn(url).catch((e: Error) => {
        throw new CatalogError(`could not fetch ${url}: ${e.message}`)
      })
      if (!res.ok)
        throw new CatalogError(`${label} publishes no taxonomy.json (HTTP ${res.status})`)
      const parsed = z
        .array(Technology)
        .safeParse(JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8')))
      if (!parsed.success) throw new CatalogError(`${url} is not a Sigil technology list`)
      return parsed.data
    }
    const abs = resolve(this.root, label)
    const taxonomy = await loadTaxonomy(
      existsSync(join(abs, 'taxonomy')) ? abs : resolve(abs, '..'),
    )
    if (!taxonomy) throw new CatalogError(`${label} has no taxonomy/technologies.yaml`)
    return taxonomy.technologies
  }

  async search(query: string, f: SearchFilters) {
    const { registry } = await this.registry()
    const terms = tokenize(query)
    const scored = registry.capabilities
      .filter(suggestible)
      .filter((e) => matchesFilters(e, f))
      .map((e) => ({
        e,
        score: terms.length ? relevance(e, terms) * evidenceBoost(e) : evidenceBoost(e),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.e.manifest.id.localeCompare(b.e.manifest.id))
    return {
      registry: this.label,
      total: scored.length,
      results: scored.slice(0, f.limit).map((r) => this.card(r.e)),
    }
  }

  async recommend(dir: string, limit: number) {
    const techs = await this.technologies()
    const stack = await detectStack(dir, techs)
    const { registry } = await this.registry()
    const confidence = new Map(stack.technologies.map((t) => [t.id, t.confidence]))
    const kind = new Map(techs.map((t) => [t.id, t.kind]))
    const general = (t: string) => GENERAL_KINDS.has(kind.get(t) ?? '')
    const ranked = registry.capabilities
      .filter(suggestible)
      .map((e) => {
        const own = e.manifest.technologies
        const matched = own.filter((t) => confidence.has(t))
        // A Zod skill is for projects that use Zod, not for every TypeScript project. Languages
        // decide only for capabilities that are about a language and nothing more specific.
        const specific = own.filter((t) => !general(t))
        const fits = specific.length ? specific.some((t) => confidence.has(t)) : matched.length > 0
        const fit = matched.reduce(
          (sum, t) => sum + confidence.get(t)! * (general(t) ? 0.25 : 1),
          0,
        )
        return { e, matched, score: fits ? fit * evidenceBoost(e) : 0 }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.e.manifest.id.localeCompare(b.e.manifest.id))
    return {
      registry: this.label,
      stack: summarizeStack(stack),
      results: ranked.slice(0, limit).map((r) => ({ ...this.card(r.e), matched: r.matched })),
      ...(ranked.length === 0
        ? {
            note: stack.technologies.length
              ? 'Nothing in the catalog targets this stack yet. Try search with a task description.'
              : 'No known technology was detected. Try search with a task description.',
          }
        : {}),
    }
  }

  async get(id: string) {
    const { registry } = await this.registry()
    const e = registry.capabilities.find((c) => c.manifest.id === id)
    if (!e) throw new CatalogError(`${id} is not in ${this.label}. Use search to find an id.`)
    const m = e.manifest
    const ev = e.evidence
    return {
      ...this.card(e),
      levelMeaning: LEVEL_MEANING[e.level],
      upliftMeaning: UPLIFT_MEANING[e.uplift],
      ...(m.description ? { description: m.description } : {}),
      industries: m.industries,
      lifecycle: m.lifecycle,
      license: m.license,
      authors: m.authors.map((a) => a.github),
      permissions: describePermissions(m.permissions),
      limitations: m.limitations,
      ...(m.includes.length ? { includes: m.includes } : {}),
      ...(m.source ? { source: m.source } : {}),
      files: e.files.map((f) => ({ path: f.path, bytes: f.bytes })),
      evidence: ev
        ? {
            digest: ev.digest,
            generatedAt: ev.generatedAt,
            structure: ev.structure.status,
            security: {
              status: ev.security.status,
              findings: ev.security.findings.map((x) => `${x.severity} ${x.rule}: ${x.message}`),
            },
            canary: ev.canary
              ? {
                  status: ev.canary.status,
                  runs: ev.canary.runs,
                  agent: `${ev.canary.agent.id} ${ev.canary.agent.version}`,
                  model: ev.canary.model,
                  events: ev.canary.events.map((x) => `${x.kind}: ${x.detail}`),
                }
              : null,
            uplift: ev.uplift.map(describeRun),
            reviews: ev.reviews.map((r) => ({ by: r.by, at: r.at, decision: r.decision })),
            ...(ev.revoked ? { revoked: ev.revoked } : {}),
          }
        : null,
    }
  }

  /** Stages the install exactly as `sigil add --dry-run` does, then throws the session away. */
  async plan(id: string, agents: AgentId[] | undefined) {
    const handle = await this.registry()
    const session = await openSession(this.root)
    const chosen =
      agents ?? session.lock.agents ?? (await detectAgents(this.root)).map((d) => d.agent)
    if (chosen.length === 0)
      throw new CatalogError(
        'No agent configuration found in this project. Pass agents, e.g. ["claude-code"].',
      )

    const resolved: Resolved[] = []
    const queue = [id]
    const seen = new Set<string>()
    for (const next of queue) {
      if (seen.has(next)) continue
      seen.add(next)
      const r = await resolveFromRegistry(handle, next)
      if (r.input.manifest.payload.format === 'bundle') queue.push(...r.input.manifest.includes)
      else resolved.push(r)
    }

    const exists = (p: string) => existsSync(join(this.root, p))
    const capabilities = []
    // One file can serve several agents (Cursor also reads .claude/skills), so say which.
    const servedBy = new Map<string, Set<string>>()
    for (const r of resolved) {
      let c: ReturnType<typeof compile>
      try {
        c = compile(r.input, chosen, { exists })
      } catch (e) {
        if (e instanceof CompileError) throw new CatalogError(e.message)
        throw e
      }
      const m = r.input.manifest
      capabilities.push({
        id: m.id,
        version: m.version,
        digest: r.input.digest,
        level: r.entry?.level,
        uplift: r.entry?.uplift,
        agents: c.results.map((x) =>
          x.result.status === 'supported'
            ? { agent: x.agent, supported: true }
            : { agent: x.agent, supported: false, reason: x.result.reason },
        ),
        hooks: hookCommands(c),
        notes: [
          ...new Set(
            c.results.flatMap((x) =>
              x.result.status === 'supported' ? x.result.notes.map((n) => n.message) : [],
            ),
          ),
        ],
      })
      for (const { op, agents } of c.ops) {
        const set = servedBy.get(op.path) ?? new Set()
        for (const a of agents) set.add(a)
        servedBy.set(op.path, set)
      }
      if (!c.results.some((x) => x.result.status === 'supported')) {
        session.conflict(`${m.id}: none of the selected agents can load it`)
        continue
      }
      await stageInstall(session, {
        compiled: c,
        source: r.source,
        ...(r.entry ? { level: r.entry.level, uplift: r.entry.uplift } : {}),
        ...(id !== m.id ? { via: id } : {}),
      })
    }
    const changes = await session.finish()
    const registryFlag = this.spec ? ` --registry ${quote(this.spec)}` : ''
    return {
      registry: this.label,
      agents: chosen,
      capabilities,
      changes: changes.map((ch) => ({
        path: ch.path,
        action: ch.after === null ? 'delete' : ch.before === undefined ? 'create' : 'update',
        ...(servedBy.has(ch.path) ? { for: [...servedBy.get(ch.path)!] } : {}),
      })),
      conflicts: session.conflicts,
      notes: session.notes,
      written: false,
      command: `npx sigil add ${id} --agent ${chosen.join(',')}${registryFlag}`,
      next: session.conflicts.length
        ? 'Resolve the conflicts first; sigil add would refuse this install.'
        : 'Nothing was written. Show the user this plan; they install it by running the command.',
    }
  }

  private card(e: RegistryEntry) {
    const m = e.manifest
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      version: m.version,
      summary: m.summary,
      level: e.level,
      uplift: e.uplift,
      technologies: m.technologies,
      domains: m.domains,
      targets: m.targets,
      digest: e.digest,
      ...(this.spec ? {} : { page: `${new URL(DEFAULT_REGISTRY).origin}/c/${m.id}` }),
    }
  }
}

function matchesFilters(e: RegistryEntry, f: SearchFilters): boolean {
  const m = e.manifest
  if (f.type && m.type !== f.type) return false
  if (f.technology && !m.technologies.includes(f.technology)) return false
  if (f.domain && !(m.domains as string[]).includes(f.domain)) return false
  if (f.agent && !m.targets.includes(f.agent)) return false
  if (f.provenOnly && e.uplift !== 'proven') return false
  return true
}

const STOP = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'my'])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9#+]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/**
 * Field-weighted term match, scaled by how many query terms matched, so "zod 4 migration" prefers
 * the capability that has all three over one that says "migration" three times.
 */
function relevance(e: RegistryEntry, terms: string[]): number {
  const m = e.manifest
  const fields: [string[], number][] = [
    [tokenize(m.name), 3],
    [m.technologies.flatMap((t) => [t, ...tokenize(t)]), 2.5],
    [tokenize(m.id), 2],
    [tokenize(m.summary), 2],
    [tokenize([m.type, ...m.domains, ...m.industries, ...m.lifecycle].join(' ')), 1.5],
    [tokenize(m.description ?? ''), 1],
  ]
  let score = 0
  let hit = 0
  for (const term of terms) {
    let best = 0
    for (const [tokens, weight] of fields) {
      if (tokens.some((t) => t === term || (term.length >= 4 && t.startsWith(term))))
        best = Math.max(best, weight)
    }
    if (best) hit++
    score += best
  }
  return score * (hit / terms.length)
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}pp`
const tally = (t: Tally) => `${t.passed}/${t.runs}`

function describeRun(u: UpliftRun) {
  const sum = (pick: (t: { baseline: Tally; treatment: Tally }) => Tally) =>
    u.tasks.reduce(
      (acc, t) => ({ passed: acc.passed + pick(t).passed, runs: acc.runs + pick(t).runs }),
      { passed: 0, runs: 0 },
    )
  const base = sum((t) => t.baseline)
  const treat = sum((t) => t.treatment)
  return {
    suite: u.suite,
    agent: `${u.agent.id} ${u.agent.version}`,
    model: u.model,
    at: u.at,
    baseline: `${base.passed}/${base.runs} passed without it`,
    treatment: `${treat.passed}/${treat.runs} passed with it`,
    delta: pct(u.delta),
    ci95: `[${pct(u.ci95[0])}, ${pct(u.ci95[1])}]`,
    verdict: u.verdict,
    tasks: u.tasks.map((t) => ({
      task: t.task,
      baseline: tally(t.baseline),
      treatment: tally(t.treatment),
    })),
    ...(u.traces ? { traces: u.traces } : {}),
  }
}

function summarizeStack(s: ProjectStack) {
  return {
    technologies: s.technologies.map((t) => ({
      id: t.id,
      name: t.name,
      confidence: t.confidence,
      source: t.source,
    })),
    manifests: s.manifests,
    files: s.files,
    ...(s.truncated ? { truncated: true } : {}),
  }
}

const quote = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`)

'use client'

import type { AgentId } from '@core/ids'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FOCUS_INTENT } from '@/components/chrome/CommandK'
import { Wordmark } from '@/components/chrome/Wordmark'
import type { Slot } from '@/components/field/engine'
import type { FieldHandle } from '@/components/field/Field'
import { DIMENSIONS, type Dimension, layout } from '@/components/field/layout'
import { Sigil } from '@/components/Sigil'
import {
  AGENT_LABEL,
  AGENTS,
  type CapView,
  CONTRIBUTE_URL,
  installLine,
  LEVEL,
  PRIMARY_AGENTS,
  pp,
  TYPE_LABEL,
  VERDICT,
} from '@/lib/model'
import type { FetchLog } from '@/lib/oracle/github'
import type { Signals, Tech } from '@/lib/oracle/intent'
import type { Index, Ranked } from '@/lib/oracle/rank'
import styles from './observatory.module.css'

const Field = dynamic(() => import('@/components/field/Field'), { ssr: false })

export interface ObservatoryMeta {
  demo: boolean
  generatedAt: string
  commit?: string
}

type StepState = 'idle' | 'running' | 'done' | 'error' | 'skipped'
interface Step {
  state: StepState
  summary: string
  ms?: number
  lines?: string[]
}
interface OracleRun {
  q: string
  steps: [Step, Step, Step, Step]
  signals?: Signals
  repo?: string
  loadout: Ranked[]
  excluded: Ranked[]
  relevant: number
  error?: string
}

const IDLE: Step = { state: 'idle', summary: '' }
const STEP_NAMES = ['Understand', 'Search', 'Weigh', 'Compose'] as const
const EXAMPLES = [
  'add a column to a large Postgres table without downtime',
  'harden our GitHub Actions workflows',
  'https://github.com/vercel/next.js',
]

export function Observatory({ caps, meta }: { caps: CapView[]; meta: ObservatoryMeta }) {
  const router = useRouter()
  const field = useRef<FieldHandle>(null)
  const input = useRef<HTMLInputElement>(null)
  const lensRef = useRef<HTMLDivElement>(null)
  const [dimension, setDimension] = useState<Dimension>('domain')
  const [reduced, setReduced] = useState(false)
  const [renderer, setRenderer] = useState<'webgl2' | 'canvas2d' | null>(null)
  const [q, setQ] = useState('')
  const [run, setRun] = useState<OracleRun | null>(null)
  const [agents, setAgents] = useState<AgentId[]>(['claude-code'])
  const runId = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const techsRef = useRef<Map<string, Tech> | null>(null)
  const oracleRef = useRef<Promise<typeof import('@/lib/oracle')> | null>(null)
  const indexRef = useRef<{ caps: CapView[]; index: Index } | null>(null)
  const loadOracle = useCallback(() => {
    oracleRef.current ??= import('@/lib/oracle')
    return oracleRef.current
  }, [])
  const lay = useMemo(() => layout(caps, dimension), [caps, dimension])
  const stats = useMemo(() => countOf(caps), [caps])

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    try {
      const saved = JSON.parse(localStorage.getItem('sigil.agents') ?? 'null') as AgentId[] | null
      if (Array.isArray(saved) && saved.length && saved.every((a) => AGENTS.includes(a)))
        setAgents(saved)
    } catch {}
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('sigil.agents', JSON.stringify(agents))
    } catch {}
  }, [agents])

  const loadTechs = useCallback(async () => {
    if (techsRef.current) return techsRef.current
    const res = await fetch('/taxonomy.json')
    const list = (await res.json()) as Tech[]
    techsRef.current = new Map(list.map((t) => [t.id, t]))
    return techsRef.current
  }, [])

  const ask = useCallback(
    async (query: string, using: AgentId[] = agents) => {
      const text = query.trim()
      if (!text) return
      const id = ++runId.current
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      const steps: OracleRun['steps'] = [
        { state: 'running', summary: 'reading the intent' },
        IDLE,
        IDLE,
        IDLE,
      ]
      let state: OracleRun = { q: text, steps, loadout: [], excluded: [], relevant: 0 }
      const publish = (next: Partial<OracleRun>) => {
        if (id !== runId.current) return
        state = { ...state, ...next, steps: [...(next.steps ?? state.steps)] as OracleRun['steps'] }
        setRun(state)
      }
      const setStep = (i: number, s: Step) => {
        const copy = [...state.steps] as OracleRun['steps']
        copy[i] = s
        publish({ steps: copy })
      }
      // Yield one frame between steps so each one paints as it completes. No artificial delay.
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
      try {
        history.replaceState(null, '', `/?q=${encodeURIComponent(text)}`)
      } catch {}
      publish({})

      // 1. Understand
      let t0 = performance.now()
      const [
        {
          RateLimited,
          buildIndex,
          compose,
          emptySignals,
          parseRepo,
          readRepo,
          readText,
          search,
          weigh,
        },
        techs,
      ] = await Promise.all([loadOracle(), loadTechs()])
      if (indexRef.current?.caps !== caps) indexRef.current = { caps, index: buildIndex(caps) }
      const index = indexRef.current.index
      const repo = parseRepo(text)
      let signals = emptySignals()
      const lines: string[] = []
      if (repo) {
        const logs: FetchLog[] = []
        try {
          const read = await readRepo(
            repo.owner,
            repo.repo,
            techs,
            (l) => {
              logs.push(l)
              setStep(0, {
                state: 'running',
                summary: `reading github.com/${repo.owner}/${repo.repo}`,
                lines: logs.map(fmtLog),
              })
            },
            ctrl.signal,
          )
          signals = read.signals
          lines.push(
            ...logs.map(fmtLog),
            `${read.paths.toLocaleString()} paths${read.shallow ? ' at the root (large repo: read shallow to keep the download small)' : ''}${read.truncated ? ' (tree truncated by GitHub)' : ''} · ${read.manifests.length} manifests read`,
          )
          if (read.description) readText(read.description, techs, signals)
          publish({ repo: `${repo.owner}/${repo.repo}` })
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          const msg =
            e instanceof RateLimited
              ? `GitHub's unauthenticated limit is used up${e.resetAt ? ` until ${e.resetAt.toLocaleTimeString()}` : ''}. Describe the repo in words instead.`
              : `could not read the repo: ${(e as Error).message}`
          setStep(0, {
            state: 'error',
            summary: msg,
            ms: performance.now() - t0,
            lines: logs.map(fmtLog),
          })
          publish({ error: msg })
          return
        }
      } else {
        readText(text, techs, signals)
      }
      const techList = [...signals.techs.entries()].sort((a, b) => b[1].weight - a[1].weight)
      for (const [tid, sig] of techList.slice(0, 10))
        lines.push(`${techs.get(tid)?.name ?? tid} ← ${sig.source}`)
      const facets = [
        ...[...signals.domains.keys()].slice(0, 4),
        ...[...signals.industries.keys()].slice(0, 2),
        ...[...signals.lifecycle.keys()].slice(0, 2).map((l) => `${l} stage`),
      ]
      setStep(0, {
        state: 'done',
        summary:
          techList.length || facets.length
            ? [
                techList.length
                  ? `${techList.length} ${techList.length === 1 ? 'technology' : 'technologies'}`
                  : '',
                facets.slice(0, 4).join(', '),
              ]
                .filter(Boolean)
                .join(' · ')
            : 'no known technology or discipline named; full-text search only',
        ms: performance.now() - t0,
        lines,
      })
      publish({ signals })
      await frame()

      // 2. Search
      t0 = performance.now()
      const found = search(index, signals, techs)
      setStep(1, {
        state: 'done',
        summary: `${found.considered} manifests scored · ${found.hits.length} relevant`,
        ms: performance.now() - t0,
      })
      publish({ relevant: found.hits.length })
      await frame()

      // 3. Weigh
      t0 = performance.now()
      const weighed = weigh(found.hits, using)
      const proven = weighed.ranked.filter((r) => r.cap.uplift === 'proven').length
      setStep(2, {
        state: 'done',
        summary: `${proven} proven · ${weighed.excluded.length} excluded`,
        ms: performance.now() - t0,
        lines: weighed.excluded.map((r) => `${r.cap.id} excluded: ${r.excluded}`),
      })
      await frame()

      // 4. Compose
      t0 = performance.now()
      const loadout = compose(weighed.ranked)
      setStep(3, {
        state: loadout.length ? 'done' : 'skipped',
        summary: loadout.length ? `${loadout.length} in the loadout` : 'nothing to compose',
        ms: performance.now() - t0,
      })
      publish({ loadout, excluded: weighed.excluded })
    },
    [agents, caps, loadOracle, loadTechs],
  )

  // Latest values for listeners registered once.
  const askRef = useRef(ask)
  askRef.current = ask
  const runRef = useRef(run)
  runRef.current = run
  const chooseAgents = useCallback((next: AgentId[]) => {
    setAgents(next)
    // Re-weigh the current answer for the new agents; evidence multipliers depend on them.
    const current = runRef.current
    if (current) void askRef.current(current.q, next)
  }, [])

  const clear = useCallback(() => {
    runId.current++
    abort.current?.abort()
    setRun(null)
    field.current?.setSlots(null)
    try {
      history.replaceState(null, '', '/')
    } catch {}
  }, [])

  // ?q= on load, ⌘K, and the 1-4 dimension keys.
  useEffect(() => {
    const initial = new URLSearchParams(location.search).get('q')
    if (initial) {
      setQ(initial)
      void askRef.current(initial)
    }
    const focus = () => {
      input.current?.focus()
      input.current?.select()
    }
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const d = DIMENSIONS.find((x) => x.key === e.key)
      if (d) setDimension(d.id)
    }
    window.addEventListener(FOCUS_INTENT, focus)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener(FOCUS_INTENT, focus)
      window.removeEventListener('keydown', key)
    }
  }, [])

  // Tell the field where each loadout slot sits, so the same light travels into orbit.
  const orbit = useRef<HTMLOListElement>(null)
  const measure = useCallback(() => {
    const el = orbit.current
    // Before the field exists there is nothing to send; the effect re-runs once it reports ready.
    if (!renderer) return
    if (!el || !run?.loadout.length) {
      field.current?.setSlots(run ? new Map() : null)
      return
    }
    const slots = new Map<string, Slot>()
    for (const a of el.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const r = a.getBoundingClientRect()
      slots.set(a.dataset.anchor!, {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        size: r.width * 0.92,
      })
    }
    field.current?.setSlots(slots)
  }, [run, renderer])
  useLayoutEffect(() => {
    measure()
    if (!run) return
    let raf = 0
    const again = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    // Slots glide in on a staggered entrance; follow them until it settles.
    const until = performance.now() + 1600
    let follow = 0
    const track = () => {
      measure()
      if (performance.now() < until) follow = requestAnimationFrame(track)
    }
    follow = requestAnimationFrame(track)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
      cancelAnimationFrame(follow)
      cancelAnimationFrame(raf)
    }
  }, [measure, run])

  const active = run !== null
  // The field bends around the intent line wherever it sits; it glides when the Oracle opens.
  useEffect(() => {
    if (!renderer) return
    let raf = 0
    const update = () => {
      const els = lensRef.current?.querySelectorAll<HTMLElement>('[data-lens]') ?? []
      field.current?.setClear(Array.from(els, (el) => el.getBoundingClientRect()))
    }
    const loop = () => {
      update()
      raf = requestAnimationFrame(loop)
    }
    // Track continuously for the second the intent glides; then only on resize.
    loop()
    const stop = setTimeout(() => cancelAnimationFrame(raf), active ? 1200 : 300)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(stop)
      window.removeEventListener('resize', update)
    }
  }, [renderer, active])

  const open = useCallback((c: CapView) => router.push(`/c/${c.ns}/${c.slug}`), [router])

  return (
    <main id="main" className={styles.root} data-oracle={active}>
      <Field
        ref={field}
        caps={caps}
        dimension={dimension}
        reducedMotion={reduced}
        onOpen={open}
        onReady={setRenderer}
      />

      <header className={styles.tl}>
        <Wordmark home />
        <p className={styles.tagline}>the open proving ground for agent capabilities</p>
      </header>

      <aside className={styles.tr} aria-label="Registry">
        <dl className={styles.stats}>
          <div>
            <dt>Capabilities</dt>
            <dd className="num">{stats.total}</dd>
          </div>
          <div data-tone={stats.proven ? 'flare' : undefined}>
            <dt>Proven</dt>
            <dd className="num">{stats.proven}</dd>
          </div>
          <div>
            <dt>Measured</dt>
            <dd className="num">{stats.measured}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd className="num">{stats.verified}</dd>
          </div>
          <div data-tone={stats.harmful ? 'harm' : undefined}>
            <dt>Harmful</dt>
            <dd className="num">{stats.harmful}</dd>
          </div>
        </dl>
        <p className={styles.stamp}>
          registry {meta.generatedAt.slice(0, 10)}
          {meta.commit ? ` · ${meta.commit.slice(0, 7)}` : ''}
          {meta.demo ? ' · demo' : ''}
        </p>
        <nav className={styles.links} aria-label="Pages">
          <Link href="/method">Method</Link>
          <Link href="/coverage">Coverage</Link>
          <Link href="/report">Report</Link>
        </nav>
      </aside>

      <section className={styles.center} aria-label="The Oracle">
        <search className={styles.search}>
          <form
            className={styles.intent}
            onSubmit={(e) => {
              e.preventDefault()
              void ask(q)
            }}
          >
            <label htmlFor="intent" className={`micro ${styles.intentLabel}`}>
              <span className={styles.pulse} aria-hidden="true" /> the oracle
            </label>
            <div ref={lensRef} className={styles.lens}>
              <div className={styles.line} data-lens>
                <input
                  ref={input}
                  id="intent"
                  className={styles.input}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => {
                    void loadOracle()
                    void loadTechs()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (q) setQ('')
                      else clear()
                      if (active) clear()
                    }
                  }}
                  placeholder="What is your agent about to work on?"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="intent-hint"
                />
                {active ? (
                  <button
                    type="button"
                    className={styles.clear}
                    onClick={() => {
                      setQ('')
                      clear()
                      input.current?.focus()
                    }}
                    aria-label="Clear and return to the field"
                  >
                    ×
                  </button>
                ) : null}
                <button type="submit" className={styles.go} aria-label="Ask the Oracle">
                  <kbd>↵</kbd>
                </button>
              </div>
              <p id="intent-hint" className={styles.hint} data-lens>
                describe the task, or paste a GitHub repo URL
                <span className={styles.kHint}>
                  {' '}
                  · <kbd>⌘</kbd>
                  <kbd>K</kbd> from anywhere
                </span>
              </p>
              {!active && caps.length > 0 ? (
                <div className={styles.examples} data-lens>
                  <span className="micro">try</span>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        setQ(ex)
                        void ask(ex)
                      }}
                    >
                      {ex.replace('https://', '')}
                    </button>
                  ))}
                </div>
              ) : null}
              {!active && caps.length === 0 ? <EmptyRegistry /> : null}
              {!active && caps.length > 0 && stats.proven === 0 ? (
                <p className={styles.nothing} data-lens>
                  {caps.length} in the registry, none proven yet. Proof is produced by runs, not
                  claims: <code>npx sigil prove</code> · <Link href="/method">how proof works</Link>
                </p>
              ) : null}
            </div>
          </form>
        </search>

        {run ? (
          <OraclePanel
            run={run}
            agents={agents}
            setAgents={chooseAgents}
            orbit={orbit}
            showGlyphs={renderer === null}
          />
        ) : null}
      </section>

      <footer className={styles.bl}>
        <Legend />
      </footer>

      <fieldset className={styles.bc} hidden={caps.length === 0}>
        <legend className="sr-only">Arrange the field by</legend>
        <span className="micro" aria-hidden="true">
          arrange by
        </span>
        {DIMENSIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={dimension === d.id}
            onClick={() => setDimension(d.id)}
            className={styles.dim}
          >
            <kbd>{d.key}</kbd> {d.label}
          </button>
        ))}
      </fieldset>

      <nav
        className="sr-only"
        aria-label={`Capabilities by ${DIMENSIONS.find((d) => d.id === dimension)?.label}`}
      >
        <h2>Every capability in the field</h2>
        {lay.sectors
          .filter((s) => s.count > 0)
          .map((s) => (
            <section key={s.key} aria-label={s.label}>
              <h3>
                {s.label}: {s.count}
              </h3>
              <ul>
                {caps
                  .filter((_, i) => lay.place[i] === lay.sectors.indexOf(s))
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/c/${c.ns}/${c.slug}`}
                        onFocus={() => field.current?.focus(c.id)}
                        onBlur={() => field.current?.focus(null)}
                      >
                        {describe(c)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
      </nav>
    </main>
  )
}

function describe(c: CapView): string {
  const v = VERDICT[c.uplift].label.toLowerCase()
  const d = c.lead
    ? `, ${pp(c.lead.delta)} points, 95% interval ${pp(c.lead.ci95[0])} to ${pp(c.lead.ci95[1])}`
    : ''
  return `${c.name} (${TYPE_LABEL[c.type]}, ${c.level}): ${v}${d}`
}

function fmtLog(l: FetchLog): string {
  const host = l.url.includes('raw.githubusercontent.com') ? 'raw' : 'api'
  const size =
    l.bytes !== undefined
      ? ` · ${l.bytes > 1024 ? `${(l.bytes / 1024).toFixed(1)} KB` : `${l.bytes} B`}`
      : ''
  return `${host} ${l.label} → ${l.status}${size} · ${Math.round(l.ms)} ms${l.note ? ` · ${l.note}` : ''}`
}

function countOf(caps: CapView[]) {
  return {
    total: caps.length,
    proven: caps.filter((c) => c.uplift === 'proven').length,
    measured: caps.filter((c) => c.uplift !== 'untested').length,
    verified: caps.filter((c) => c.level === 'verified').length,
    harmful: caps.filter((c) => c.uplift === 'harmful').length,
  }
}

function OraclePanel({
  run,
  agents,
  setAgents,
  orbit,
  showGlyphs,
}: {
  run: OracleRun
  agents: AgentId[]
  setAgents(a: AgentId[]): void
  orbit: React.RefObject<HTMLOListElement | null>
  showGlyphs: boolean
}) {
  const [more, setMore] = useState(false)
  const [copied, setCopied] = useState(false)
  const ids = run.loadout.map((r) => r.cap.id)
  const command = installLine(ids, agents)
  const n = run.loadout.length
  const done = run.steps[3].state !== 'idle' && run.steps[3].state !== 'running'

  return (
    <div className={styles.oracle}>
      <ol className={styles.steps} aria-label="What the Oracle computed">
        {run.steps.map((s, i) => (
          <li key={STEP_NAMES[i]} data-state={s.state} className={styles.step}>
            <div className={styles.stepHead}>
              <span className="num">0{i + 1}</span>
              <span>{STEP_NAMES[i]}</span>
              <span className={styles.stepMs}>
                {s.ms !== undefined
                  ? `${s.ms < 10 ? s.ms.toFixed(1) : Math.round(s.ms)} ms`
                  : s.state === 'running'
                    ? '…'
                    : ''}
              </span>
            </div>
            <p className={styles.stepSum}>{s.summary}</p>
            {s.lines?.length ? (
              <ul className={styles.stepLines}>
                {s.lines.slice(0, 8).map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {s.lines.length > 8 ? <li>+{s.lines.length - 8} more</li> : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      <p className={styles.computed}>
        computed in your browser from the registry · deterministic · nothing on this panel is
        generated
      </p>

      {done && n > 0 ? (
        <>
          <ol
            ref={orbit}
            className={styles.orbit}
            style={{ '--n': n } as React.CSSProperties}
            aria-label="Loadout"
          >
            {run.loadout.map((r, i) => (
              <LoadoutItem key={r.cap.id} r={r} i={i} n={n} showGlyph={showGlyphs} />
            ))}
          </ol>
          <div className={styles.install}>
            <fieldset className={styles.agents}>
              <legend className="micro">install for</legend>
              {(more ? AGENTS : PRIMARY_AGENTS).map((a) => {
                const on = agents.includes(a)
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setAgents(
                        on
                          ? agents.length > 1
                            ? agents.filter((x) => x !== a)
                            : agents
                          : [...agents, a],
                      )
                    }
                  >
                    {AGENT_LABEL[a]}
                  </button>
                )
              })}
              <button
                type="button"
                className={styles.more}
                onClick={() => setMore(!more)}
                aria-expanded={more}
              >
                {more ? 'fewer' : `+${AGENTS.length - PRIMARY_AGENTS.length} more`}
              </button>
            </fieldset>
            <div className={styles.command}>
              <code>
                <span className={styles.prompt}>$</span> {command}
              </code>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  } catch {}
                }}
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <p className={styles.installNote}>
              <code>sigil add</code> recomputes every digest from the downloaded files and refuses
              to install on a mismatch.
            </p>
          </div>
          <Narration run={run} agents={agents} />
        </>
      ) : null}

      {done && n === 0 && !run.error ? (
        <div className={styles.none}>
          <p className="display">Nothing in the registry matches this yet.</p>
          <p>
            {run.relevant === 0
              ? 'No capability names these technologies or disciplines.'
              : 'Everything that matched was excluded on evidence (see Weigh).'}{' '}
            That is an open area: <a href={CONTRIBUTE_URL}>submit a capability</a>, or browse{' '}
            <Link href="/coverage">what is covered</Link>.
          </p>
        </div>
      ) : null}
      {run.excluded.length > 0 && done ? (
        <p className={styles.excluded}>
          Left out on evidence:{' '}
          {run.excluded.map((r, i) => (
            <span key={r.cap.id}>
              {i ? ', ' : ''}
              <Link href={`/c/${r.cap.ns}/${r.cap.slug}`}>{r.cap.id}</Link> ({r.excluded})
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}

function LoadoutItem({
  r,
  i,
  n,
  showGlyph,
}: {
  r: Ranked
  i: number
  n: number
  showGlyph: boolean
}) {
  const c = r.cap
  const v = VERDICT[c.uplift]
  // Slots sit on an arc below the intent: the loadout is in orbit around it.
  const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1
  const lift = (1 - Math.cos(t * 0.9)) * 64
  return (
    <li className={styles.slot} style={{ '--lift': `${-lift}px`, '--i': i } as React.CSSProperties}>
      <span className={styles.anchor} data-anchor={c.id} data-verdict={c.uplift}>
        {showGlyph ? <Sigil digest={c.digest} size={54} color={v.tone} /> : null}
      </span>
      <div className={styles.readout}>
        <Link href={`/c/${c.ns}/${c.slug}`} className={styles.slotName}>
          {c.name}
        </Link>
        <span className={styles.slotId}>{c.id}</span>
        <span className={styles.slotVerdict} style={{ color: v.tone }}>
          {v.label}
          {c.lead ? (
            <>
              {' '}
              <b className="num">{pp(c.lead.delta)}</b>
              <span className="num">
                {' '}
                [{pp(c.lead.ci95[0])}, {pp(c.lead.ci95[1])}]
              </span>
            </>
          ) : null}
        </span>
        {c.lead ? (
          <Bar lo={c.lead.ci95[0]} hi={c.lead.ci95[1]} d={c.lead.delta} tone={v.tone} />
        ) : null}
        <span className={styles.slotMeta}>
          {LEVEL[c.level].label} · {TYPE_LABEL[c.type]}
          {c.lead ? ` · ${c.lead.baseline.runs + c.lead.treatment.runs} runs` : ''}
        </span>
        <span className={styles.slotWhy}>
          {r.why.length ? `matches ${r.why.slice(0, 3).join(', ')}` : 'full-text match'}
        </span>
        <span className={styles.slotScore} title={r.weigh.join(' · ') || 'no evidence adjustments'}>
          score {r.relevance.toFixed(1)} × {r.evidence.toFixed(2)}
        </span>
      </div>
    </li>
  )
}

function Bar({ lo, hi, d, tone }: { lo: number; hi: number; d: number; tone: string }) {
  const x = (v: number) => ((v + 1) / 2) * 100
  return (
    <svg className={styles.bar} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      <rect x={x(-0.1)} width={x(0.1) - x(-0.1)} height="8" fill="rgba(236,229,216,0.07)" />
      <line x1="50" x2="50" y2="8" stroke="rgba(236,229,216,0.4)" strokeWidth="0.5" />
      <rect x={x(lo)} y="3" width={Math.max(0.8, x(hi) - x(lo))} height="2" fill={tone} />
      <rect x={x(d) - 0.7} y="1" width="1.4" height="6" fill={tone} />
    </svg>
  )
}

function Narration({ run, agents }: { run: OracleRun; agents: AgentId[] }) {
  const [status, setStatus] = useState<{ enabled: boolean; model?: string } | null>(null)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  useEffect(() => {
    let live = true
    fetch('/api/oracle')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j: { enabled: boolean; model?: string }) => live && setStatus(j))
      .catch(() => live && setStatus({ enabled: false }))
    return () => {
      live = false
    }
  }, [])
  const key = run.loadout.map((r) => r.cap.id).join(',')
  const runRef = useRef(run)
  runRef.current = run
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const enabled = status?.enabled ?? false
  useEffect(() => {
    if (!enabled || !key) return
    const run = runRef.current
    const agents = agentsRef.current
    const ctrl = new AbortController()
    setText('')
    setState('streaming')
    const facts = {
      intent: run.q.slice(0, 400),
      detected: [...(run.signals?.techs.keys() ?? [])].slice(0, 12),
      agents,
      loadout: run.loadout.map((r) => ({
        id: r.cap.id,
        name: r.cap.name,
        summary: r.cap.summary,
        level: r.cap.level,
        uplift: r.cap.uplift,
        delta: r.cap.lead ? Math.round(r.cap.lead.delta * 100) : null,
        ci95: r.cap.lead ? r.cap.lead.ci95.map((x) => Math.round(x * 100)) : null,
        matched: r.why.slice(0, 4),
      })),
    }
    fetch('/api/oracle', {
      method: 'POST',
      body: JSON.stringify(facts),
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          setState('error')
          setText(
            res.status === 429
              ? 'Narration is rate limited; the computed result above is complete.'
              : '',
          )
          return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setText((t) => t + dec.decode(value, { stream: true }))
        }
        setState('done')
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setState('error')
      })
    return () => ctrl.abort()
  }, [enabled, key])

  if (!status) return null
  if (!status.enabled)
    return (
      <p className={styles.narrationOff}>
        narration off · no language model is involved in this answer
      </p>
    )
  return (
    <div className={styles.narration} data-state={state} aria-live="polite">
      <span className="micro">
        generated · {status.model} · reads only the computed result above and may be wrong; the
        numbers are not
      </span>
      <p>{text || (state === 'streaming' ? '…' : '')}</p>
    </div>
  )
}

function Legend() {
  const items = [
    ['proven', 'Proven'],
    ['inconclusive', 'Inconclusive'],
    ['no-effect', 'No effect'],
    ['untested', 'Untested'],
    ['harmful', 'Harmful'],
  ] as const
  return (
    <div className={styles.legend}>
      <ul>
        {items.map(([k, label]) => (
          <li key={k}>
            <span className={styles.swatch} data-verdict={k} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
      <p>
        nearer the intent = stronger evidence
        <br />
        rings = trust level · rim = coverage
      </p>
    </div>
  )
}

function EmptyRegistry() {
  return (
    <div className={styles.empty} data-lens>
      <p className="display">The proving ground is open. Nothing has been proven yet.</p>
      <p>Every light in this field will be the result of a recorded run on sealed content.</p>
      <code>{'npx sigil prove catalog/<type>/<ns>/<slug> --suite <suite> --runs 6'}</code>
      <p>
        <Link href="/method">How proof works</Link> ·{' '}
        <a href={CONTRIBUTE_URL}>Submit a capability</a>
      </p>
    </div>
  )
}

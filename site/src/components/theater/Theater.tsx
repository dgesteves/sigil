'use client'

/**
 * Two recorded runs on one clock: baseline left, with the capability right. Events stream in at the
 * time the lab recorded them; nothing is reordered, invented or paced for effect beyond the chosen
 * playback speed. Tokens are a per-run total in the trace, so they are shown as a total.
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './theater.module.css'

export interface TraceLite {
  condition: 'baseline' | 'treatment'
  passed: boolean
  tampered: boolean
  falseDone: boolean
  tokens: number
  seconds: number
  costUsd?: number
  model: string
  agent: string
  at: string
  verifyOutput?: string
  events: { t: number; kind: string; tool?: string; text: string; ok?: boolean }[]
}

export interface PairLink {
  suite: string
  task: string
  run: number
  href: string
  baseline?: boolean
  treatment?: boolean
}

const SPEEDS = [1, 2, 4, 8, 16, 32, 64]
const TEST_RE =
  /\b(test|tests|vitest|jest|pytest|playwright|cargo test|go test|db:test|test:e2e)\b/i

interface Props {
  pair: { suite: string; task: string; run: number }
  baseline?: TraceLite
  treatment?: TraceLite
  pairs: PairLink[]
  capName: string
  demo: boolean
}

export function Theater({ pair, baseline, treatment, pairs, capName }: Props) {
  const end = (t?: TraceLite) => (t ? Math.max(t.seconds * 1000, t.events.at(-1)?.t ?? 0) : 0)
  const duration = Math.max(end(baseline), end(treatment), 1)
  const defaultSpeed = SPEEDS.reduce((a, b) =>
    Math.abs(b - duration / 24000) < Math.abs(a - duration / 24000) ? b : a,
  )
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(defaultSpeed)
  const last = useRef(0)
  const timeRef = useRef(0)
  timeRef.current = time

  useEffect(() => {
    // Start playing on arrival unless the reader asked for less motion; then show the whole record.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) setTime(duration)
    else setPlaying(true)
  }, [duration])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = now - last.current
      last.current = now
      const next = Math.min(duration, timeRef.current + dt * speed)
      setTime(next)
      if (next >= duration) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, duration])

  const toggle = useCallback(() => {
    if (time >= duration) setTime(0)
    setPlaying((p) => !p)
  }, [time, duration])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight') setTime((x) => Math.min(duration, x + duration * 0.05))
      else if (e.key === 'ArrowLeft') setTime((x) => Math.max(0, x - duration * 0.05))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle, duration])

  const tasks = useMemo(() => [...new Set(pairs.map((p) => p.task))], [pairs])

  return (
    <section className={styles.theater} aria-label="Run replay">
      <div className={styles.pick}>
        <div className={styles.pickGroup}>
          <span className="micro">task</span>
          {tasks.map((t) => {
            const first = pairs.find((p) => p.task === t)!
            return (
              <Link
                key={t}
                href={first.href}
                className={styles.chip}
                aria-current={t === pair.task ? 'page' : undefined}
              >
                {t}
              </Link>
            )
          })}
        </div>
        <div className={styles.pickGroup}>
          <span className="micro">run</span>
          {pairs
            .filter((p) => p.task === pair.task)
            .map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className={styles.run}
                aria-current={p.run === pair.run ? 'page' : undefined}
                title={`baseline ${p.baseline === undefined ? 'missing' : p.baseline ? 'passed' : 'failed'} · with capability ${p.treatment === undefined ? 'missing' : p.treatment ? 'passed' : 'failed'}`}
              >
                <span data-pass={p.baseline} />
                <span data-pass={p.treatment} />
                <b>{p.run}</b>
              </Link>
            ))}
        </div>
        <p className={styles.note}>
          Runs are independent and their order was randomized; run n of each condition is paired
          only for viewing.
        </p>
      </div>

      <div className={styles.split}>
        <Pane label="Baseline" sub="the agent alone" trace={baseline} time={time} />
        <Pane
          label={`With ${capName}`}
          sub="capability installed"
          trace={treatment}
          time={time}
          accent
        />
      </div>

      <Scrub
        duration={duration}
        time={time}
        setTime={setTime}
        baseline={baseline}
        treatment={treatment}
      />

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.play}
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : time >= duration ? '↺' : '▶'}
        </button>
        <span className={`num ${styles.clock}`}>
          {fmtClock(time)} <span>/ {fmtClock(duration)}</span>
        </span>
        <fieldset className={styles.speeds}>
          <legend className="sr-only">Playback speed</legend>
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={s === speed} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </fieldset>
        <span className={styles.keys}>
          <kbd>space</kbd> play · <kbd>←</kbd>
          <kbd>→</kbd> seek
        </span>
      </div>
    </section>
  )
}

function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Pane({
  label,
  sub,
  trace,
  time,
  accent,
}: {
  label: string
  sub: string
  trace?: TraceLite
  time: number
  accent?: boolean
}) {
  const list = useRef<HTMLOListElement>(null)
  const shown = trace ? trace.events.filter((e) => e.t <= time) : []
  const ended = trace ? time >= Math.max(trace.seconds * 1000, trace.events.at(-1)?.t ?? 0) : false
  const tools = shown.filter((e) => e.kind === 'tool-call').length
  const tests = shown.filter((e) => e.kind === 'tool-call' && TEST_RE.test(e.text)).length
  const lastT = shown.at(-1)?.t ?? 0

  const count = shown.length
  useEffect(() => {
    const el = list.current
    if (el && count) el.scrollTop = el.scrollHeight
  }, [count])

  if (!trace) {
    return (
      <div className={styles.pane}>
        <header className={styles.paneHead}>
          <span>{label}</span>
        </header>
        <p className={styles.missing}>No trace recorded for this condition and run.</p>
      </div>
    )
  }
  return (
    <div className={styles.pane} data-accent={accent} data-ended={ended} data-passed={trace.passed}>
      <header className={styles.paneHead}>
        <span>{label}</span>
        <small>
          {sub} · {trace.agent} · {trace.model}
        </small>
      </header>
      <dl className={styles.counters}>
        <div>
          <dt>elapsed</dt>
          <dd className="num">{(Math.min(time, trace.seconds * 1000) / 1000).toFixed(0)}s</dd>
        </div>
        <div>
          <dt>tool calls</dt>
          <dd className="num">{tools}</dd>
        </div>
        <div>
          <dt>test runs</dt>
          <dd className="num">{tests}</dd>
        </div>
        <div>
          <dt>tokens · run total</dt>
          <dd className="num">{trace.tokens.toLocaleString()}</dd>
        </div>
      </dl>
      <ol ref={list} className={styles.events} aria-live="off">
        {shown.map((e, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: events are an append-only recording
            key={i}
            data-kind={e.kind}
            data-ok={e.ok}
            data-fresh={time - e.t < 900 && e.t === lastT}
          >
            <span className={styles.t}>{(e.t / 1000).toFixed(1)}</span>
            <span className={styles.kind}>
              {e.kind === 'tool-call'
                ? (e.tool ?? 'tool')
                : e.kind === 'tool-result'
                  ? '↳'
                  : e.kind}
            </span>
            <span className={styles.text}>{e.text}</span>
          </li>
        ))}
      </ol>
      <div className={styles.verdict} aria-live="polite">
        {ended ? (
          <>
            <b>{trace.passed ? 'Hidden tests passed' : 'Hidden tests failed'}</b>
            {trace.tampered ? <span className={styles.flag}>edited protected tests</span> : null}
            {trace.falseDone ? <span className={styles.flag}>claimed done</span> : null}
            {trace.verifyOutput ? <code>{trace.verifyOutput}</code> : null}
          </>
        ) : (
          <span className={styles.waiting}>verifier runs after the agent stops</span>
        )}
      </div>
    </div>
  )
}

function Scrub({
  duration,
  time,
  setTime,
  baseline,
  treatment,
}: {
  duration: number
  time: number
  setTime(t: number): void
  baseline?: TraceLite
  treatment?: TraceLite
}) {
  const lane = (t: TraceLite | undefined, y: number) =>
    t?.events.map((e) => (
      <rect
        key={`${y}-${e.t}-${e.kind}`}
        x={(e.t / duration) * 1000 - 1}
        y={y}
        width={2}
        height={e.kind === 'verify' ? 14 : 8}
        className={styles[`m_${e.kind.replace('-', '_')}`]}
      />
    ))
  return (
    <div className={styles.scrub}>
      <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="1000" y1="20" y2="20" className={styles.axis} />
        {lane(baseline, 4)}
        {lane(treatment, 24)}
        <rect x="0" y="0" width={(time / duration) * 1000} height="40" className={styles.played} />
        <line
          x1={(time / duration) * 1000}
          x2={(time / duration) * 1000}
          y1="0"
          y2="40"
          className={styles.head}
        />
      </svg>
      {/* A native range input: keyboard, touch and screen readers get seeking for free. */}
      <input
        type="range"
        className={styles.range}
        min={0}
        max={Math.round(duration)}
        step={100}
        value={Math.round(time)}
        onChange={(e) => setTime(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={`${fmtClock(time)} of ${fmtClock(duration)}`}
      />
      <div className={styles.lanes}>
        <span>baseline</span>
        <span>with capability</span>
      </div>
    </div>
  )
}

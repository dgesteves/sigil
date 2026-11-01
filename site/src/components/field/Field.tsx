'use client'

import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { type CapView, pp, TYPE_LABEL, VERDICT } from '@/lib/model'
import { FieldEngine, type Slot } from './engine'
import styles from './field.module.css'
import { drawGraticule } from './graticule'
import { type Dimension, layout } from './layout'
import { Canvas2DRenderer } from './render-2d'
import { GLRenderer } from './render-gl'

export interface FieldHandle {
  setSlots(slots: Map<string, Slot> | null): void
  focus(id: string | null): void
  /** Screen rectangles the field should bend around (the intent line and its companions). */
  setClear(rects: DOMRect[]): void
}

interface Props {
  caps: CapView[]
  dimension: Dimension
  reducedMotion: boolean
  onOpen(cap: CapView): void
  onReady?(renderer: 'webgl2' | 'canvas2d'): void
  ref?: Ref<FieldHandle>
}

const LABELS = 7

export default function Field({ caps, dimension, reducedMotion, onOpen, onReady, ref }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const under = useRef<HTMLCanvasElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FieldEngine | null>(null)
  const [hovered, setHovered] = useState<CapView | null>(null)
  const layouts = useMemo(() => layout(caps, dimension), [caps, dimension])
  const layoutRef = useRef(layouts)
  layoutRef.current = layouts
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  useImperativeHandle(ref, () => ({
    setSlots(slots) {
      engineRef.current?.setSlots(slots)
    },
    setClear(rects) {
      const e = engineRef.current
      if (!e) return
      e.clear = rects
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          rx: r.width / 2 + 30,
          ry: r.height / 2 + 26,
        }))
    },
    focus(id) {
      const e = engineRef.current
      if (!e) return
      e.focused = id ? e.nodes.findIndex((n) => n.cap.id === id) : -1
      setHovered(id ? (caps.find((c) => c.id === id) ?? null) : null)
    },
  }))

  useEffect(() => {
    engineRef.current?.setLayout(layouts)
  }, [layouts])

  // The engine is rebuilt only when the population or motion preference changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onReady is a notification, not an input
  useEffect(() => {
    const el = wrap.current
    const u = under.current
    if (!el || !u) return
    const engine = new FieldEngine(caps, reducedMotion)
    engineRef.current = engine
    const compact = el.clientWidth < 720 || matchMedia('(pointer: coarse)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.75 : 2)
    // A canvas keeps the first context type it was asked for, so each attempt gets a fresh one.
    const fresh = () => {
      const c = document.createElement('canvas')
      c.className = styles.layer!
      u.after(c)
      return c
    }
    let l = fresh()
    const gl = compact ? null : GLRenderer.create(l, engine)
    if (!gl) {
      l.remove()
      l = fresh()
    }
    const renderer = gl ?? new Canvas2DRenderer(l, engine)
    onReady?.(gl ? 'webgl2' : 'canvas2d')
    const uctx = u.getContext('2d')!
    const mono =
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
      'monospace'

    const size = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      for (const c of [u, l]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        c.style.width = `${w}px`
        c.style.height = `${h}px`
      }
      engine.resize(w, h)
    }
    size()
    engine.setLayout(layoutRef.current, reducedMotion)
    if (reducedMotion) engine.settle()
    const ro = new ResizeObserver(size)
    ro.observe(el)

    const labelEls = Array.from(labels.current?.children ?? []) as HTMLElement[]
    let raf = 0
    let last = performance.now()
    let lastHover = -2
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = (now - last) / 1000
      last = now
      engine.step(dt)
      const hit = engine.pointer.active ? engine.pick(engine.pointer.x, engine.pointer.y) : -1
      engine.hovered = hit
      const shown = hit >= 0 ? hit : engine.focused
      if (shown !== lastHover) {
        lastHover = shown
        setHovered(shown >= 0 ? engine.nodes[shown]!.cap : null)
        l.style.cursor = hit >= 0 ? 'pointer' : 'default'
      }
      const lay = layoutRef.current
      const hoverSector = shown >= 0 ? (lay.sectors[lay.place[shown] ?? -1]?.key ?? null) : null
      drawGraticule(uctx, engine, lay, dpr, { mono }, hoverSector)
      renderer.draw(engine, dpr)

      if (tip.current) {
        const n = shown >= 0 ? engine.nodes[shown] : undefined
        if (n) {
          const left = n.sx + n.size * 0.8 + 12
          const flip = left + 300 > engine.w
          tip.current.style.transform = `translate3d(${flip ? n.sx - n.size * 0.8 - 12 - 300 : left}px, ${n.sy - 18}px, 0)`
          tip.current.style.opacity = '1'
        } else tip.current.style.opacity = '0'
      }
      // Names of the sigils nearest the pointer: the instrument reads what you point at.
      if (labelEls.length) {
        const near = engine.oracle
          ? []
          : engine.nodes
              .map((n, i) => ({ n, i }))
              .filter(({ n, i }) => n.near > 0.35 && i !== shown && n.ignite > 0.9)
              .sort((a, b) => b.n.near - a.n.near)
              .slice(0, LABELS)
        labelEls.forEach((elx, k) => {
          const item = near[k]
          if (!item) {
            elx.style.opacity = '0'
            return
          }
          if (elx.dataset.id !== item.n.cap.id) {
            elx.dataset.id = item.n.cap.id
            elx.textContent = item.n.cap.name
          }
          elx.style.opacity = String(Math.min(1, (item.n.near - 0.35) * 2.2))
          elx.style.transform = `translate3d(${item.n.sx + item.n.size * 0.6}px, ${item.n.sy - 6}px, 0)`
        })
      }
    }
    const start = () => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const vis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', vis)
    start()

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      engine.setPointer(e.clientX - r.left, e.clientY - r.top, true)
    }
    const leave = () => engine.setPointer(-1e4, -1e4, false)
    const click = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const hit = engine.pick(e.clientX - r.left, e.clientY - r.top)
      if (hit >= 0) openRef.current(engine.nodes[hit]!.cap)
    }
    l.addEventListener('pointermove', move)
    l.addEventListener('pointerdown', move)
    l.addEventListener('pointerleave', leave)
    l.addEventListener('click', click)

    return () => {
      stop()
      ro.disconnect()
      document.removeEventListener('visibilitychange', vis)
      l.removeEventListener('pointermove', move)
      l.removeEventListener('pointerdown', move)
      l.removeEventListener('pointerleave', leave)
      l.removeEventListener('click', click)
      renderer.dispose()
      l.remove()
      engineRef.current = null
    }
  }, [caps, reducedMotion])

  return (
    <>
      <div ref={wrap} className={styles.field} aria-hidden="true">
        <canvas ref={under} className={styles.layer} />
        <div ref={labels} className={styles.labels}>
          {Array.from({ length: LABELS }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of label slots
            <span key={i} className={styles.near} />
          ))}
        </div>
      </div>
      {/* Its own fixed layer, so the readout sits above the intent line and the corners. */}
      <div className={styles.tipLayer} aria-hidden="true">
        <div ref={tip} className={styles.tip}>
          {hovered ? <Readout cap={hovered} /> : null}
        </div>
      </div>
    </>
  )
}

function Readout({ cap }: { cap: CapView }) {
  const v = VERDICT[cap.uplift]
  const lead = cap.lead
  return (
    <>
      <div className={styles.tipKicker}>
        {TYPE_LABEL[cap.type]} · {cap.level}
        {cap.stale ? ' · evidence is for an older digest' : ''}
      </div>
      <div className={styles.tipName}>{cap.name}</div>
      <div className={styles.tipId}>{cap.id}</div>
      <div className={styles.tipVerdict} style={{ color: v.tone }}>
        {v.label.toUpperCase()}
        {lead ? (
          <span className={styles.tipDelta}>
            {pp(lead.delta)} pts{' '}
            <em>
              [{pp(lead.ci95[0])}, {pp(lead.ci95[1])}]
            </em>
          </span>
        ) : null}
      </div>
      {lead ? (
        <MiniInterval lo={lead.ci95[0]} hi={lead.ci95[1]} d={lead.delta} tone={v.tone} />
      ) : null}
      <div className={styles.tipFoot}>
        {lead
          ? `${lead.treatment.runs + lead.baseline.runs} runs · ${lead.tasks} tasks · ${lead.agent}`
          : 'no runs for this digest'}
      </div>
    </>
  )
}

export function MiniInterval({
  lo,
  hi,
  d,
  tone,
}: {
  lo: number
  hi: number
  d: number
  tone: string
}) {
  const x = (v: number) => ((v + 1) / 2) * 100
  return (
    <svg className={styles.mini} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect x={x(-0.1)} y="0" width={x(0.1) - x(-0.1)} height="10" fill="rgba(236,229,216,0.06)" />
      <line x1="50" x2="50" y1="0" y2="10" stroke="rgba(236,229,216,0.35)" strokeWidth="0.6" />
      <rect
        x={x(lo)}
        y="3.5"
        width={Math.max(0.8, x(hi) - x(lo))}
        height="3"
        fill={tone}
        opacity="0.55"
      />
      <rect x={x(d) - 0.6} y="1.5" width="1.2" height="7" fill={tone} />
    </svg>
  )
}

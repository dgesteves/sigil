/**
 * The instrument behind the light: evidence bands, sector ticks, a coverage arc on the rim (real
 * counts only) and labels. Redrawn every frame because the disk turns.
 */
import type { FieldEngine } from './engine'
import { BANDS, type FieldLayout } from './layout'

const COVERAGE_RGBA: Record<string, string> = {
  proven: 'rgba(255,170,69,0.95)',
  measured: 'rgba(217,199,163,0.6)',
  listed: 'rgba(236,229,216,0.28)',
  open: 'rgba(236,229,216,0.07)',
}

export function drawGraticule(
  ctx: CanvasRenderingContext2D,
  engine: FieldEngine,
  layout: FieldLayout,
  dpr: number,
  fonts: { mono: string },
  hover: string | null,
) {
  const { w, h } = engine
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const oracle = engine.oracle ? 0.45 : 1
  // Labels belong to the field; while the Oracle answers, they step back entirely.
  const labelsOn = engine.oracle ? 0 : 1

  // The singularity: a faint warm well where intent meets evidence.
  const c = engine.toScreen(0, 0)
  const breathe = engine.reduced ? 1 : 0.85 + 0.15 * Math.sin(engine.time * 0.6)
  const well = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.min(w, h) * 0.55)
  well.addColorStop(0, `rgba(255,150,60,${0.075 * breathe})`)
  well.addColorStop(0.45, `rgba(255,120,40,${0.025 * breathe})`)
  well.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = well
  ctx.fillRect(0, 0, w, h)

  const ring = (r: number, alpha: number, dash: number[] = [], lensed = false) => {
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2
      const p = engine.polar(a, lensed ? engine.lens(a, r) : r)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.setLineDash(dash)
    ctx.strokeStyle = `rgba(236,229,216,${alpha * oracle})`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }
  ring(BANDS.proven[0] - 0.02, 0.07, [2, 6], true)
  ring(BANDS.inconclusive[0] - 0.015, 0.055, [2, 6], true)
  ring(BANDS.untested[0] - 0.01, 0.045, [2, 6], true)
  ring(1, 0.16)
  ring(1.045, 0.05)
  const unplaced = layout.place.filter((p) => p < 0).length
  if (unplaced) ring(1.105, 0.035, [1, 5])

  // Sector ticks.
  ctx.lineWidth = 1
  for (const s of layout.sectors) {
    const a = engine.polar(s.start, 1)
    const b = engine.polar(s.start, 1.03)
    ctx.strokeStyle = `rgba(236,229,216,${0.18 * oracle})`
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  for (const g of layout.groups) {
    for (const edge of [g.start, g.end]) {
      const a = engine.polar(edge, 1)
      const b = engine.polar(edge, 1.05)
      ctx.strokeStyle = `rgba(236,229,216,${0.26 * oracle})`
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }

  // Coverage arc: which sectors have proof, measurements, listings or nothing yet.
  ctx.lineCap = 'butt'
  for (const s of layout.sectors) {
    ctx.beginPath()
    const pad = (s.end - s.start) * 0.12
    for (let i = 0; i <= 8; i++) {
      const p = engine.polar(s.start + pad + ((s.end - s.start - 2 * pad) * i) / 8, 1.016)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.strokeStyle = COVERAGE_RGBA[s.coverage]!
    ctx.globalAlpha = oracle
    ctx.lineWidth = s.coverage === 'proven' ? 2.4 : s.coverage === 'open' ? 1 : 1.6
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Labels hang outward from the rim: left side right-aligned, right side left-aligned.
  // Dense axes label groups always and their sectors only near the pointer.
  const pointer = engine.pointer
  const centre = engine.toScreen(0, 0)
  const place = (theta: number, r: number) => {
    const p = engine.polar(theta, r)
    const dx = p.x - centre.x
    ctx.textAlign = dx > 24 ? 'left' : dx < -24 ? 'right' : 'center'
    ctx.textBaseline = p.y < centre.y - 8 ? 'bottom' : p.y > centre.y + 8 ? 'top' : 'middle'
    return p
  }
  const small = engine.compact ? 8.5 : 9.5
  for (const g of layout.groups) {
    const p = place((g.start + g.end) / 2, 1.22)
    ctx.font = `500 ${engine.compact ? 8.5 : 10}px ${fonts.mono}`
    ctx.fillStyle = `rgba(214,206,192,${0.95 * labelsOn * depthFade(p.depth, engine)})`
    const label = (engine.compact ? g.short : g.label).toUpperCase()
    letterSpaced(ctx, label, clampX(ctx, label, p.x, w, 1.8), p.y, 1.8)
  }
  for (const s of layout.sectors) {
    const mid = (s.start + s.end) / 2
    const probe = engine.polar(mid, 1.06)
    let alpha = layout.denseLabels ? 0 : 0.8
    if (layout.denseLabels && pointer.active) {
      const d = Math.hypot(probe.x - pointer.x, probe.y - pointer.y)
      alpha = Math.max(0, 1 - d / 170) * 0.95
    }
    if (!layout.groups.length && s.count > 0) alpha = Math.max(alpha, 0.72)
    if (hover === s.key) alpha = 1
    alpha *= labelsOn * depthFade(probe.depth, engine)
    if (alpha < 0.02) continue
    const p = place(mid, layout.groups.length ? 1.05 : 1.2)
    ctx.font = `400 ${small}px ${fonts.mono}`
    ctx.fillStyle = `rgba(236,229,216,${alpha})`
    const text = `${s.label.toUpperCase()}${s.count ? ` · ${s.count}` : ''}`
    letterSpaced(ctx, text, clampX(ctx, text, p.x, w, 0.8), p.y, 0.8)
  }
  if (unplaced && labelsOn) {
    const p = engine.polar(Math.PI * 0.82, 1.15)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = `400 ${small}px ${fonts.mono}`
    ctx.fillStyle = 'rgba(144,138,127,0.85)'
    const text = `${(UNPLACED[layout.dimension] ?? 'other').toUpperCase()} · ${unplaced}`
    letterSpaced(ctx, text, clampX(ctx, text, p.x, w, 0.8), p.y + 6, 0.8)
  }
}

const UNPLACED: Record<string, string> = {
  industry: 'industry-agnostic',
  lifecycle: 'no stage declared',
  domain: 'no discipline',
  type: 'untyped',
}

/** Keeps a label inside the canvas, whatever its alignment. */
function clampX(ctx: CanvasRenderingContext2D, text: string, x: number, w: number, track: number) {
  const width = ctx.measureText(text).width + text.length * track
  const left = ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x - width : x - width / 2
  const shift = Math.max(0, 8 - left) - Math.max(0, left + width - (w - 8))
  return x + shift
}

/** The far side of the disk is dimmer, like any lit scene with depth. */
function depthFade(depth: number, engine: FieldEngine) {
  const d0 = engine.camera.dist
  return Math.max(0.45, Math.min(1, 1 - (depth - d0) * 0.6))
}

function letterSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  track: number,
) {
  // letterSpacing is newer than the rest of Canvas2D; without it, labels are simply untracked.
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if (c.letterSpacing !== undefined) c.letterSpacing = `${track}px`
  ctx.fillText(text, x, y)
  if (c.letterSpacing !== undefined) c.letterSpacing = '0px'
}

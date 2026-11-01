/**
 * The sigil: a deterministic mark drawn from a payload digest. Same content, same sigil; one changed
 * byte, a visibly different one. Pure geometry with no DOM and no I/O, so the CLI, the site and the
 * social images all draw the identical mark.
 *
 * Construction, all decided by the digest bits in order:
 *
 *   1. a symmetry order k (3-8) and whether the figure is mirrored (dihedral) or spun (chiral)
 *   2. a polar lattice: 5 radii x half-wedge angles; a short walk on it is the motif, the one
 *      "pen stroke" a human remembers
 *   3. the motif is repeated k times (and reflected, if mirrored), duplicates removed
 *   4. ornaments: an outer frame (none, full, broken, beaded), an inner ring and a core mark
 *
 * Geometry lives in a 100 x 100 box centred on the origin (viewBox "-50 -50 100 100"), angle 0
 * pointing up. The bits read come from the start of the digest; sha256's avalanche means any content
 * change flips them with overwhelming probability. Changing this algorithm changes every sigil, so it
 * is versioned like the spec.
 */

export const GLYPH_VERSION = 1 as const
export const GLYPH_VIEWBOX = '-50 -50 100 100' as const

/** Ring radii of the lattice, centre first. */
const RADII = [0, 14, 24, 33, 41] as const
const FRAME_R = 46.5
/** Segments after symmetry expansion. Above this a sigil turns into lace at 16px. */
const MAX_SEGMENTS = 44
const DOT_R = 2.9

export interface GlyphPoint {
  x: number
  y: number
}

export type GlyphStroke =
  | { kind: 'line'; from: GlyphPoint; to: GlyphPoint }
  /** Arc around the origin from angle `start` to `end` (radians, clockwise from up). */
  | { kind: 'arc'; r: number; start: number; end: number }
  | { kind: 'circle'; r: number; cx: number; cy: number }

export interface GlyphDot extends GlyphPoint {
  r: number
}

export type FrameStyle = 'none' | 'full' | 'broken' | 'beaded'
export type CoreStyle = 'none' | 'dot' | 'ring' | 'polygon'

export interface Glyph {
  version: typeof GLYPH_VERSION
  digest: `sha256:${string}`
  /** Rotational order of the figure. */
  symmetry: number
  /** Dihedral (mirrored) or chiral (rotation only). */
  mirror: boolean
  frame: FrameStyle
  core: CoreStyle
  /** Inner ring radius, or 0 when there is none. */
  innerRing: number
  /** Every stroke after symmetry expansion, in draw order: core, inner ring, motif, frame. */
  strokes: GlyphStroke[]
  /** Filled dots (walk terminals, beads, the core dot). */
  dots: GlyphDot[]
  /** SVG path data for all strokes, coordinates rounded to 0.01. Stroke it; fill the dots. */
  path: string
  /** The strokes flattened to polylines (arcs sampled every <= 6 degrees), for raster and particle renderers. */
  polylines: GlyphPoint[][]
  /** Recommended stroke width in viewBox units at 64px and above. Use `glyphWeight(size)` for smaller sizes. */
  weight: number
  /** Compact structural fingerprint: the features a human would use to tell two sigils apart. */
  signature: string
}

const DIGEST_RE = /^(?:sha256:)?([a-f0-9]{64})$/

/** Draws the sigil for a payload digest (`sha256:<hex>` or bare hex). Throws on anything else. */
export function glyph(digest: string): Glyph {
  const m = DIGEST_RE.exec(digest)
  if (!m) throw new TypeError(`expected sha256:<64 hex>, got ${JSON.stringify(digest)}`)
  const hex = m[1]!
  const bits = new BitReader(hex)

  const symmetry = 3 + (bits.take(8) % 6)
  const mirror = bits.take(1) === 1
  const tilt = bits.take(1) === 1 // rotate by half a wedge: a spoke or a gap points up
  const frame = (['none', 'full', 'broken', 'beaded'] as const)[bits.take(2)]!
  const innerPick = bits.take(2)
  const innerRing = innerPick === 1 ? RADII[1] : innerPick === 2 ? RADII[2] : 0
  const core = (['none', 'dot', 'ring', 'polygon'] as const)[bits.take(2)]!

  const wedge = (2 * Math.PI) / symmetry
  const half = wedge / 2
  const theta0 = tilt ? half : 0
  const copies = symmetry * (mirror ? 2 : 1)

  // The motif: a walk on the fundamental domain of the lattice.
  const maxJ = mirror ? 1 : 2
  const lattice: Lattice[] = [{ i: 0, j: 0 }]
  for (let i = 1; i < RADII.length; i++) for (let j = 0; j <= maxJ; j++) lattice.push({ i, j })
  // Busy symmetry groups get shorter walks, so every sigil stays readable at 16px.
  const shortest = copies >= 12 ? 1 : 2
  const longest = Math.max(shortest + 1, Math.min(5, Math.floor(MAX_SEGMENTS / copies)))
  const length = shortest + bits.pick(longest - shortest + 1)
  const used = new Set<string>()
  const walk = (from: Lattice, steps: number): Lattice[] => {
    let at = from
    const out = [at]
    for (let s = 0; s < steps; s++) {
      const options = lattice.filter((p) => !samePoint(p, at) && !used.has(edgeKey(at, p)))
      if (options.length === 0) break
      const next = options[bits.pick(options.length)]!
      used.add(edgeKey(at, next))
      out.push(next)
      at = next
    }
    return out
  }
  const walks = [walk(lattice[1 + bits.pick(lattice.length - 1)]!, length)]
  // A second, detached pen stroke, when the segment budget has room for it.
  if ((length + 1) * copies <= MAX_SEGMENTS + 4 && bits.take(1) === 1) {
    walks.push(walk(lattice[1 + bits.pick(lattice.length - 1)]!, 1))
  }
  // Read only when they can change the drawing, so no bit is spent on a no-op.
  const styles = walks.map((w) =>
    w.slice(1).map((q, s) => {
      const p = w[s]!
      return p.i === q.i && p.i > 0 ? (bits.take(1) === 1 ? 'a' : 'l') : '-'
    }),
  )
  const terminals = walks[0]!.at(-1)!.i > 0 && bits.take(1) === 1
  const ticks = bits.take(1) === 1

  const strokes: GlyphStroke[] = []
  const dots: GlyphDot[] = []
  const seen = new Set<string>()
  const pushStroke = (s: GlyphStroke) => {
    const key = strokeKey(s)
    if (seen.has(key)) return
    seen.add(key)
    strokes.push(s)
  }
  const pushDot = (d: GlyphDot) => {
    const key = `d${r2(d.x)},${r2(d.y)}`
    if (seen.has(key)) return
    seen.add(key)
    dots.push(d)
  }

  // Core
  if (core === 'dot') pushDot({ x: 0, y: 0, r: 3.6 })
  else if (core === 'ring') pushStroke({ kind: 'circle', cx: 0, cy: 0, r: 5.5 })
  else if (core === 'polygon') {
    for (let n = 0; n < symmetry; n++) {
      const a = theta0 + n * wedge
      pushStroke({ kind: 'line', from: polar(7, a), to: polar(7, a + wedge) })
    }
  }
  if (innerRing) pushStroke({ kind: 'circle', cx: 0, cy: 0, r: innerRing })

  // Motif, repeated around the symmetry group
  for (let n = 0; n < symmetry; n++) {
    for (const flip of mirror ? [1, -1] : [1]) {
      const angle = (p: Lattice) => theta0 + n * wedge + flip * p.j * half
      walks.forEach((w, k) => {
        for (let s = 1; s < w.length; s++) {
          const p = w[s - 1]!
          const q = w[s]!
          if (styles[k]![s - 1] === 'a') pushStroke(normalArc(RADII[p.i]!, angle(p), angle(q)))
          else
            pushStroke({
              kind: 'line',
              from: polar(RADII[p.i]!, angle(p)),
              to: polar(RADII[q.i]!, angle(q)),
            })
        }
      })
      if (terminals) {
        const end = walks[0]!.at(-1)!
        pushDot({ ...polar(RADII[end.i]!, angle(end)), r: DOT_R })
      }
    }
  }

  // Frame
  if (frame === 'full') pushStroke({ kind: 'circle', cx: 0, cy: 0, r: FRAME_R })
  else if (frame === 'broken') {
    const gap = Math.min(0.28, wedge * 0.18)
    for (let n = 0; n < symmetry; n++) {
      const a = theta0 + n * wedge
      pushStroke({ kind: 'arc', r: FRAME_R, start: a + gap, end: a + wedge - gap })
    }
  } else if (frame === 'beaded') {
    for (let n = 0; n < symmetry; n++)
      pushDot({ ...polar(FRAME_R, theta0 + half + n * wedge), r: 2.4 })
  }
  // Gate ticks on the spoke axes, sitting in a broken frame's gaps.
  if (ticks) {
    for (let n = 0; n < symmetry; n++) {
      const a = theta0 + n * wedge
      pushStroke({ kind: 'line', from: polar(FRAME_R - 4.5, a), to: polar(FRAME_R + 0.5, a) })
    }
  }

  const segments = strokes.length
  const signature = [
    `k${symmetry}`,
    mirror ? 'm' : 'c',
    tilt ? 't' : 'u',
    `f${frame[0]}`,
    `i${innerRing}`,
    `o${core[0]}`,
    terminals ? 'd' : '-',
    ticks ? 'g' : '-',
    walks.map((w, k) => `${w.map(pointKey).join('>')}${styles[k]!.join('')}`).join('+'),
  ].join(' ')

  return {
    version: GLYPH_VERSION,
    digest: `sha256:${hex}`,
    symmetry,
    mirror,
    frame,
    core,
    innerRing,
    strokes,
    dots,
    path: strokes.map(strokePath).join(''),
    polylines: strokes.map(flatten),
    weight: segments > 30 ? 3.1 : 3.6,
    signature,
  }
}

/**
 * Stroke width in viewBox units for a sigil drawn `sizePx` wide, so lines never fall below about
 * 1.2 device pixels. Thin lines are what make small sigils unreadable.
 */
export function glyphWeight(g: Pick<Glyph, 'weight'>, sizePx: number): number {
  return Math.max(g.weight, (1.25 * 100) / Math.max(1, sizePx))
}

export interface GlyphSvgOptions {
  /** Rendered width and height in px. Default 64. */
  size?: number
  /** Stroke and dot colour. Default currentColor. */
  color?: string
  /** Override the stroke width (viewBox units). */
  weight?: number
  /** Accessible name. Without one the SVG is decorative (aria-hidden). */
  title?: string
}

/** A standalone SVG string for a digest or a computed glyph. */
export function glyphSvg(input: string | Glyph, opts: GlyphSvgOptions = {}): string {
  const g = typeof input === 'string' ? glyph(input) : input
  const size = opts.size ?? 64
  const color = opts.color ?? 'currentColor'
  const weight = opts.weight ?? glyphWeight(g, size)
  const w = r2(weight)
  const a11y = opts.title
    ? `role="img" aria-label="${escapeXml(opts.title)}"`
    : 'aria-hidden="true" focusable="false"'
  const dots = g.dots
    .map(
      (d) => `<circle cx="${r2(d.x)}" cy="${r2(d.y)}" r="${r2(d.r * Math.max(1, weight / 3.6))}"/>`,
    )
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GLYPH_VIEWBOX}" width="${size}" height="${size}" ${a11y}>` +
    (opts.title ? `<title>${escapeXml(opts.title)}</title>` : '') +
    `<path d="${g.path}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g fill="${color}">${dots}</g></svg>`
  )
}

/* ---------------------------------------------------------------------------------------------- */

interface Lattice {
  /** Ring index into RADII; 0 is the centre. */
  i: number
  /** Half-wedge steps from the wedge axis. */
  j: number
}

class BitReader {
  private bits: number[] = []
  private pos = 0
  constructor(hex: string) {
    for (const ch of hex) {
      const v = Number.parseInt(ch, 16)
      for (let b = 3; b >= 0; b--) this.bits.push((v >> b) & 1)
    }
  }
  /** A uniform-ish choice among n options, spending only the bits n needs. */
  pick(n: number): number {
    if (n <= 1) return 0
    return this.take(Math.ceil(Math.log2(n))) % n
  }
  take(n: number): number {
    let v = 0
    for (let k = 0; k < n; k++) {
      // 256 bits is far more than a sigil reads; wrapping keeps the reader total.
      v = (v << 1) | this.bits[this.pos++ % this.bits.length]!
    }
    return v
  }
}

const samePoint = (a: Lattice, b: Lattice) => a.i === b.i && (a.i === 0 || a.j === b.j)
const pointKey = (p: Lattice) => (p.i === 0 ? '0' : `${p.i}.${p.j}`)
const edgeKey = (a: Lattice, b: Lattice) => [pointKey(a), pointKey(b)].sort().join('-')

function polar(r: number, a: number): GlyphPoint {
  return { x: clean(r * Math.sin(a)), y: clean(-r * Math.cos(a)) }
}

/** Arcs always run clockwise from start to end, the short way round. */
function normalArc(r: number, a1: number, a2: number): GlyphStroke {
  let d = a2 - a1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d >= 0
    ? { kind: 'arc', r, start: a1, end: a1 + d }
    : { kind: 'arc', r, start: a1 + d, end: a1 }
}

function strokeKey(s: GlyphStroke): string {
  if (s.kind === 'circle') return `c${r2(s.cx)},${r2(s.cy)},${r2(s.r)}`
  if (s.kind === 'line') {
    const a = `${r2(s.from.x)},${r2(s.from.y)}`
    const b = `${r2(s.to.x)},${r2(s.to.y)}`
    return `l${[a, b].sort().join('|')}`
  }
  const p = polar(s.r, s.start)
  const q = polar(s.r, s.end)
  return `a${r2(s.r)}|${r2(p.x)},${r2(p.y)}|${r2(q.x)},${r2(q.y)}`
}

function strokePath(s: GlyphStroke): string {
  if (s.kind === 'line') return `M${r2(s.from.x)} ${r2(s.from.y)}L${r2(s.to.x)} ${r2(s.to.y)}`
  if (s.kind === 'circle') {
    const { cx, cy, r } = s
    return `M${r2(cx)} ${r2(cy - r)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx)} ${r2(cy + r)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx)} ${r2(cy - r)}`
  }
  const p = polar(s.r, s.start)
  const q = polar(s.r, s.end)
  const large = s.end - s.start > Math.PI ? 1 : 0
  return `M${r2(p.x)} ${r2(p.y)}A${r2(s.r)} ${r2(s.r)} 0 ${large} 1 ${r2(q.x)} ${r2(q.y)}`
}

function flatten(s: GlyphStroke): GlyphPoint[] {
  if (s.kind === 'line') return [s.from, s.to]
  const step = Math.PI / 30
  if (s.kind === 'circle') {
    const out: GlyphPoint[] = []
    for (let n = 0; n <= 60; n++) {
      const a = n * step
      out.push({ x: clean(s.cx + s.r * Math.sin(a)), y: clean(s.cy - s.r * Math.cos(a)) })
    }
    return out
  }
  const n = Math.max(1, Math.ceil((s.end - s.start) / step))
  const out: GlyphPoint[] = []
  for (let k = 0; k <= n; k++) out.push(polar(s.r, s.start + ((s.end - s.start) * k) / n))
  return out
}

/** Rounds away float noise so that mirrored copies dedupe and output is stable across engines. */
function clean(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}

function r2(v: number): string {
  const r = Math.round(v * 100) / 100
  return String(Object.is(r, -0) ? 0 : r)
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
}

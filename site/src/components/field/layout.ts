/**
 * Where a capability sits in the observatory. Angle = the dimension being viewed (domain, industry,
 * lifecycle stage, type); radius = evidence. Proven capabilities orbit closest to the intent at the
 * centre, untested ones drift at the rim, harmful ones are pushed past it.
 */
import type { Level, UpliftVerdict } from '@core/ids'
import {
  CAPABILITY_TYPES,
  type CapView,
  DOMAIN_GROUPS,
  humanize,
  INDUSTRIES,
  LIFECYCLE,
  TYPE_LABEL,
} from '@/lib/model'

export type Dimension = 'domain' | 'industry' | 'lifecycle' | 'type'

export const DIMENSIONS: { id: Dimension; label: string; key: string }[] = [
  { id: 'domain', label: 'Discipline', key: '1' },
  { id: 'industry', label: 'Industry', key: '2' },
  { id: 'lifecycle', label: 'Lifecycle', key: '3' },
  { id: 'type', label: 'Type', key: '4' },
]

export type Coverage = 'proven' | 'measured' | 'listed' | 'open'

export interface Sector {
  key: string
  label: string
  /** Radians, clockwise from 12 o'clock. */
  start: number
  end: number
  count: number
  coverage: Coverage
}

export interface Arc {
  label: string
  start: number
  end: number
}

export interface FieldLayout {
  dimension: Dimension
  sectors: Sector[]
  /** Larger labelled arcs (domain groups); empty when the sectors are few enough to label. */
  groups: Arc[]
  /** Sector index per node, or -1 when the node has no value on this axis (it drifts outside). */
  place: number[]
  /** Whether every sector is labelled all the time or only near the pointer. */
  denseLabels: boolean
}

const TAU = Math.PI * 2

export function coverageOf(caps: readonly CapView[]): Coverage {
  if (caps.length === 0) return 'open'
  if (caps.some((c) => c.uplift === 'proven')) return 'proven'
  if (caps.some((c) => c.uplift !== 'untested')) return 'measured'
  return 'listed'
}

function axis(dimension: Dimension): { keys: string[]; label: (k: string) => string } {
  switch (dimension) {
    case 'domain':
      return { keys: DOMAIN_GROUPS.flatMap((g) => g.domains), label: humanize }
    case 'industry':
      return { keys: [...INDUSTRIES], label: humanize }
    case 'lifecycle':
      return { keys: [...LIFECYCLE], label: humanize }
    case 'type':
      return { keys: [...CAPABILITY_TYPES], label: (k) => TYPE_LABEL[k as keyof typeof TYPE_LABEL] }
  }
}

function valuesOf(c: CapView, dimension: Dimension): readonly string[] {
  switch (dimension) {
    case 'domain':
      return c.domains
    case 'industry':
      return c.industries
    case 'lifecycle':
      return c.lifecycle
    case 'type':
      return [c.type]
  }
}

export function layout(caps: readonly CapView[], dimension: Dimension): FieldLayout {
  const { keys, label } = axis(dimension)
  const gap = dimension === 'domain' ? 0.035 : 0
  const groupCount = dimension === 'domain' ? DOMAIN_GROUPS.length : 0
  const usable = TAU - gap * groupCount
  const step = usable / keys.length
  const sectors: Sector[] = []
  const groups: Arc[] = []
  let a = gap / 2
  if (dimension === 'domain') {
    for (const g of DOMAIN_GROUPS) {
      const start = a
      for (const d of g.domains) {
        sectors.push({
          key: d,
          label: label(d),
          start: a,
          end: a + step,
          count: 0,
          coverage: 'open',
        })
        a += step
      }
      groups.push({ label: g.label, start, end: a })
      a += gap
    }
  } else {
    for (const k of keys) {
      sectors.push({ key: k, label: label(k), start: a, end: a + step, count: 0, coverage: 'open' })
      a += step
    }
  }
  const index = new Map(sectors.map((s, i) => [s.key, i]))
  // A capability is placed by its first value on the axis: authors list the primary one first.
  const place = caps.map((c) => index.get(valuesOf(c, dimension)[0] ?? '') ?? -1)
  for (const s of sectors) {
    const members = caps.filter((c) => valuesOf(c, dimension).includes(s.key))
    s.count = members.length
    s.coverage = coverageOf(members)
  }
  return { dimension, sectors, groups, place, denseLabels: sectors.length > 14 }
}

/** Radial band per verdict, as a fraction of the rim radius. */
export const BANDS: Record<UpliftVerdict, [number, number]> = {
  proven: [0.42, 0.54],
  inconclusive: [0.57, 0.7],
  'no-effect': [0.62, 0.72],
  untested: [0.73, 0.9],
  harmful: [0.95, 1.04],
}

export function bandOf(verdict: UpliftVerdict, level: Level, placed: boolean): [number, number] {
  if (level === 'revoked') return [1.0, 1.08]
  if (!placed) return [1.1, 1.2]
  return BANDS[verdict]
}

/** Deterministic 0..1 values from a digest, so a capability always sits in the same spot. */
export function jitter(digest: string, k: number): number {
  // The glyph reads the leading bits; positions read the tail, so the two never correlate.
  const hex = digest.replace(/^sha256:/, '')
  const at = 56 - (k % 6) * 8
  return Number.parseInt(hex.slice(at, at + 8), 16) / 0xffffffff
}

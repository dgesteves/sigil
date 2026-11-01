import type { UpliftVerdict } from './ids.js'
import type { Tally } from './schema.js'

/** z for a two-sided 95% interval. */
const Z = 1.959963984540054

/** Wilson score interval for k successes in n trials. Well behaved at 0, n and small n. */
export function wilson(k: number, n: number, z = Z): [number, number] {
  if (n <= 0) return [0, 1]
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

/**
 * Newcombe's hybrid score interval (method 10) for the difference of two independent proportions,
 * p2 - p1. Recommended over the Wald interval, which collapses at small n and extreme rates.
 */
export function newcombe(k1: number, n1: number, k2: number, n2: number): [number, number] {
  const p1 = k1 / n1
  const p2 = k2 / n2
  const [l1, u1] = wilson(k1, n1)
  const [l2, u2] = wilson(k2, n2)
  const d = p2 - p1
  const lower = d - Math.sqrt((p2 - l2) ** 2 + (u1 - p1) ** 2)
  const upper = d + Math.sqrt((u2 - p2) ** 2 + (p1 - l1) ** 2)
  return [Math.max(-1, lower), Math.min(1, upper)]
}

export interface Pooled {
  baseline: { passed: number; runs: number }
  treatment: { passed: number; runs: number }
  delta: number
  ci95: [number, number]
  verdict: UpliftVerdict
}

/** Smallest effect we call "no effect" when the whole interval sits inside ±this band. */
export const EQUIVALENCE_MARGIN = 0.1
/** Below this many runs per condition we never issue a verdict other than inconclusive. */
export const MIN_RUNS = 6

/**
 * Pools a suite's tasks into one comparison. Tampered runs and false "done" claims already count
 * as failures in `passed`; they are tracked separately for display.
 */
export function pool(tasks: readonly { baseline: Tally; treatment: Tally }[]): Pooled {
  const sum = (pick: (t: { baseline: Tally; treatment: Tally }) => Tally) =>
    tasks.reduce(
      (acc, t) => ({ passed: acc.passed + pick(t).passed, runs: acc.runs + pick(t).runs }),
      { passed: 0, runs: 0 },
    )
  const baseline = sum((t) => t.baseline)
  const treatment = sum((t) => t.treatment)
  if (baseline.runs === 0 || treatment.runs === 0) {
    return { baseline, treatment, delta: 0, ci95: [-1, 1], verdict: 'untested' }
  }
  const delta = treatment.passed / treatment.runs - baseline.passed / baseline.runs
  const ci95 = newcombe(baseline.passed, baseline.runs, treatment.passed, treatment.runs)
  return {
    baseline,
    treatment,
    delta,
    ci95,
    verdict: verdictFor(ci95, baseline.runs, treatment.runs),
  }
}

export function verdictFor(
  ci95: [number, number],
  nBaseline: number,
  nTreatment: number,
): UpliftVerdict {
  if (Math.min(nBaseline, nTreatment) < MIN_RUNS) return 'inconclusive'
  const [lo, hi] = ci95
  if (lo > 0) return 'proven'
  if (hi < 0) return 'harmful'
  if (lo >= -EQUIVALENCE_MARGIN && hi <= EQUIVALENCE_MARGIN) return 'no-effect'
  return 'inconclusive'
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

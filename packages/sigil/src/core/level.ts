import type { Level, UpliftVerdict } from './ids.js'
import type { Evidence } from './schema.js'

export interface LevelInput {
  digest: string | undefined
  evidence: Evidence | undefined
}

/**
 * The trust ladder, computed, never declared. Evidence for a different digest counts for nothing:
 * editing a verified capability drops it back to `submitted` until the new content is checked.
 */
export function levelOf({ digest, evidence }: LevelInput): Level {
  if (evidence?.revoked) return 'revoked'
  if (!evidence || !digest || evidence.digest !== digest) return 'submitted'
  const ok = (s: string) => s === 'pass' || s === 'warn'
  if (!ok(evidence.structure.status) || !ok(evidence.security.status)) return 'submitted'
  const blocking = evidence.security.findings.some(
    (f) => f.severity === 'high' || f.severity === 'critical',
  )
  if (blocking) return 'submitted'
  const latestReview = [...evidence.reviews].sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  const reviewed = latestReview?.decision === 'approved'
  if (latestReview?.decision === 'revoked') return 'revoked'
  if (evidence.canary?.status === 'pass' && reviewed) return 'verified'
  return 'validated'
}

/** One verdict per capability: any harm wins, then proof, then a consistent null result. */
export function upliftOf(
  evidence: Evidence | undefined,
  digest: string | undefined,
): UpliftVerdict {
  if (!evidence || evidence.digest !== digest || evidence.uplift.length === 0) return 'untested'
  const verdicts = evidence.uplift.map((u) => u.verdict)
  if (verdicts.includes('harmful')) return 'harmful'
  if (verdicts.includes('proven')) return 'proven'
  if (verdicts.every((v) => v === 'no-effect')) return 'no-effect'
  return 'inconclusive'
}

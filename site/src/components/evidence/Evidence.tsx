/**
 * Evidence graphics. Every mark is a recorded count or a computed interval; nothing is smoothed,
 * extrapolated or decorated into a number it is not.
 */
import { AGENTS, type AgentId, type UpliftVerdict } from '@core/ids'
import type { Evidence, Manifest, UpliftRun } from 'sigil/core'
import { AGENT_LABEL, type LEVEL, pp, type UpliftSummary, VERDICT } from '@/lib/model'
import styles from './evidence.module.css'

const X = (v: number, w: number, pad: number) => pad + ((v + 1) / 2) * (w - 2 * pad)

/** Point estimate and 95% interval per uplift run, on one fixed axis so capabilities compare. */
export function IntervalChart({ runs }: { runs: UpliftSummary[] }) {
  const W = 760
  const PAD = 26
  const ROW = 46
  const top = 18
  const H = top + runs.length * ROW + 28
  const ticks = [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]
  return (
    <figure className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="ic-title ic-desc">
        <title id="ic-title">Uplift, treatment minus baseline, percentage points</title>
        <desc id="ic-desc">
          {runs
            .map(
              (r) =>
                `${r.suite} with ${r.agent}: ${pp(r.delta)} points, 95% interval ${pp(r.ci95[0])} to ${pp(r.ci95[1])}, ${r.verdict}`,
            )
            .join('. ')}
        </desc>
        <rect
          x={X(-0.1, W, PAD)}
          y={top - 8}
          width={X(0.1, W, PAD) - X(-0.1, W, PAD)}
          height={runs.length * ROW + 8}
          className={styles.band}
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={X(t, W, PAD)}
              x2={X(t, W, PAD)}
              y1={top - 8}
              y2={top + runs.length * ROW}
              className={t === 0 ? styles.zero : styles.grid}
            />
            <text x={X(t, W, PAD)} y={H - 8} className={styles.tick} textAnchor="middle">
              {t === 0 ? '0' : pp(t)}
            </text>
          </g>
        ))}
        {runs.map((r, i) => {
          const y = top + i * ROW + ROW / 2 - 4
          const tone = VERDICT[r.verdict].tone
          const x0 = X(r.ci95[0], W, PAD)
          const x1 = X(r.ci95[1], W, PAD)
          const xd = X(r.delta, W, PAD)
          return (
            <g key={`${r.suite}-${r.agent}-${r.model}`}>
              <title>{`${r.suite} · ${r.agent} · ${r.model}: ${pp(r.delta)} [${pp(r.ci95[0])}, ${pp(r.ci95[1])}] · ${r.baseline.passed}/${r.baseline.runs} → ${r.treatment.passed}/${r.treatment.runs}`}</title>
              <rect x={PAD} y={y - 16} width={W - 2 * PAD} height={32} fill="transparent" />
              <line
                x1={x0}
                x2={x1}
                y1={y}
                y2={y}
                stroke={tone}
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.5}
              />
              <line x1={x0} x2={x0} y1={y - 8} y2={y + 8} stroke={tone} strokeWidth={1.5} />
              <line x1={x1} x2={x1} y1={y - 8} y2={y + 8} stroke={tone} strokeWidth={1.5} />
              <circle
                cx={xd}
                cy={y}
                r={7}
                fill={tone}
                className={r.verdict === 'proven' ? styles.glow : undefined}
              />
              <circle cx={xd} cy={y} r={7} fill="none" stroke="var(--void)" strokeWidth={2} />
              <text x={x0 - 8} y={y + 4} textAnchor="end" className={styles.lab}>
                {pp(r.ci95[0])}
              </text>
              <text x={x1 + 8} y={y + 4} className={styles.lab}>
                {pp(r.ci95[1])}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className={styles.caption}>
        Treatment minus baseline pass rate, percentage points. Bars are 95% Newcombe intervals; the
        shaded band is ±10, where a whole interval means “no effect”. The verdict follows from the
        interval, never from the dot.
      </figcaption>
    </figure>
  )
}

/** One dot per run, passes first. Counts are recorded; the order is only for reading. */
function Strip({
  passed,
  runs,
  tampered,
  falseDone,
  tone,
}: {
  passed: number
  runs: number
  tampered: number
  falseDone: number
  tone: string
}) {
  const dots = Array.from({ length: runs }, (_, i) => ({
    id: `run-${i}`,
    kind:
      i < passed
        ? 'pass'
        : i < passed + tampered
          ? 'tampered'
          : i < passed + tampered + falseDone
            ? 'false'
            : 'fail',
  }))
  return (
    <span
      className={styles.strip}
      role="img"
      aria-label={`${passed} of ${runs} passed${tampered ? `, ${tampered} tampered` : ''}${falseDone ? `, ${falseDone} falsely claimed done` : ''}`}
    >
      {dots.map((d) => (
        <span
          key={d.id}
          className={styles.dot}
          data-kind={d.kind}
          style={d.kind === 'pass' ? { background: tone, boxShadow: `0 0 6px ${tone}` } : undefined}
        />
      ))}
    </span>
  )
}

export function TaskTable({
  tasks,
  verdict,
}: {
  tasks: UpliftRun['tasks']
  verdict: UpliftVerdict
}) {
  const tone = VERDICT[verdict].tone
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">task</th>
            <th scope="col">baseline</th>
            <th scope="col">with capability</th>
            <th scope="col" className={styles.r}>
              Δ pts
            </th>
            <th scope="col" className={styles.r}>
              median tokens
            </th>
            <th scope="col" className={styles.r}>
              median s
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const d = t.treatment.passed / t.treatment.runs - t.baseline.passed / t.baseline.runs
            return (
              <tr key={t.task}>
                <th scope="row">{t.task}</th>
                <td>
                  <Strip {...t.baseline} tone="var(--bone-2)" />
                  <span className="num">
                    {t.baseline.passed}/{t.baseline.runs}
                  </span>
                </td>
                <td>
                  <Strip {...t.treatment} tone={tone} />
                  <span className="num">
                    {t.treatment.passed}/{t.treatment.runs}
                  </span>
                </td>
                <td className={`${styles.r} num`}>{pp(d)}</td>
                <td className={`${styles.r} num`}>
                  {fmt(t.baseline.medianTokens)} → {fmt(t.treatment.medianTokens)}
                </td>
                <td className={`${styles.r} num`}>
                  {fmt(t.baseline.medianSeconds)} → {fmt(t.treatment.medianSeconds)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.key}>
        <span className={styles.dot} data-kind="pass" style={{ background: tone }} /> passed hidden
        tests
        <span className={styles.dot} data-kind="fail" /> failed
        <span className={styles.dot} data-kind="tampered" /> tampered with protected tests (counted
        as failed)
        <span className={styles.dot} data-kind="false" /> claimed done, verifier failed
      </p>
    </div>
  )
}

const fmt = (v: number | undefined) =>
  v === undefined
    ? '—'
    : v >= 1000
      ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
      : String(Math.round(v))

/** The trust ladder with what each rung needs, checked against the evidence for this digest. */
export function Ladder({
  level,
  evidence,
  digest,
}: {
  level: keyof typeof LEVEL
  evidence?: Evidence
  digest: string
}) {
  const ev = evidence && evidence.digest === digest ? evidence : undefined
  const ok = (s?: string) => s === 'pass' || s === 'warn'
  const blocking = ev?.security.findings.some(
    (f) => f.severity === 'high' || f.severity === 'critical',
  )
  const review = ev ? [...ev.reviews].sort((a, b) => a.at.localeCompare(b.at)).at(-1) : undefined
  const rungs = [
    {
      id: 'submitted',
      label: 'Submitted',
      checks: [['in the catalog', true]] as [string, boolean][],
    },
    {
      id: 'validated',
      label: 'Validated',
      checks: [
        ['structure check', ok(ev?.structure.status)],
        ['static scan, no high findings', ok(ev?.security.status) && !blocking],
      ] as [string, boolean][],
    },
    {
      id: 'verified',
      label: 'Verified',
      checks: [
        ['canary sandbox passed', ev?.canary?.status === 'pass'],
        ['maintainer approved', review?.decision === 'approved'],
      ] as [string, boolean][],
    },
  ]
  const reached = level === 'revoked' ? -1 : rungs.findIndex((r) => r.id === level)
  return (
    <div className={styles.ladder} data-revoked={level === 'revoked'}>
      {rungs.map((r, i) => (
        <div key={r.id} className={styles.rung} data-on={i <= reached} data-current={i === reached}>
          <span className={styles.rungName}>{r.label}</span>
          <ul>
            {r.checks.map(([c, pass]) => (
              <li key={c} data-pass={pass}>
                <span aria-hidden="true">{pass ? '●' : '○'}</span> {c}
                <span className="sr-only">{pass ? ': met' : ': not met'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {level === 'revoked' && ev?.revoked ? (
        <p className={styles.revoked}>
          Revoked {ev.revoked.at.slice(0, 10)}: {ev.revoked.reason}
        </p>
      ) : null}
    </div>
  )
}

/** Targeted, compiled and evaluated are three different claims. Blank means no record, not "no". */
export function CompatMatrix({
  manifest,
  evidence,
  digest,
}: {
  manifest: Manifest
  evidence?: Evidence
  digest: string
}) {
  const ev = evidence && evidence.digest === digest ? evidence : undefined
  const rows = AGENTS.filter((a) => manifest.targets.includes(a) || ev?.compat[a])
  const cell = (v: boolean | undefined, label: string) =>
    v === undefined ? (
      <td className={styles.none}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">no record for {label}</span>
      </td>
    ) : (
      <td data-yes={v}>
        <span aria-hidden="true">{v ? '●' : '○'}</span>
        <span className="sr-only">
          {label}: {v ? 'yes' : 'no'}
        </span>
      </td>
    )
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.compat}`}>
        <thead>
          <tr>
            <th scope="col">agent</th>
            <th scope="col">targeted by author</th>
            <th scope="col">compiled</th>
            <th scope="col">evaluated in the lab</th>
            <th scope="col">notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a: AgentId) => {
            const c = ev?.compat[a]
            return (
              <tr key={a}>
                <th scope="row">{AGENT_LABEL[a]}</th>
                {cell(manifest.targets.includes(a), 'targeted')}
                {cell(c?.compiled, 'compiled')}
                {cell(c?.evaluated, 'evaluated')}
                <td className={styles.note}>{c?.notes ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Verdict mark: a shape per verdict, so state never depends on colour alone. */
export function VerdictMark({ verdict, size = 10 }: { verdict: UpliftVerdict; size?: number }) {
  const tone = VERDICT[verdict].tone
  const s = size
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden="true" className={styles.mark}>
      {verdict === 'proven' ? <circle cx="5" cy="5" r="4.2" fill={tone} /> : null}
      {verdict === 'inconclusive' ? (
        <>
          <circle cx="5" cy="5" r="3.8" fill="none" stroke={tone} strokeWidth="1.2" />
          <path d="M5 1.2 A3.8 3.8 0 0 1 5 8.8 Z" fill={tone} />
        </>
      ) : null}
      {verdict === 'no-effect' ? (
        <circle cx="5" cy="5" r="3.6" fill="none" stroke={tone} strokeWidth="1.4" />
      ) : null}
      {verdict === 'untested' ? <circle cx="5" cy="5" r="1.8" fill={tone} /> : null}
      {verdict === 'harmful' ? <path d="M5 1 L9 8.6 L1 8.6 Z" fill={tone} /> : null}
    </svg>
  )
}

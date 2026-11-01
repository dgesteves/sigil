import Link from 'next/link'
import { type CapView, pp, VERDICT } from '@/lib/model'
import styles from './forest.module.css'

/** Every measured capability's interval on one axis, sorted by the lower bound. */
export function Forest({ caps }: { caps: CapView[] }) {
  const rows = caps.filter((c) => c.lead).sort((a, b) => b.lead!.ci95[0] - a.lead!.ci95[0])
  const x = (v: number) => ((v + 1) / 2) * 100
  const ticks = [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]
  return (
    <figure className={styles.forest}>
      <div className={styles.axisRow} aria-hidden="true">
        <span />
        <div className={styles.axis}>
          {ticks.map((t) => (
            <span key={t} style={{ left: `${x(t)}%` }}>
              {t === 0 ? '0' : pp(t)}
            </span>
          ))}
        </div>
        <span />
      </div>
      <ol className={styles.rows}>
        {rows.map((c) => {
          const l = c.lead!
          const v = VERDICT[l.verdict]
          return (
            <li key={c.id}>
              <Link href={`/c/${c.ns}/${c.slug}`} className={styles.name}>
                {c.name}
              </Link>
              <div
                className={styles.track}
                role="img"
                aria-label={`${c.name}: ${pp(l.delta)} points, 95% interval ${pp(l.ci95[0])} to ${pp(l.ci95[1])}, ${v.label}`}
                title={`${c.id} · ${pp(l.delta)} [${pp(l.ci95[0])}, ${pp(l.ci95[1])}] · ${l.baseline.passed}/${l.baseline.runs} → ${l.treatment.passed}/${l.treatment.runs}`}
              >
                <span
                  className={styles.band}
                  style={{ left: `${x(-0.1)}%`, width: `${x(0.1) - x(-0.1)}%` }}
                />
                <span className={styles.zero} style={{ left: '50%' }} />
                <span
                  className={styles.ci}
                  style={{
                    left: `${x(l.ci95[0])}%`,
                    width: `${x(l.ci95[1]) - x(l.ci95[0])}%`,
                    background: v.tone,
                  }}
                />
                <span
                  className={styles.pt}
                  data-verdict={l.verdict}
                  style={{
                    left: `${x(l.delta)}%`,
                    ...(l.verdict === 'no-effect' ? {} : { background: v.tone }),
                  }}
                />
              </div>
              <span className={`num ${styles.val}`}>
                {pp(l.delta)}{' '}
                <em>
                  [{pp(l.ci95[0])}, {pp(l.ci95[1])}]
                </em>
              </span>
            </li>
          )
        })}
      </ol>
      <figcaption>
        Uplift in percentage points with 95% Newcombe intervals, sorted by the lower bound. Shaded:
        ±10, the no-effect band.
      </figcaption>
    </figure>
  )
}

import Link from 'next/link'
import { Frame } from '@/components/chrome/Frame'
import { MachineSource } from '@/components/chrome/Machine'
import { VerdictMark } from '@/components/evidence/Evidence'
import { Forest } from '@/components/evidence/Forest'
import { CAPABILITY_TYPES, CONTRIBUTE_URL, pp, TYPE_LABEL, VERDICT } from '@/lib/model'
import { getData } from '@/lib/server/data'
import styles from './report.module.css'

export const metadata = {
  title: 'State of agent skills',
  description: 'What the measurements say, computed from every recorded run in the registry.',
}

export default async function Report() {
  const data = await getData()
  const caps = data.views
  const measured = caps.filter((c) => c.lead)
  const by = (v: string) => caps.filter((c) => c.uplift === v).length
  const runs = measured.reduce((n, c) => n + c.runs, 0)
  const entries = data.entries.filter((e) => e.evidence && e.evidence.digest === e.digest)
  const findings = entries.flatMap((e) => e.evidence!.security.findings)
  const sev = ['critical', 'high', 'medium', 'low', 'info'].map(
    (s) => [s, findings.filter((f) => f.severity === s).length] as const,
  )
  const canaries = entries.filter(
    (e) => e.evidence!.canary && e.evidence!.canary.status !== 'not-run',
  )
  const tripped = canaries.filter((e) => e.evidence!.canary!.status === 'fail')
  const md = [
    `# State of agent skills`,
    '',
    data.demo ? '> DEMO DATA: simulated runs, not measurements.\n' : '',
    `Registry ${data.registry.generatedAt}. ${caps.length} capabilities, ${measured.length} measured, ${by('proven')} proven, ${by('harmful')} harmful, ${by('no-effect')} no effect, ${by('inconclusive')} inconclusive, ${runs} runs.`,
    '',
    ...measured.map(
      (c) =>
        `- ${c.id}: ${pp(c.lead!.delta)} [${pp(c.lead!.ci95[0])}, ${pp(c.lead!.ci95[1])}] ${c.lead!.verdict}`,
    ),
  ].join('\n')

  return (
    <Frame trail={[{ label: 'report' }]}>
      <MachineSource title="State of agent skills" markdown={md} />
      <div className={styles.wrap}>
        <header className={styles.head}>
          <p className="micro">
            report · computed from registry {data.registry.generatedAt.slice(0, 10)}
            {data.demo ? ' · demo data' : ''}
          </p>
          <h1 className="display">State of agent skills</h1>
          <p className={styles.lede}>
            What the measurements say, and nothing they do not. Every figure on this page is
            computed from recorded runs the moment the registry is built.
          </p>
        </header>

        {measured.length === 0 ? (
          <div className={styles.empty}>
            <p className="display">No measurements yet.</p>
            <p>
              {caps.length
                ? `${caps.length} ${caps.length === 1 ? 'capability is' : 'capabilities are'} in the registry, and none has an uplift run for its current digest.`
                : 'The registry is empty.'}{' '}
              This report writes itself from A/B runs on hidden tests, and it will not print a
              number before one exists.
            </p>
            <pre>
              <code>
                {'npx sigil prove catalog/<type>/<namespace>/<slug> --suite <suite> --runs 6'}
              </code>
            </pre>
            <p>
              <Link href="/method">How proof works</Link> ·{' '}
              <a href={CONTRIBUTE_URL}>Write tasks or submit a capability</a>
            </p>
          </div>
        ) : (
          <>
            <dl className={styles.figures}>
              <div>
                <dt>measured</dt>
                <dd className="num">
                  {measured.length}
                  <small>/{caps.length}</small>
                </dd>
              </div>
              {(['proven', 'inconclusive', 'no-effect', 'harmful'] as const).map((v) => (
                <div key={v} data-verdict={v}>
                  <dt>
                    <VerdictMark verdict={v} /> {VERDICT[v].label}
                  </dt>
                  <dd className="num">{by(v)}</dd>
                </div>
              ))}
              <div>
                <dt>runs</dt>
                <dd className="num">{runs.toLocaleString()}</dd>
              </div>
            </dl>
            <p className={styles.read}>
              Of {measured.length} measured {measured.length === 1 ? 'capability' : 'capabilities'},{' '}
              {by('proven')} {by('proven') === 1 ? 'has' : 'have'} a whole 95% interval above zero,{' '}
              {by('harmful')} below it, {by('no-effect')} {by('no-effect') === 1 ? 'sits' : 'sit'}{' '}
              entirely within ±10 points and {by('inconclusive')} cannot be called yet.
            </p>

            <section className={styles.section}>
              <h2 className="micro">every measured interval</h2>
              <Forest caps={caps} />
            </section>

            <section className={styles.twin}>
              <div>
                <h2 className="micro">by type</h2>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">type</th>
                      <th scope="col">listed</th>
                      <th scope="col">measured</th>
                      <th scope="col">proven</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAPABILITY_TYPES.map((t) => {
                      const all = caps.filter((c) => c.type === t)
                      if (!all.length) return null
                      return (
                        <tr key={t}>
                          <th scope="row">{TYPE_LABEL[t]}</th>
                          <td className="num">{all.length}</td>
                          <td className="num">{all.filter((c) => c.lead).length}</td>
                          <td className="num">{all.filter((c) => c.uplift === 'proven').length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div>
                <h2 className="micro">security</h2>
                <table className={styles.table}>
                  <tbody>
                    <tr>
                      <th scope="row">static scans on current digests</th>
                      <td className="num">{entries.length}</td>
                    </tr>
                    {sev.map(([s, n]) => (
                      <tr key={s}>
                        <th scope="row">{s} findings</th>
                        <td className="num">{n}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">canary sandboxes run</th>
                      <td className="num">{canaries.length}</td>
                    </tr>
                    <tr>
                      <th scope="row">tripwires touched</th>
                      <td className="num">{tripped.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </Frame>
  )
}

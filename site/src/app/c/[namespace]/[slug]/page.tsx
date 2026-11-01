import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Frame } from '@/components/chrome/Frame'
import { MachineSource } from '@/components/chrome/Machine'
import {
  CompatMatrix,
  IntervalChart,
  Ladder,
  TaskTable,
  VerdictMark,
} from '@/components/evidence/Evidence'
import { InstallLines } from '@/components/evidence/InstallLines'
import { VerifySeal } from '@/components/evidence/VerifySeal'
import { capabilityMarkdown } from '@/lib/machine'
import {
  AGENTS,
  humanize,
  LEVEL,
  pp,
  REPO,
  REPO_URL,
  summariseUplift,
  TYPE_LABEL,
  toView,
  VERDICT,
} from '@/lib/model'
import { getData, getEntry, getTraces } from '@/lib/server/data'
import styles from './dossier.module.css'

type Params = { namespace: string; slug: string }

export const dynamicParams = false

export async function generateStaticParams(): Promise<Params[]> {
  const { views } = await getData()
  return views.map((v) => ({ namespace: v.ns, slug: v.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { namespace, slug } = await params
  const entry = await getEntry(namespace, slug)
  if (!entry) return {}
  const v = toView(entry)
  return {
    title: `${entry.manifest.name} (${entry.manifest.id})`,
    description: `${entry.manifest.summary} Level: ${entry.level}. Uplift: ${entry.uplift}${v.lead ? ` ${pp(v.lead.delta)} pts [${pp(v.lead.ci95[0])}, ${pp(v.lead.ci95[1])}]` : ''}.`,
    alternates: { types: { 'text/markdown': `/c/${namespace}/${slug}.md` } },
  }
}

export default async function Dossier({ params }: { params: Promise<Params> }) {
  const { namespace, slug } = await params
  const entry = await getEntry(namespace, slug)
  if (!entry) notFound()
  const data = await getData()
  const m = entry.manifest
  const view = toView(entry)
  const ev = entry.evidence && entry.evidence.digest === entry.digest ? entry.evidence : undefined
  const runs = summariseUplift(entry)
  const traces = await getTraces(entry)
  const verdict = VERDICT[entry.uplift]
  const meta = {
    demo: data.demo,
    source: data.source,
    generatedAt: data.registry.generatedAt,
    ...(data.commit ? { commit: data.commit } : {}),
  }

  let base: string | null = null
  let why = ''
  if (data.demo) base = `/api/demo-file/${entry.path}`
  else if (m.source) {
    const [, owner, repo] = new URL(m.source.repo).pathname.split('/')
    base = `https://raw.githubusercontent.com/${owner}/${repo}/${m.source.ref}${m.source.path === '.' ? '' : `/${m.source.path}`}`
  } else if (data.commit)
    base = `https://raw.githubusercontent.com/${REPO}/${data.commit}/${entry.path}`
  else
    why =
      'The registry records no commit, so there is no pinned copy of these files to fetch and check.'

  const agents = AGENTS.filter((a) => m.targets.includes(a) || ev?.compat[a]?.compiled)
  const compiled = Object.fromEntries(AGENTS.map((a) => [a, ev?.compat[a]?.compiled])) as Record<
    string,
    boolean | undefined
  >

  return (
    <Frame trail={[{ label: TYPE_LABEL[m.type].toLowerCase() }, { label: m.id }]}>
      <MachineSource
        title={m.id}
        href={`/c/${namespace}/${slug}.md`}
        markdown={capabilityMarkdown(entry, view, meta)}
        json={JSON.stringify(entry, null, 2)}
      />
      <div className={styles.grid}>
        <aside className={styles.sealCol} aria-label="Seal">
          <VerifySeal
            digest={entry.digest}
            files={entry.files}
            base={base}
            why={why}
            demo={data.demo}
            tone={verdict.tone}
          />
        </aside>

        <article className={styles.body}>
          <header className={styles.head}>
            <p className="micro">
              {TYPE_LABEL[m.type]} · {m.id} · v{m.version} · {m.license}
            </p>
            <h1 className={`display ${styles.title}`}>{m.name}</h1>
            <p className={styles.summary}>{m.summary}</p>
            {m.description ? <p className={styles.description}>{m.description}</p> : null}
            <ul className={styles.facets} aria-label="Facets">
              {m.domains.map((d) => (
                <li key={d}>{humanize(d)}</li>
              ))}
              {m.industries.map((d) => (
                <li key={d} data-kind="industry">
                  {humanize(d)}
                </li>
              ))}
              {m.lifecycle.map((d) => (
                <li key={d} data-kind="lifecycle">
                  {d}
                </li>
              ))}
              {m.technologies.map((d) => (
                <li key={d} data-kind="tech">
                  {d}
                </li>
              ))}
            </ul>
          </header>

          <section className={styles.verdict} aria-labelledby="uplift">
            <div className={styles.verdictHead}>
              <h2 id="uplift" className="micro">
                uplift
              </h2>
              {traces.length ? (
                <Link href={`/c/${namespace}/${slug}/proof`} className={styles.theaterLink}>
                  watch the runs ▸
                </Link>
              ) : null}
            </div>
            <div className={styles.big}>
              <div className={styles.bigVerdict} data-verdict={entry.uplift}>
                <VerdictMark verdict={entry.uplift} size={14} />
                <span className={styles.bigLabel}>{verdict.label}</span>
              </div>
              {view.lead ? (
                <div className={styles.bigNum}>
                  <span className={`num ${styles.bigValue}`}>{pp(view.lead.delta)}</span>
                  <small className={styles.bigUnit}>
                    pts
                    <br />
                    <span className={`num ${styles.bigInterval}`}>
                      [{pp(view.lead.ci95[0])}, {pp(view.lead.ci95[1])}]
                    </span>
                  </small>
                </div>
              ) : null}
              <p className={styles.bigLine}>
                {verdict.line}{' '}
                {view.lead
                  ? `${view.lead.baseline.passed}/${view.lead.baseline.runs} baseline → ${view.lead.treatment.passed}/${view.lead.treatment.runs} with ${m.name}, ${view.lead.tasks} tasks, ${view.lead.agent} · ${view.lead.model}.`
                  : ''}
              </p>
            </div>
            {runs.length ? (
              <IntervalChart runs={runs} />
            ) : (
              <div className={styles.untested}>
                <p className="display">Not measured for this digest.</p>
                <p>
                  {view.stale
                    ? 'Evidence exists, but for an older digest. The payload changed after it was measured, and evidence never carries across content.'
                    : 'Untested is not the same as useless: nobody has measured it yet.'}{' '}
                  Proof comes from A/B runs on hidden tests:
                </p>
                <pre>
                  <code>{`npx sigil prove ${entry.path} --suite <suite> --runs 6`}</code>
                </pre>
              </div>
            )}
          </section>

          {ev?.uplift.map((u) => (
            <section
              key={`${u.suite}-${u.agent.id}-${u.model}`}
              className={styles.section}
              aria-label={`Tasks in ${u.suite}`}
            >
              <h2 className="micro">
                per task · {u.suite} · {u.agent.id} {u.agent.version} · {u.model} ·{' '}
                {u.at.slice(0, 10)}
              </h2>
              <TaskTable tasks={u.tasks} verdict={u.verdict} />
            </section>
          ))}

          <section className={styles.section} aria-labelledby="trust">
            <h2 id="trust" className="micro">
              trust level · {LEVEL[entry.level].label.toLowerCase()}
            </h2>
            <Ladder
              level={entry.level}
              digest={entry.digest}
              {...(entry.evidence ? { evidence: entry.evidence } : {})}
            />
          </section>

          <section className={styles.twin} aria-label="Security">
            <div>
              <h2 className="micro">canary sandbox</h2>
              {ev?.canary ? (
                <div className={styles.check} data-status={ev.canary.status}>
                  <p className={styles.checkHead}>
                    {ev.canary.status === 'pass'
                      ? 'No tripwire touched'
                      : ev.canary.status === 'fail'
                        ? 'Tripwire touched'
                        : ev.canary.status}
                    <span className={styles.checkMeta}>
                      {ev.canary.runs} runs · {ev.canary.agent.id} · {ev.canary.at.slice(0, 10)}
                    </span>
                  </p>
                  <p className={styles.checkNote}>
                    Planted honeytokens (fake cloud keys, tokens, an .env and an SSH key) and a
                    proxy that only allows the model provider.
                  </p>
                  {ev.canary.events.length ? (
                    <ol className={styles.events}>
                      {ev.canary.events.map((e) => (
                        <li key={e.detail}>
                          <b>{e.kind}</b> {e.detail}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : (
                <p className={styles.notRun}>Not run for this digest.</p>
              )}
            </div>
            <div>
              <h2 className="micro">static scan</h2>
              {ev ? (
                <div className={styles.check} data-status={ev.security.status}>
                  <p className={styles.checkHead}>
                    {ev.security.status === 'pass'
                      ? 'No findings'
                      : `${ev.security.findings.length} finding${ev.security.findings.length === 1 ? '' : 's'}`}
                    <span className={styles.checkMeta}>
                      {ev.security.tool.name} {ev.security.tool.version} · OWASP Agentic Skills Top
                      10
                    </span>
                  </p>
                  {ev.security.findings.length ? (
                    <ol className={styles.events}>
                      {ev.security.findings.map((f) => (
                        <li key={`${f.rule}-${f.file}-${f.line}`} data-severity={f.severity}>
                          <b>
                            {f.severity} {f.rule}
                            {f.owasp ? ` · ${f.owasp}` : ''}
                          </b>{' '}
                          {f.message}
                          {f.file ? (
                            <code>
                              {' '}
                              {f.file}
                              {f.line ? `:${f.line}` : ''}
                            </code>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : (
                <p className={styles.notRun}>Not run for this digest.</p>
              )}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="compat">
            <h2 id="compat" className="micro">
              compatibility · targeted, compiled and evaluated are separate claims
            </h2>
            <CompatMatrix
              manifest={m}
              digest={entry.digest}
              {...(entry.evidence ? { evidence: entry.evidence } : {})}
            />
          </section>

          <section className={styles.twin} aria-label="Permissions and files">
            <div>
              <h2 className="micro">declared permissions</h2>
              <dl className={styles.perms}>
                <dt>network</dt>
                <dd>{m.permissions.network.length ? m.permissions.network.join(', ') : 'none'}</dd>
                <dt>shell</dt>
                <dd>{m.permissions.shell.length ? m.permissions.shell.join(', ') : 'none'}</dd>
                <dt>filesystem</dt>
                <dd>{m.permissions.filesystem}</dd>
                <dt>env</dt>
                <dd>{m.permissions.env.length ? m.permissions.env.join(', ') : 'none'}</dd>
              </dl>
              <p className={styles.checkNote}>
                Undeclared access is a finding in the scan and a tripwire in the canary.
              </p>
            </div>
            <div>
              <h2 className="micro">source</h2>
              <dl className={styles.perms}>
                <dt>path</dt>
                <dd>
                  <a href={`${REPO_URL}/tree/${data.commit ?? 'main'}/${entry.path}`}>
                    {entry.path}
                  </a>
                </dd>
                <dt>authors</dt>
                <dd>{m.authors.map((a) => a.github).join(', ')}</dd>
                <dt>entry</dt>
                <dd>
                  {m.payload.entry} ({m.payload.format})
                </dd>
                <dt>registry</dt>
                <dd>
                  {data.registry.generatedAt.slice(0, 10)}
                  {data.commit ? ` · ${data.commit.slice(0, 7)}` : ''}
                </dd>
              </dl>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="install">
            <h2 id="install" className="micro">
              install
            </h2>
            <InstallLines id={m.id} agents={agents} compiled={compiled} />
          </section>

          {m.limitations.length ? (
            <section className={styles.section} aria-labelledby="limits">
              <h2 id="limits" className="micro">
                known limitations
              </h2>
              <ul className={styles.limits}>
                {m.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </div>
    </Frame>
  )
}

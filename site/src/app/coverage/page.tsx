import Link from 'next/link'
import { Frame } from '@/components/chrome/Frame'
import { MachineSource } from '@/components/chrome/Machine'
import { type Coverage, coverageOf } from '@/components/field/layout'
import {
  AGENT_LABEL,
  AGENTS,
  CAPABILITY_TYPES,
  type CapView,
  CONTRIBUTE_URL,
  DOMAIN_GROUPS,
  humanize,
  INDUSTRIES,
  LIFECYCLE,
  TYPE_LABEL,
} from '@/lib/model'
import { getData, getTaxonomy } from '@/lib/server/data'
import styles from './coverage.module.css'

export const metadata = {
  title: 'Coverage',
  description: 'Which areas of software have proven capabilities, which are being measured, and which are open.',
}

interface Cell {
  key: string
  label: string
  caps: CapView[]
  state: Coverage
  q: string
}

const STATE_LABEL: Record<Coverage, string> = {
  proven: 'proven',
  measured: 'measured, not proven',
  listed: 'listed, untested',
  open: 'open',
}

function cells(keys: readonly string[], caps: CapView[], pick: (c: CapView) => readonly string[], label = humanize): Cell[] {
  return keys.map((k) => {
    const members = caps.filter((c) => pick(c).includes(k))
    return { key: k, label: label(k), caps: members, state: coverageOf(members), q: label(k) }
  })
}

function Tile({ c }: { c: Cell }) {
  const proven = c.caps.filter((x) => x.uplift === 'proven').length
  const inner = (
    <>
      <span className={styles.label}>{c.label}</span>
      <span className={styles.count}>
        {c.caps.length ? (
          <>
            <b className="num">{c.caps.length}</b>
            {proven ? <span className="num"> · {proven} proven</span> : null}
          </>
        ) : (
          'open'
        )}
      </span>
      <span className="sr-only">: {STATE_LABEL[c.state]}</span>
    </>
  )
  return c.state === 'open' ? (
    <a className={styles.tile} data-state="open" href={CONTRIBUTE_URL} title="Nothing here yet. Submit a capability.">
      {inner}
    </a>
  ) : (
    <Link className={styles.tile} data-state={c.state} href={`/?q=${encodeURIComponent(c.q)}`} title={`${c.caps.length} capabilities · ${STATE_LABEL[c.state]}`}>
      {inner}
    </Link>
  )
}

function Summary({ title, list }: { title: string; list: Cell[] }) {
  const covered = list.filter((c) => c.state !== 'open').length
  const proven = list.filter((c) => c.state === 'proven').length
  return (
    <div className={styles.summary}>
      <span className="micro">{title}</span>
      <span className="num">
        <b>{covered}</b>/{list.length} covered · <b className={styles.lit}>{proven}</b> with proof
      </span>
      <span className={styles.meter} aria-hidden="true">
        <span style={{ width: `${(proven / list.length) * 100}%` }} data-state="proven" />
        <span style={{ width: `${((covered - proven) / list.length) * 100}%` }} data-state="listed" />
      </span>
    </div>
  )
}

export default async function CoveragePage() {
  const data = await getData()
  const taxonomy = await getTaxonomy()
  const caps = data.views
  const groups = DOMAIN_GROUPS.map((g) => ({ ...g, cells: cells(g.domains, caps, (c) => c.domains) }))
  const domains = groups.flatMap((g) => g.cells)
  const industries = cells(INDUSTRIES, caps, (c) => c.industries)
  const lifecycle = cells(LIFECYCLE, caps, (c) => c.lifecycle)
  const types = cells(CAPABILITY_TYPES, caps, (c) => [c.type], (k) => TYPE_LABEL[k as keyof typeof TYPE_LABEL])
  const techs = taxonomy?.technologies ?? []
  const techName = new Map(techs.map((t) => [t.id, t.name]))
  const techCells = cells(techs.map((t) => t.id), caps, (c) => c.technologies, (k) => techName.get(k) ?? k)
  const kinds = [...new Set(techs.map((t) => t.kind))]
  const agentRows = AGENTS.map((a) => ({
    a,
    targeted: caps.filter((c) => c.targets.includes(a)).length,
    compiled: caps.filter((c) => c.compiled.includes(a)).length,
    evaluated: caps.filter((c) => c.evaluated.includes(a)).length,
  }))

  const md = [
    '# Coverage',
    '',
    data.demo ? '> DEMO DATA: simulated, not measured.\n' : '',
    'State per area: proven (a capability with a whole interval above zero), measured (runs exist, none proven), listed (in the catalog, untested), open (nothing yet).',
    '',
    ...[['Disciplines', domains], ['Industries', industries], ['Lifecycle', lifecycle], ['Types', types], ['Technologies', techCells]].flatMap(
      ([title, list]) => [`## ${title as string}`, '', ...(list as Cell[]).map((c) => `- ${c.label}: ${c.state} (${c.caps.length})`), ''],
    ),
  ].join('\n')

  return (
    <Frame trail={[{ label: 'coverage' }]}>
      <MachineSource title="Coverage" markdown={md} />
      <div className={styles.wrap}>
        <header className={styles.head}>
          <p className="micro">coverage · {data.registry.generatedAt.slice(0, 10)}{data.demo ? ' · demo data' : ''}</p>
          <h1 className="display">The whole of software, and how much of it is proven.</h1>
          <p className={styles.lede}>
            Every discipline, industry, lifecycle stage, capability type, agent and technology in the spec. Light means a
            measured, proven capability exists. Dark cells are open: the next contribution there is a first.
          </p>
          <ul className={styles.key} aria-label="Legend">
            {(['proven', 'measured', 'listed', 'open'] as const).map((s) => (
              <li key={s}>
                <span className={styles.sw} data-state={s} aria-hidden="true" /> {STATE_LABEL[s]}
              </li>
            ))}
          </ul>
          <div className={styles.summaries}>
            <Summary title="disciplines" list={domains} />
            <Summary title="industries" list={industries} />
            <Summary title="lifecycle" list={lifecycle} />
            <Summary title="technologies" list={techCells} />
          </div>
        </header>

        <section className={styles.section} aria-labelledby="cov-domains">
          <h2 id="cov-domains" className="micro">
            disciplines
          </h2>
          {groups.map((g) => (
            <div key={g.id} className={styles.group}>
              <h3>{g.label}</h3>
              <div className={styles.grid}>
                {g.cells.map((c) => (
                  <Tile key={c.key} c={c} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby="cov-life">
          <h2 id="cov-life" className="micro">
            lifecycle
          </h2>
          <div className={styles.cycle}>
            {lifecycle.map((c) => (
              <Tile key={c.key} c={c} />
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="cov-ind">
          <h2 id="cov-ind" className="micro">
            industries
          </h2>
          <div className={styles.grid}>
            {industries.map((c) => (
              <Tile key={c.key} c={c} />
            ))}
          </div>
        </section>

        <section className={styles.twin}>
          <div className={styles.section}>
            <h2 className="micro">capability types</h2>
            <div className={styles.grid}>
              {types.map((c) => (
                <Tile key={c.key} c={c} />
              ))}
            </div>
          </div>
          <div className={styles.section}>
            <h2 className="micro">agents · targeted / compiled / evaluated</h2>
            <ol className={styles.agents}>
              {agentRows.map((r) => (
                <li key={r.a} data-state={r.evaluated ? 'proven' : r.compiled ? 'listed' : 'open'}>
                  <span>{AGENT_LABEL[r.a]}</span>
                  <span className="num">
                    {r.targeted} / {r.compiled} / <b>{r.evaluated}</b>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="cov-tech">
          <h2 id="cov-tech" className="micro">
            technologies · from taxonomy/technologies.yaml
          </h2>
          {kinds.map((k) => (
            <div key={k} className={styles.group}>
              <h3>{humanize(k)}</h3>
              <div className={`${styles.grid} ${styles.dense}`}>
                {techCells
                  .filter((c) => techs.find((t) => t.id === c.key)?.kind === k)
                  .map((c) => (
                    <Tile key={c.key} c={c} />
                  ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </Frame>
  )
}

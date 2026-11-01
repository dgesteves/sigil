import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Trace } from 'sigil/core'
import { Frame } from '@/components/chrome/Frame'
import { MachineSource } from '@/components/chrome/Machine'
import { Sigil } from '@/components/Sigil'
import { pp, toView, VERDICT } from '@/lib/model'
import { getData, getEntry, getTraces, pairTraces, type TracePair } from '@/lib/server/data'
import { type PairLink, Theater, type TraceLite } from './Theater'
import styles from './theater.module.css'

export const pairHref = (
  ns: string,
  slug: string,
  p: { suite: string; task: string; run: number },
) => `/c/${ns}/${slug}/proof/${p.suite}/${p.task}/${p.run}`

export function parsePair(parts: string[]): { suite: string; task: string; run: number } | null {
  if (parts.length < 3) return null
  const run = Number(parts.at(-1))
  if (!Number.isInteger(run) || run < 1) return null
  return { suite: parts.slice(0, -2).join('/'), task: parts.at(-2)!, run }
}

const lite = (t: Trace): TraceLite => ({
  condition: t.condition,
  passed: t.passed,
  tampered: t.tampered,
  falseDone: t.falseDone,
  tokens: t.tokens,
  seconds: t.seconds,
  ...(t.costUsd !== undefined ? { costUsd: t.costUsd } : {}),
  model: t.model,
  agent: `${t.agent.id} ${t.agent.version}`,
  at: t.at,
  ...(t.verifyOutput ? { verifyOutput: t.verifyOutput } : {}),
  events: t.events.map((e) => ({
    t: e.t,
    kind: e.kind,
    text: e.text,
    ...(e.tool ? { tool: e.tool } : {}),
    ...(e.ok !== undefined ? { ok: e.ok } : {}),
  })),
})

function traceMarkdown(id: string, pair: TracePair | undefined): string {
  if (!pair) return `# Proof theater: ${id}\n\nNo traces recorded for this digest.\n`
  const side = (t?: Trace) =>
    t
      ? `## ${t.condition} run ${t.run}: ${t.passed ? 'passed' : 'failed'}${t.tampered ? ' (tampered)' : ''}${t.falseDone ? ' (claimed done)' : ''}\n\n- ${t.tokens} tokens · ${t.seconds}s · ${t.agent.id} ${t.agent.version} · ${t.model}\n- verifier: ${t.verifyOutput ?? '—'}\n\n${t.events.map((e) => `- ${(e.t / 1000).toFixed(1)}s ${e.kind}${e.tool ? ` ${e.tool}` : ''}: ${e.text.replace(/\n/g, ' ')}`).join('\n')}\n`
      : ''
  return `# Proof theater: ${id}\n\n${pair.suite} / ${pair.task} / run ${pair.run}\n\n${side(pair.baseline)}\n${side(pair.treatment)}`
}

export async function renderTheater(
  namespace: string,
  slug: string,
  wanted?: { suite: string; task: string; run: number },
) {
  const entry = await getEntry(namespace, slug)
  if (!entry) notFound()
  const data = await getData()
  const view = toView(entry)
  const pairs = pairTraces(await getTraces(entry))
  const pair = wanted
    ? pairs.find((p) => p.suite === wanted.suite && p.task === wanted.task && p.run === wanted.run)
    : (pairs.find((p) => p.baseline && p.treatment && p.baseline.passed !== p.treatment.passed) ??
      pairs[0])
  if (wanted && !pair) notFound()
  const links: PairLink[] = pairs.map((p) => ({
    suite: p.suite,
    task: p.task,
    run: p.run,
    href: pairHref(namespace, slug, p),
    ...(p.baseline ? { baseline: p.baseline.passed } : {}),
    ...(p.treatment ? { treatment: p.treatment.passed } : {}),
  }))
  const v = VERDICT[entry.uplift]
  return (
    <Frame
      trail={[
        { href: `/c/${namespace}/${slug}`, label: entry.manifest.id },
        { label: 'proof theater' },
      ]}
    >
      <MachineSource
        title={`proof theater · ${entry.manifest.id}`}
        markdown={traceMarkdown(entry.manifest.id, pair)}
      />
      <header className={styles.head}>
        <Sigil digest={entry.digest} size={56} color={v.tone} />
        <div>
          <p className="micro">proof theater · recorded runs, replayed on one clock</p>
          <h1 className="display">{entry.manifest.name}</h1>
          <p className={styles.sub}>
            {view.lead
              ? `${v.label} across the suite: ${pp(view.lead.delta)} pts [${pp(view.lead.ci95[0])}, ${pp(view.lead.ci95[1])}] over ${view.lead.baseline.runs + view.lead.treatment.runs} runs. One pair below; every pair is listed.`
              : 'No uplift result for this digest.'}
          </p>
        </div>
      </header>
      {pair?.baseline || pair?.treatment ? (
        <Theater
          key={`${pair.suite}/${pair.task}/${pair.run}`}
          pair={{ suite: pair.suite, task: pair.task, run: pair.run }}
          {...(pair.baseline ? { baseline: lite(pair.baseline) } : {})}
          {...(pair.treatment ? { treatment: lite(pair.treatment) } : {})}
          pairs={links}
          capName={entry.manifest.name}
          demo={data.demo}
        />
      ) : (
        <div className={styles.empty}>
          <p className="display">No runs recorded for this digest.</p>
          <p>
            The theater replays real traces written by the lab: one baseline run and one run with
            the capability, side by side on the same clock. Nothing is staged, so until runs exist
            there is nothing to show.
          </p>
          <pre>
            <code>{`npx sigil prove ${entry.path} --suite <suite> --runs 6\n# traces land in evidence/${namespace}/${slug}/${entry.manifest.version}/traces/`}</code>
          </pre>
          <p>
            <Link href={`/c/${namespace}/${slug}`}>Back to the dossier</Link> ·{' '}
            <Link href="/method">How proof works</Link>
          </p>
          <div className={styles.ghost} aria-hidden="true">
            {['Baseline', 'With the capability'].map((label) => (
              <div key={label} className={styles.ghostPane}>
                <span>{label}</span>
                <i />
                <i />
                <i />
                <em>awaiting runs</em>
              </div>
            ))}
          </div>
        </div>
      )}
    </Frame>
  )
}

import { Frame } from '@/components/chrome/Frame'
import { MachineSource } from '@/components/chrome/Machine'
import { getMethodology } from '@/lib/server/data'
import { renderMarkdown } from '@/lib/server/markdown'
import styles from './method.module.css'

export const metadata = {
  title: 'Method',
  description:
    'How Sigil measures uplift, scans for malicious behaviour and seals the exact content it tested.',
}

export default async function Method() {
  const { markdown, source } = await getMethodology()
  const { html, headings } = renderMarkdown(markdown)
  const toc = headings.filter((h) => h.depth === 2)
  return (
    <Frame trail={[{ label: 'method' }]}>
      <MachineSource title="Method" markdown={markdown} href="/method" />
      <div className={styles.wrap}>
        <nav className={styles.toc} aria-label="On this page">
          <p className="micro">method · {source}</p>
          <ol>
            {toc.map((h, i) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span> {h.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {/* Repo-authored markdown rendered on the server; no user input reaches it. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, build-time content */}
        <article className={styles.doc} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </Frame>
  )
}

import Link from 'next/link'
import styles from './frame.module.css'
import { OpenK } from './OpenK'
import { Wordmark } from './Wordmark'

/** Subpage frame: the mark, where you are, and the intent line one keystroke away. */
export function Frame({
  trail,
  children,
}: {
  trail: { href?: string; label: string }[]
  children: React.ReactNode
}) {
  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <Wordmark />
        <nav aria-label="Breadcrumb" className={styles.trail}>
          <ol>
            <li>
              <Link href="/">observatory</Link>
            </li>
            {trail.map((t) => (
              <li key={t.label}>
                {t.href ? (
                  <Link href={t.href}>{t.label}</Link>
                ) : (
                  <span aria-current="page">{t.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <span className={styles.spacer} />
        <nav className={styles.pages} aria-label="Pages">
          <Link href="/method">Method</Link>
          <Link href="/coverage">Coverage</Link>
          <Link href="/report">Report</Link>
        </nav>
        <OpenK />
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  )
}

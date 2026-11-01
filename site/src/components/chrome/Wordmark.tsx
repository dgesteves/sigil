import Link from 'next/link'
import { SIGIL_MARK, Sigil } from '../Sigil'
import styles from './chrome.module.css'

export function Wordmark({ home = false }: { home?: boolean }) {
  const inner = (
    <>
      <Sigil digest={SIGIL_MARK} size={22} color="var(--flare)" />
      <span className={styles.wordmarkText}>SIGIL</span>
    </>
  )
  if (home) return <div className={styles.wordmark}>{inner}</div>
  return (
    <Link href="/" className={styles.wordmark} aria-label="Sigil observatory">
      {inner}
    </Link>
  )
}

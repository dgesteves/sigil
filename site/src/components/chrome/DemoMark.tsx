import styles from './chrome.module.css'

/** Shown on every page whenever the site is reading the DEMO fixture. Production cannot render it. */
export function DemoMark() {
  return (
    <div
      className={styles.demo}
      role="note"
      aria-label="Demo data: simulated runs, not measurements"
    >
      <span className={styles.demoStripe} aria-hidden="true" />
      <strong>DEMO DATA</strong>
      <span>simulated runs for development · not evidence</span>
      <span className={styles.demoStripe} aria-hidden="true" />
    </div>
  )
}

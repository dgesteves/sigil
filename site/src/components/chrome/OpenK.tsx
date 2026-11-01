'use client'

import { OPEN_K } from './CommandK'
import styles from './frame.module.css'

export function OpenK() {
  return (
    <button
      type="button"
      className={styles.k}
      onClick={() => window.dispatchEvent(new Event(OPEN_K))}
    >
      <span>What is your agent about to work on?</span>
      <kbd>⌘</kbd>
      <kbd>K</kbd>
    </button>
  )
}

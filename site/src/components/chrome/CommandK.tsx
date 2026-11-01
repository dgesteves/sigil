'use client'

/**
 * ⌘K (or /) opens the intent line from anywhere. On the observatory it focuses the line in place;
 * elsewhere it opens the same line over the page and sends the answer to the observatory.
 */
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import styles from './chrome.module.css'

export const FOCUS_INTENT = 'sigil:focus-intent'
export const OPEN_K = 'sigil:open-k'

export function CommandK() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      const k = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (!k && !(e.key === '/' && !typing)) return
      e.preventDefault()
      if (pathname === '/') window.dispatchEvent(new Event(FOCUS_INTENT))
      else setOpen(true)
    }
    const openK = () =>
      pathname === '/' ? window.dispatchEvent(new Event(FOCUS_INTENT)) : setOpen(true)
    window.addEventListener('keydown', key)
    window.addEventListener(OPEN_K, openK)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener(OPEN_K, openK)
    }
  }, [pathname])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  if (!open) return null
  return (
    <div className={styles.kOverlay} role="dialog" aria-modal="true" aria-label="Ask the Oracle">
      <button
        type="button"
        className={styles.kScrim}
        aria-label="Close"
        onClick={() => setOpen(false)}
      />
      <form
        className={styles.kForm}
        onSubmit={(e) => {
          e.preventDefault()
          const q = input.current?.value.trim()
          if (!q) return
          setOpen(false)
          router.push(`/?q=${encodeURIComponent(q)}`)
        }}
      >
        <label className="micro" htmlFor="k-intent">
          the oracle
        </label>
        <input
          ref={input}
          id="k-intent"
          className={styles.kInput}
          placeholder="What is your agent about to work on?"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <p className={styles.kHint}>
          describe the task, or paste a GitHub repo URL · <kbd>↵</kbd> to ask · <kbd>Esc</kbd> to
          close
        </p>
      </form>
    </div>
  )
}

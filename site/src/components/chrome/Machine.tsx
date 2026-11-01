'use client'

/**
 * Human / Machine. Every page registers the exact data it renders, as markdown (and JSON where it
 * exists). Flipping to Machine shows what an agent reads: the same facts, no presentation. A scanline
 * sweeps the page and the text resolves line by line behind it.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import styles from './chrome.module.css'

interface Source {
  title: string
  markdown: string
  json?: string
  /** Where an agent fetches this, e.g. /c/react/x.md */
  href?: string
}

interface Ctx {
  mode: 'human' | 'machine'
  toggle(): void
}

const MachineCtx = createContext<Ctx | null>(null)
/** Separate, stable context so pages registering a source never re-render on mode changes. */
const SourceCtx = createContext<((s: Source | null) => void) | null>(null)

export function MachineProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'human' | 'machine'>('human')
  const [source, setSource] = useState<Source | null>(null)
  const toggle = useCallback(() => setMode((m) => (m === 'human' ? 'machine' : 'human')), [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape' && mode === 'machine') setMode('human')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle, mode])

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle])
  return (
    <SourceCtx.Provider value={setSource}>
      <MachineCtx.Provider value={value}>
        {children}
        <MachineToggle />
        {mode === 'machine' && source ? <MachineView source={source} onClose={toggle} /> : null}
      </MachineCtx.Provider>
    </SourceCtx.Provider>
  )
}

/** Registers the machine-readable form of the current page. */
export function MachineSource(props: Source) {
  const set = useContext(SourceCtx)
  const { title, markdown, json, href } = props
  useEffect(() => {
    set?.({ title, markdown, ...(json ? { json } : {}), ...(href ? { href } : {}) })
    return () => set?.(null)
  }, [set, title, markdown, json, href])
  return null
}

function MachineToggle() {
  const ctx = useContext(MachineCtx)!
  const machine = ctx.mode === 'machine'
  return (
    <div className={styles.toggleWrap}>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={machine}
        onClick={ctx.toggle}
        title="Show what an agent sees (M)"
      >
        <span className={machine ? '' : styles.on}>Human</span>
        <span className={styles.toggleTrack} aria-hidden="true">
          <span className={styles.toggleKnob} data-machine={machine} />
        </span>
        <span className={machine ? styles.on : ''}>Machine</span>
        <kbd>M</kbd>
      </button>
    </div>
  )
}

const SCRAMBLE = '░▒▓<>/{}[]=+*#01'

function MachineView({ source, onClose }: { source: Source; onClose(): void }) {
  const [tab, setTab] = useState<'md' | 'json'>('md')
  const [copied, setCopied] = useState(false)
  const text = tab === 'md' ? source.markdown : (source.json ?? '')
  const lines = useMemo(() => text.split('\n'), [text])
  const pre = useRef<HTMLPreElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  // Decode: visible lines start as noise and resolve as the scanline passes them.
  useEffect(() => {
    const el = pre.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const spans = Array.from(el.children).slice(0, 90) as HTMLElement[]
    const finals = spans.map((s) => s.textContent ?? '')
    const t0 = performance.now()
    const D = 720
    let raf = 0
    let seed = 7
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const tick = (now: number) => {
      const t = now - t0
      let busy = false
      spans.forEach((s, i) => {
        const at = (i / Math.max(1, spans.length)) * D
        const final = finals[i]!
        if (t >= at + 160) {
          if (s.textContent !== final) s.textContent = final
          return
        }
        busy = true
        const resolved = t < at ? 0 : Math.floor(((t - at) / 160) * final.length)
        let out = final.slice(0, resolved)
        for (let k = resolved; k < final.length; k++) {
          out += final[k] === ' ' ? ' ' : SCRAMBLE[Math.floor(rnd() * SCRAMBLE.length)]
        }
        s.textContent = out
      })
      if (busy) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      spans.forEach((s, i) => {
        s.textContent = finals[i]!
      })
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={styles.machine}
      role="dialog"
      aria-modal="true"
      aria-label={`Machine view: ${source.title}`}
      ref={panel}
      tabIndex={-1}
    >
      <div className={styles.scan} aria-hidden="true" />
      <div className={styles.machineBar}>
        <span className="micro">what an agent reads</span>
        <span className={styles.machineTitle}>{source.title}</span>
        {source.href ? (
          <a className={styles.machineHref} href={source.href}>
            GET {source.href}
          </a>
        ) : null}
        <span className={styles.machineSpacer} />
        {source.json ? (
          <div className={styles.tabs} role="tablist" aria-label="Format">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'md'}
              onClick={() => setTab('md')}
            >
              markdown
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'json'}
              onClick={() => setTab('json')}
            >
              json
            </button>
          </div>
        ) : null}
        <button type="button" className={styles.machineBtn} onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
        <button type="button" className={styles.machineBtn} onClick={onClose}>
          human <kbd>Esc</kbd>
        </button>
      </div>
      <pre ref={pre} className={styles.machinePre} key={tab}>
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of a static document
          <span key={i}>{l || ' '}</span>
        ))}
      </pre>
    </div>
  )
}

'use client'

/**
 * Verify the seal yourself. Fetches every payload file at the registry commit, hashes it in this
 * browser (WebCrypto), and recomputes the payload digest exactly as core/digest.ts does:
 * sha256 over "<sha256 hex>  <posix path>\n" lines sorted by UTF-8 bytes. The sigil draws itself as
 * the bytes arrive; a mismatch draws the sigil of what was actually received.
 */
import { GLYPH_VIEWBOX, glyph, glyphWeight } from '@core/glyph'
import { useMemo, useRef, useState } from 'react'
import { shortDigest } from '@/lib/model'
import styles from './seal.module.css'

interface FileRow {
  path: string
  sha256: string
  bytes: number
}

interface Props {
  digest: string
  files: FileRow[]
  /** Base URL that file paths are appended to, or null when files cannot be fetched. */
  base: string | null
  why?: string
  demo: boolean
  tone: string
  size?: number
}

type RowState = { status: 'wait' | 'fetch' | 'ok' | 'bad' | 'error'; got?: string; note?: string }

const enc = new TextEncoder()

function byteCompare(a: string, b: string) {
  const x = enc.encode(a)
  const y = enc.encode(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return x.length - y.length
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function VerifySeal({ digest, files, base, why, demo, tone, size = 340 }: Props) {
  const sorted = useMemo(() => [...files].sort((a, b) => byteCompare(a.path, b.path)), [files])
  const [rows, setRows] = useState<RowState[]>(() => sorted.map(() => ({ status: 'wait' })))
  const [phase, setPhase] = useState<'idle' | 'running' | 'match' | 'mismatch' | 'error'>('idle')
  const [computed, setComputed] = useState<string | null>(null)
  const [progress, setProgress] = useState(1)
  const [tamper, setTamper] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const run = useRef(0)

  const verify = async () => {
    if (!base) return
    const id = ++run.current
    setPhase('running')
    setComputed(null)
    setProgress(0)
    setRows(sorted.map(() => ({ status: 'wait' })))
    const t0 = performance.now()
    const total = sorted.reduce((n, f) => n + Math.max(1, f.bytes), 0)
    let done = 0
    const hexes: string[] = []
    for (const [i, f] of sorted.entries()) {
      if (id !== run.current) return
      setRows((r) => r.map((x, k) => (k === i ? { status: 'fetch' } : x)))
      try {
        const res = await fetch(`${base}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        let bytes = new Uint8Array(await res.arrayBuffer())
        if (tamper && i === 0) {
          // Demo only, chosen by the reader: one extra byte, to show what tampering does to a seal.
          const t = new Uint8Array(bytes.length + 1)
          t.set(bytes)
          t[bytes.length] = 0x0a
          bytes = t
        }
        const hex = await sha256Hex(bytes)
        hexes.push(hex)
        done += Math.max(1, f.bytes)
        setProgress(done / total)
        setRows((r) =>
          r.map((x, k) => (k === i ? { status: hex === f.sha256 ? 'ok' : 'bad', got: hex } : x)),
        )
      } catch (e) {
        setRows((r) =>
          r.map((x, k) => (k === i ? { status: 'error', note: (e as Error).message } : x)),
        )
        setPhase('error')
        setMs(performance.now() - t0)
        return
      }
    }
    const manifest = sorted.map((f, i) => `${hexes[i]}  ${f.path}\n`).join('')
    const got = `sha256:${await sha256Hex(enc.encode(manifest))}`
    if (id !== run.current) return
    setComputed(got)
    setMs(performance.now() - t0)
    setPhase(got === digest ? 'match' : 'mismatch')
  }

  const shown = phase === 'mismatch' && computed ? computed : digest
  return (
    <div className={styles.seal} data-phase={phase}>
      <div className={styles.stage}>
        <AssemblingGlyph
          digest={digest}
          progress={phase === 'mismatch' ? 1 : progress}
          tone={phase === 'mismatch' ? 'var(--ash)' : tone}
          size={size}
          lit={phase === 'match'}
        />
        {phase === 'mismatch' && computed ? (
          <div className={styles.broken}>
            <AssemblingGlyph
              digest={computed}
              progress={1}
              tone="var(--harm)"
              size={size}
              lit={false}
            />
          </div>
        ) : null}
        <div className={styles.ring} aria-hidden="true" />
      </div>

      <div className={styles.readout}>
        <span className="micro">payload digest</span>
        <code className={styles.digest}>{chunk(shown)}</code>
        {phase === 'mismatch' && computed ? (
          <p className={styles.verdictBad}>
            Seal broken. The files received hash to a different digest, so they draw a different
            sigil. Expected <code>{shortDigest(digest)}</code>, got{' '}
            <code>{shortDigest(computed)}</code>.
          </p>
        ) : null}
        {phase === 'match' ? (
          <p className={styles.verdictOk}>
            Seal matches. {sorted.length} {sorted.length === 1 ? 'file' : 'files'} hashed in this
            browser; the recomputed digest is identical
            {ms !== null ? ` (${Math.round(ms)} ms)` : ''}.
          </p>
        ) : null}
        {phase === 'error' ? (
          <p className={styles.verdictBad}>
            Could not fetch every file, so the seal was not checked.{' '}
            {rows.find((r) => r.status === 'error')?.note}
            {demo ? '' : '. The registry commit may not be published yet.'}
          </p>
        ) : null}
      </div>

      {base ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.verify}
            onClick={verify}
            disabled={phase === 'running'}
          >
            {phase === 'running' ? 'hashing…' : phase === 'idle' ? 'Verify seal' : 'Verify again'}
          </button>
          {demo ? (
            <label className={styles.tamper}>
              <input
                type="checkbox"
                checked={tamper}
                onChange={(e) => setTamper(e.target.checked)}
              />{' '}
              simulate one tampered byte <span>(demo only)</span>
            </label>
          ) : null}
        </div>
      ) : (
        <p className={styles.cannot}>{why}</p>
      )}

      <ol className={styles.files} aria-label="Payload files">
        {sorted.map((f, i) => {
          const r = rows[i]!
          return (
            <li key={f.path} data-status={r.status}>
              <span className={styles.fpath}>{f.path}</span>
              <span className={styles.fbytes}>{f.bytes.toLocaleString()} B</span>
              <code className={styles.fhash} title={`expected sha256:${f.sha256}`}>
                {(r.got ?? f.sha256).slice(0, 16)}
              </code>
              <span className={styles.fstate}>
                {r.status === 'ok'
                  ? '✓'
                  : r.status === 'bad'
                    ? '✕'
                    : r.status === 'fetch'
                      ? '…'
                      : r.status === 'error'
                        ? '!'
                        : ''}
                <span className="sr-only">{r.status}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className={styles.algo}>
        sha256 of sorted <code>{'"<sha256>  <path>\\n"'}</code> lines. Reproducible with coreutils;
        see <a href="/method#the-seal">the seal</a>.
      </p>
    </div>
  )
}

function chunk(d: string) {
  const hex = d.replace(/^sha256:/, '')
  return `sha256:\n${hex.match(/.{1,16}/g)?.join('\n') ?? hex}`
}

/** Strokes draw in, in order, as `progress` goes 0 → 1. */
function AssemblingGlyph({
  digest,
  progress,
  tone,
  size,
  lit,
}: {
  digest: string
  progress: number
  tone: string
  size: number
  lit: boolean
}) {
  const g = useMemo(() => glyph(digest), [digest])
  const w = glyphWeight(g, size)
  const n = g.polylines.length + g.dots.length
  return (
    <svg
      viewBox={GLYPH_VIEWBOX}
      width={size}
      height={size}
      className={styles.glyph}
      data-lit={lit}
      aria-hidden="true"
    >
      <g fill="none" stroke={tone} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
        {g.polylines.map((pl, i) => {
          const local = Math.min(1, Math.max(0, progress * n - i))
          return (
            <polyline
              // biome-ignore lint/suspicious/noArrayIndexKey: strokes are fixed for a digest
              key={i}
              points={pl.map((p) => `${p.x},${p.y}`).join(' ')}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - local}
              className={styles.stroke}
            />
          )
        })}
      </g>
      <g fill={tone}>
        {g.dots.map((d, i) => {
          const local = Math.min(1, Math.max(0, progress * n - g.polylines.length - i))
          return (
            <circle
              key={`${d.x},${d.y}`}
              cx={d.x}
              cy={d.y}
              r={d.r * Math.max(1, w / 3.6) * local}
            />
          )
        })}
      </g>
    </svg>
  )
}

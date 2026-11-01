import Link from 'next/link'
import { Frame } from '@/components/chrome/Frame'

export default function NotFound() {
  return (
    <Frame trail={[{ label: 'not found' }]}>
      <div style={{ maxWidth: 640, margin: '14vh auto', display: 'grid', gap: 16 }}>
        <p className="micro">404 · no such seal</p>
        <h1 className="display" style={{ fontSize: 'clamp(40px, 6vw, 72px)', lineHeight: 1 }}>
          Nothing is registered here.
        </h1>
        <p style={{ color: 'var(--bone-2)', fontSize: 13 }}>
          The address may be from an older registry, or the capability was renamed. Ask the Oracle
          instead, or return to <Link href="/">the observatory</Link>.
        </p>
      </div>
    </Frame>
  )
}

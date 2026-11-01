import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GLYPH_VIEWBOX, glyph } from '@core/glyph'
import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 }

const font = (name: string) => readFile(join(process.cwd(), 'assets', 'fonts', name))

async function fonts() {
  const [serif, mono, monoMedium] = await Promise.all([
    font('InstrumentSerif-Regular.ttf'),
    font('MartianMono-Regular.ttf'),
    font('MartianMono-Medium.ttf'),
  ])
  return [
    { name: 'Serif', data: serif, weight: 400 as const, style: 'normal' as const },
    { name: 'Mono', data: mono, weight: 400 as const, style: 'normal' as const },
    { name: 'Mono', data: monoMedium, weight: 500 as const, style: 'normal' as const },
  ]
}

function GlyphMark({ digest, size, color }: { digest: string; size: number; color: string }) {
  const g = glyph(digest)
  return (
    <svg width={size} height={size} viewBox={GLYPH_VIEWBOX} role="img">
      <title>sigil</title>
      <path
        d={g.path}
        fill="none"
        stroke={color}
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {g.dots.map((d) => (
        <circle key={`${d.x},${d.y}`} cx={d.x} cy={d.y} r={d.r} fill={color} />
      ))}
    </svg>
  )
}

export interface Card {
  digest: string
  kicker: string
  title: string
  line: string
  verdict?: { label: string; color: string; value?: string; interval?: string }
  demo: boolean
}

export async function ogImage(card: Card) {
  const tone = card.verdict?.color ?? '#ffaa45'
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: '#050505',
        color: '#ece5d8',
        fontFamily: 'Mono',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -120,
          top: -60,
          width: 760,
          height: 760,
          borderRadius: 760,
          background: `radial-gradient(circle, ${tone}33 0%, ${tone}10 38%, transparent 68%)`,
        }}
      />
      <div style={{ width: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GlyphMark digest={card.digest} size={380} color={tone} />
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingRight: 70,
          gap: 18,
        }}
      >
        <div
          style={{ fontSize: 18, letterSpacing: 3, color: '#908a7f', textTransform: 'uppercase' }}
        >
          {card.kicker}
        </div>
        <div
          style={{
            fontFamily: 'Serif',
            fontSize: card.title.length > 26 ? 64 : 80,
            lineHeight: 1,
            color: '#ece5d8',
          }}
        >
          {card.title}
        </div>
        <div style={{ fontSize: 22, lineHeight: 1.45, color: '#b9b2a5' }}>{card.line}</div>
        {card.verdict ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, marginTop: 10 }}>
            <div
              style={{
                fontSize: 22,
                letterSpacing: 4,
                color: tone,
                fontWeight: 500,
                textTransform: 'uppercase',
                paddingBottom: 10,
              }}
            >
              {card.verdict.label}
            </div>
            {card.verdict.value ? (
              <div style={{ fontSize: 72, lineHeight: 1, color: '#ece5d8' }}>
                {card.verdict.value}
              </div>
            ) : null}
            {card.verdict.interval ? (
              <div style={{ fontSize: 22, color: '#908a7f', paddingBottom: 10 }}>
                {card.verdict.interval}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 60,
          bottom: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 18,
          letterSpacing: 8,
          fontWeight: 500,
        }}
      >
        SIGIL
        <span style={{ letterSpacing: 2, color: '#908a7f', fontWeight: 400 }}>
          every AI agent capability, proven
        </span>
      </div>
      {card.demo ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            display: 'flex',
            padding: '10px 22px',
            background: '#ffaa45',
            color: '#1a0f02',
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: 4,
          }}
        >
          DEMO DATA · NOT EVIDENCE
        </div>
      ) : null}
    </div>,
    { ...OG_SIZE, fonts: await fonts() },
  )
}

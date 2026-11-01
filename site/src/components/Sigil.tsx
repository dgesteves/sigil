import { GLYPH_VIEWBOX, glyph, glyphWeight } from '@core/glyph'

/** The project's own mark: the sigil of sha256("Every AI agent capability, proven."). */
export const SIGIL_MARK = 'sha256:ff35d54bd63a5bd4dc9c26b3cbf0df0d59007c6cec865a28e1bbc7cc6be89b61'

interface Props {
  digest: string
  size?: number
  color?: string
  weight?: number
  title?: string
  className?: string
}

/** Renders a digest's sigil as SVG. Decorative unless a title is given. */
export function Sigil({
  digest,
  size = 64,
  color = 'currentColor',
  weight,
  title,
  className,
}: Props) {
  const g = glyph(digest)
  const w = weight ?? glyphWeight(g, size)
  const k = Math.max(1, w / 3.6)
  const body = (
    <>
      <path
        d={g.path}
        fill="none"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill={color}>
        {g.dots.map((d) => (
          <circle key={`${d.x},${d.y}`} cx={d.x} cy={d.y} r={d.r * k} />
        ))}
      </g>
    </>
  )
  if (title) {
    return (
      <svg
        viewBox={GLYPH_VIEWBOX}
        width={size}
        height={size}
        className={className}
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        {body}
      </svg>
    )
  }
  return (
    <svg
      viewBox={GLYPH_VIEWBOX}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  )
}

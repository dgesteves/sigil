import { glyph, glyphWeight } from '@core/glyph'

export interface Atlas {
  canvas: HTMLCanvasElement
  cols: number
  rows: number
  cell: number
}

/** The glyph fills this fraction of its cell, leaving padding so mipmaps never bleed. */
export const GLYPH_FILL = 0.86

export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  digest: string,
  x: number,
  y: number,
  size: number,
  color: string,
  displayPx: number,
) {
  const g = glyph(digest)
  const scale = (size * GLYPH_FILL) / 100
  ctx.save()
  ctx.translate(x + size / 2, y + size / 2)
  ctx.scale(scale, scale)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  const w = glyphWeight(g, displayPx)
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(g.path))
  const k = Math.max(1, w / 3.6)
  for (const d of g.dots) {
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r * k, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** One white sigil per cell. The renderer tints and lights them. */
export function buildAtlas(digests: readonly string[], maxTexture: number): Atlas {
  const count = Math.max(1, digests.length)
  let cell = 128
  let cols = Math.min(count, Math.floor(maxTexture / cell))
  while (Math.ceil(count / cols) * cell > maxTexture && cell > 32) {
    cell /= 2
    cols = Math.min(count, Math.floor(maxTexture / cell))
  }
  const rows = Math.ceil(count / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')!
  digests.forEach((d, i) => {
    drawGlyph(ctx, d, (i % cols) * cell, Math.floor(i / cols) * cell, cell, '#fff', 30)
  })
  return { canvas, cols, rows, cell }
}

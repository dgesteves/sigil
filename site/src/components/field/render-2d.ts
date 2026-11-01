/**
 * Canvas2D renderer for phones and machines without WebGL2: pre-tinted sprites and pre-rendered
 * halos, composited with "lighter" so it still reads as light, at a fraction of the cost.
 */
import { drawGlyph } from './atlas'
import type { FieldEngine } from './engine'

const SPRITE = 64

export class Canvas2DRenderer {
  private ctx: CanvasRenderingContext2D
  private sprites: HTMLCanvasElement[]
  private halos = new Map<string, HTMLCanvasElement>()

  constructor(canvas: HTMLCanvasElement, engine: FieldEngine) {
    this.ctx = canvas.getContext('2d')!
    this.sprites = engine.nodes.map((n) => {
      const c = document.createElement('canvas')
      c.width = c.height = SPRITE
      const [r, g, b] = n.style.rgb
      drawGlyph(c.getContext('2d')!, n.cap.digest, 0, 0, SPRITE, rgb(r, g, b), 26)
      return c
    })
  }

  private halo(r: number, g: number, b: number): HTMLCanvasElement {
    const key = `${r},${g},${b}`
    let c = this.halos.get(key)
    if (!c) {
      c = document.createElement('canvas')
      c.width = c.height = 128
      const ctx = c.getContext('2d')!
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, `rgba(${r * 255},${g * 255},${b * 255},0.55)`)
      grad.addColorStop(0.35, `rgba(${r * 255},${g * 255},${b * 255},0.16)`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 128, 128)
      this.halos.set(key, c)
    }
    return c
  }

  draw(engine: FieldEngine, dpr: number) {
    const ctx = this.ctx
    const canvas = ctx.canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'lighter'
    engine.nodes.forEach((n, i) => {
      const k = engine.intensity(n)
      if (k < 0.01) return
      const [r, g, b] = n.style.rgb
      if (n.style.glow > 0.05) {
        const s = n.size * 2.6
        ctx.globalAlpha = Math.min(1, n.style.glow * k)
        ctx.drawImage(this.halo(r, g, b), n.sx - s / 2, n.sy - s / 2, s, s)
      }
      ctx.globalAlpha = Math.min(1, n.style.bright * k)
      ctx.drawImage(this.sprites[i]!, n.sx - n.size / 2, n.sy - n.size / 2, n.size, n.size)
      if (n.style.ring > 0) {
        ctx.globalAlpha = 0.4 * k
        ctx.strokeStyle = rgb(r, g, b)
        ctx.lineWidth = 1
        if (n.style.ring === 3) {
          ctx.beginPath()
          ctx.moveTo(n.sx - n.size * 0.45, n.sy + n.size * 0.45)
          ctx.lineTo(n.sx + n.size * 0.45, n.sy - n.size * 0.45)
          ctx.stroke()
        } else {
          for (let ring = 0; ring < n.style.ring; ring++) {
            ctx.beginPath()
            ctx.arc(n.sx, n.sy, n.size * (0.56 + ring * 0.08), 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
      if (n.hover > 0.05) {
        ctx.globalAlpha = n.hover * 0.85
        ctx.strokeStyle = rgb(r, g, b)
        ctx.beginPath()
        ctx.arc(n.sx, n.sy, n.size * 0.74, 0, Math.PI * 2)
        ctx.stroke()
      }
    })
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  dispose() {}
}

function rgb(r: number, g: number, b: number) {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

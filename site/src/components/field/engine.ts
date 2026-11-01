/**
 * The observatory's physics and camera. Capabilities live on a disk (rim radius 1) seen at an
 * angle; the renderer only receives screen-space quads, so the WebGL and Canvas2D paths share
 * everything here. No DOM access: this file is plain math and state.
 */
import type { CapView } from '@/lib/model'
import { BANDS, bandOf, type FieldLayout, jitter } from './layout'

export interface Slot {
  x: number
  y: number
  size: number
}

export interface FieldNode {
  cap: CapView
  /** Disk-plane position and velocity. */
  x: number
  z: number
  vx: number
  vz: number
  tx: number
  tz: number
  /** Home on the disk before lensing: angle and radius. */
  theta: number
  r: number
  /** Screen position (CSS px), size (px) and depth (for the 2D painter). */
  sx: number
  sy: number
  size: number
  depth: number
  /** 0..1 springs. */
  ignite: number
  igniteAt: number
  focus: number
  focusV: number
  dim: number
  near: number
  hover: number
  slot: Slot | null
  style: NodeStyle
  phase: number
}

export interface NodeStyle {
  rgb: [number, number, number]
  glow: number
  bright: number
  scale: number
  /** 0 none, 1 validated, 2 verified, 3 revoked. */
  ring: number
  pulse: number
}

const STYLES: Record<string, Omit<NodeStyle, 'ring'>> = {
  proven: { rgb: [1.0, 0.64, 0.25], glow: 1.0, bright: 1.0, scale: 1.2, pulse: 0 },
  inconclusive: { rgb: [0.87, 0.79, 0.64], glow: 0.3, bright: 0.8, scale: 1.0, pulse: 0 },
  'no-effect': { rgb: [0.66, 0.68, 0.64], glow: 0.08, bright: 0.62, scale: 0.95, pulse: 0 },
  untested: { rgb: [0.5, 0.48, 0.45], glow: 0, bright: 0.52, scale: 0.86, pulse: 0 },
  harmful: { rgb: [1.0, 0.27, 0.2], glow: 0.9, bright: 1.0, scale: 1.08, pulse: 1 },
  revoked: { rgb: [0.68, 0.25, 0.2], glow: 0.15, bright: 0.62, scale: 0.9, pulse: 0 },
}

export function styleOf(cap: CapView): NodeStyle {
  const base = cap.level === 'revoked' ? STYLES.revoked! : STYLES[cap.uplift]!
  const ring =
    cap.level === 'revoked' ? 3 : cap.level === 'verified' ? 2 : cap.level === 'validated' ? 1 : 0
  return { ...base, ring }
}

export interface Camera {
  alpha: number
  dist: number
  focal: number
  cx: number
  cy: number
  rot: number
  yaw: number
  scale: number
}

export class FieldEngine {
  nodes: FieldNode[] = []
  w = 1
  h = 1
  camera: Camera = { alpha: 0.5, dist: 3.4, focal: 1, cx: 0, cy: 0, rot: 0, yaw: 0, scale: 1 }
  pointer = { x: -1e4, y: -1e4, active: false, wx: 99, wz: 99, px: 0, py: 0 }
  hovered = -1
  focused = -1
  oracle = false
  reduced = false
  compact = false
  time = 0
  private layoutRef: FieldLayout | undefined
  private parallax = { x: 0, y: 0 }
  private born = 0

  constructor(caps: readonly CapView[], reduced: boolean) {
    this.reduced = reduced
    const order = [...caps]
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    const delay = new Map(order.map(({ i }, n) => [i, n]))
    this.nodes = caps.map((cap, i) => ({
      cap,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      tx: 0,
      tz: 0,
      theta: 0,
      r: 0,
      sx: 0,
      sy: 0,
      size: 0,
      depth: 0,
      ignite: reduced ? 1 : 0,
      igniteAt: 0.15 + Math.min(1.1, (delay.get(i) ?? 0) * 0.028),
      focus: 0,
      focusV: 0,
      dim: 1,
      near: 0,
      hover: 0,
      slot: null,
      style: styleOf(cap),
      phase: jitter(cap.digest, 5) * Math.PI * 2,
    }))
  }

  resize(w: number, h: number) {
    this.w = w
    this.h = h
    this.compact = w < 720
    const portrait = h / w
    // Wide screens see the disk low and long; tall phones look down on it.
    const alpha = lerp(0.6, 1.1, clamp((portrait - 0.6) / 1.3, 0, 1))
    const cam = this.camera
    const rot = cam.rot
    Object.assign(cam, { alpha, dist: 3.4, focal: 1, cx: 0, cy: 0, rot: 0, scale: 1 })
    // Fit the labelled rim into the free band between the corner readouts.
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < 72; i++) {
      const p = this.polar((i / 72) * Math.PI * 2, 1.2)
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
    const availW = w * (this.compact ? 0.9 : 0.74)
    const availH = h * (this.compact ? 0.5 : 0.7)
    const f = Math.min(availW / (x1 - x0), availH / (y1 - y0))
    cam.focal = f
    cam.cx = w / 2 - (f * (x0 + x1)) / 2
    cam.cy = h * (this.compact ? 0.64 : 0.55) - (f * (y0 + y1)) / 2
    cam.rot = rot
  }

  /** Screen-space ellipse the field bends around: the intent line. */
  clear: { x: number; y: number; rx: number; ry: number } | null = null

  /**
   * Gravitational lensing, honestly labelled: a node whose home would sit under the intent is moved
   * outward along its own radius until it is visible. Radial order (evidence) is preserved.
   */
  lens(theta: number, r: number): number {
    const c = this.clear
    if (!c) return r
    const inside = (rr: number) => {
      const p = this.polar(theta, rr)
      // A superellipse hugs the text block's rounded rectangle better than an ellipse.
      const dx = (p.x - c.x) / c.rx
      const dy = (p.y - c.y) / c.ry
      return dx ** 4 + dy ** 4 < 1
    }
    if (!inside(r)) return r
    let lo = r
    let hi = r + 0.05
    while (inside(hi) && hi < 1.6) hi += 0.1
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2
      if (inside(mid)) lo = mid
      else hi = mid
    }
    // Keep the order of the bands: deeper evidence stays closer in, just compressed outward.
    return hi + (r - 0.4) * 0.12
  }

  setLayout(l: FieldLayout, instant = false) {
    this.layoutRef = l
    this.nodes.forEach((n, i) => {
      const s = l.place[i] ?? -1
      const sector = s >= 0 ? l.sectors[s] : undefined
      const [r0, r1] = bandOf(n.cap.uplift, n.cap.level, s >= 0)
      n.r = lerp(r0, r1, jitter(n.cap.digest, 1))
      n.theta = sector
        ? lerp(sector.start, sector.end, 0.18 + 0.64 * jitter(n.cap.digest, 2))
        : jitter(n.cap.digest, 3) * Math.PI * 2
      const r = this.lens(n.theta, n.r)
      n.tx = r * Math.sin(n.theta)
      n.tz = -r * Math.cos(n.theta)
      if (instant) {
        n.x = n.tx
        n.z = n.tz
      }
    })
  }

  get layout() {
    return this.layoutRef
  }

  setSlots(slots: Map<string, Slot> | null) {
    this.oracle = slots !== null
    for (const n of this.nodes) n.slot = slots?.get(n.cap.id) ?? null
  }

  setPointer(x: number, y: number, active: boolean) {
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.active = active
  }

  step(dtRaw: number) {
    const dt = Math.min(dtRaw, 1 / 30)
    this.time += dt
    this.born += dt
    const motion = this.reduced ? 0 : 1
    const cam = this.camera
    cam.rot += dt * motion * ((Math.PI * 2) / 600)
    // Pointer parallax: the instrument leans a little toward you.
    const px = this.pointer.active ? (this.pointer.x / this.w - 0.5) * 2 : 0
    const py = this.pointer.active ? (this.pointer.y / this.h - 0.5) * 2 : 0
    this.parallax.x += (px - this.parallax.x) * Math.min(1, dt * 2)
    this.parallax.y += (py - this.parallax.y) * Math.min(1, dt * 2)
    cam.yaw = this.parallax.x * 0.05 * motion
    cam.scale += ((this.oracle ? 0.9 : 1) - cam.scale) * Math.min(1, dt * 3)

    this.updatePointerOnDisk()

    const nodes = this.nodes
    const k = 7
    const c = 4.2
    const pr = 0.2
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (this.born > n.igniteAt) n.ignite = Math.min(1, n.ignite + dt * 1.8)
      // The disk turns under a fixed intent, so the lens is re-evaluated as it does.
      const lr = this.lens(n.theta, n.r)
      n.tx = lr * Math.sin(n.theta)
      n.tz = -lr * Math.cos(n.theta)
      const wob = 0.012 * motion
      const tx = n.tx + Math.sin(this.time * 0.37 + n.phase) * wob
      const tz = n.tz + Math.cos(this.time * 0.29 + n.phase * 1.3) * wob
      let fx = (tx - n.x) * k * (n.ignite > 0 ? 1 : 0)
      let fz = (tz - n.z) * k * (n.ignite > 0 ? 1 : 0)
      // The pointer parts the field gently.
      const dx = n.x - this.pointer.wx
      const dz = n.z - this.pointer.wz
      const d = Math.hypot(dx, dz)
      if (d < pr && d > 1e-4 && motion) {
        const f = ((pr - d) / pr) ** 2 * 2.4
        fx += (dx / d) * f
        fz += (dz / d) * f
      }
      n.near += ((d < pr * 1.6 ? 1 - d / (pr * 1.6) : 0) - n.near) * Math.min(1, dt * 6)
      n.vx = (n.vx + fx * dt) * Math.max(0, 1 - c * dt)
      n.vz = (n.vz + fz * dt) * Math.max(0, 1 - c * dt)
    }
    // Soft collisions keep sigils from stacking. N is small; the registry pages in long before
    // this quadratic loop matters.
    const minD = this.compact ? 0.08 : 0.072
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!
        const dx = a.x - b.x
        const dz = a.z - b.z
        const d2 = dx * dx + dz * dz
        if (d2 < minD * minD && d2 > 1e-8) {
          const d = Math.sqrt(d2)
          const push = ((minD - d) / d) * 0.5 * 6 * dt
          a.vx += dx * push
          a.vz += dz * push
          b.vx -= dx * push
          b.vz -= dz * push
        }
      }
    }
    for (const n of nodes) {
      n.x += n.vx * dt
      n.z += n.vz * dt
      if (this.reduced && !this.oracle) {
        n.x = n.tx
        n.z = n.tz
      }
      // Critically damped spring toward the Oracle's orbit, or back into the field.
      const target = n.slot ? 1 : 0
      if (this.reduced) {
        n.focus += (target - n.focus) * Math.min(1, dt * 8)
      } else {
        const w = 7.5
        const acc = w * w * (target - n.focus) - 2 * w * n.focusV
        n.focusV += acc * dt
        n.focus += n.focusV * dt
      }
      const dimTarget = this.oracle && !n.slot ? 0.13 : 1
      n.dim += (dimTarget - n.dim) * Math.min(1, dt * 4)
      const hv =
        this.hovered >= 0 && nodes[this.hovered] === n
          ? 1
          : this.focused >= 0 && nodes[this.focused] === n
            ? 1
            : 0
      n.hover += (hv - n.hover) * Math.min(1, dt * 10)
    }
    this.project()
  }

  /** World (disk) to screen. Returns px coordinates, pixels-per-unit scale and view depth. */
  toScreen(x: number, z: number, y = 0): { x: number; y: number; s: number; depth: number } {
    const cam = this.camera
    const cr = Math.cos(cam.rot + cam.yaw)
    const sr = Math.sin(cam.rot + cam.yaw)
    const rx = (x * cr - z * sr) * cam.scale
    const rz = (x * sr + z * cr) * cam.scale
    const sa = Math.sin(cam.alpha + this.parallax.y * 0.035 * (this.reduced ? 0 : 1))
    const ca = Math.cos(cam.alpha + this.parallax.y * 0.035 * (this.reduced ? 0 : 1))
    // Camera at (0, D sin a, D cos a) looking at the origin.
    const dy = y - cam.dist * sa
    const dz = rz - cam.dist * ca
    const yc = dy * ca - dz * sa
    const zc = -dy * sa - dz * ca
    const s = cam.focal / zc
    return { x: cam.cx + rx * s, y: cam.cy - yc * s, s, depth: zc }
  }

  /** Polar on the disk (theta clockwise from the far side) to screen. */
  polar(theta: number, r: number) {
    return this.toScreen(r * Math.sin(theta), -r * Math.cos(theta))
  }

  private updatePointerOnDisk() {
    const p = this.pointer
    if (!p.active) {
      p.wx = 99
      p.wz = 99
      return
    }
    // Invert the projection by search: few iterations of Newton on the disk plane are plenty.
    let x = 0
    let z = 0
    for (let it = 0; it < 6; it++) {
      const a = this.toScreen(x, z)
      const ax = this.toScreen(x + 0.01, z)
      const az = this.toScreen(x, z + 0.01)
      const j11 = (ax.x - a.x) / 0.01
      const j12 = (az.x - a.x) / 0.01
      const j21 = (ax.y - a.y) / 0.01
      const j22 = (az.y - a.y) / 0.01
      const det = j11 * j22 - j12 * j21
      if (Math.abs(det) < 1e-9) break
      const ex = p.x - a.x
      const ey = p.y - a.y
      x += (j22 * ex - j12 * ey) / det
      z += (-j21 * ex + j11 * ey) / det
    }
    p.wx = x
    p.wz = z
  }

  private project() {
    const base = this.compact ? 24 : 30
    for (const n of this.nodes) {
      const p = this.toScreen(n.x, n.z)
      const persp = p.s / (this.camera.focal / this.camera.dist)
      const sizeField =
        base *
        n.style.scale *
        persp *
        (0.55 + 0.45 * n.ignite) *
        (1 + n.near * 0.25 + n.hover * 0.55)
      const f = n.focus
      const e = f <= 0 ? 0 : Math.min(f, 1)
      if (n.slot) {
        n.sx = lerp(p.x, n.slot.x, e)
        n.sy = lerp(p.y, n.slot.y, e)
        n.size = lerp(sizeField, n.slot.size, e)
      } else if (e > 0.001) {
        n.sx = lerp(p.x, n.sx, e)
        n.sy = lerp(p.y, n.sy, e)
        n.size = lerp(sizeField, n.size, e)
      } else {
        n.sx = p.x
        n.sy = p.y
        n.size = sizeField
      }
      n.depth = p.depth
    }
  }

  pick(x: number, y: number): number {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]!
      if (n.ignite < 0.5 || (this.oracle && !n.slot && n.dim < 0.5)) continue
      const d = Math.hypot(n.sx - x, n.sy - y)
      const r = Math.max(14, n.size * 0.7)
      if (d < r && d < bestD) {
        best = i
        bestD = d
      }
    }
    return best
  }

  /** Brightness multiplier at this moment, including the harmful pulse. */
  intensity(n: FieldNode): number {
    const pulse =
      n.style.pulse && !this.reduced ? 0.82 + 0.18 * Math.sin(this.time * 2.2 + n.phase) : 1
    return n.ignite * n.dim * pulse * (1 + n.near * 0.35 + n.hover * 0.4)
  }
}

function rank(c: CapView): number {
  const order = { proven: 0, harmful: 1, inconclusive: 2, 'no-effect': 3, untested: 4 }
  return order[c.uplift]
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export { BANDS }

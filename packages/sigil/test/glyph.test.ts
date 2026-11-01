import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  digestDir,
  GLYPH_VERSION,
  type Glyph,
  glyph,
  glyphSvg,
  glyphWeight,
} from '../src/core/index.js'

const digestFor = (seed: string) =>
  `sha256:${createHash('sha256').update(seed).digest('hex')}` as const
const sample = (n: number, prefix = 'glyph') =>
  Array.from({ length: n }, (_, i) => digestFor(`${prefix}-${i}`))

/** Rasterizes a sigil onto a coarse grid, roughly what a 16px rendering resolves. */
function raster(g: Glyph, cells = 16): Uint8Array {
  const grid = new Uint8Array(cells * cells)
  const mark = (x: number, y: number) => {
    const cx = Math.min(cells - 1, Math.max(0, Math.floor(((x + 50) / 100) * cells)))
    const cy = Math.min(cells - 1, Math.max(0, Math.floor(((y + 50) / 100) * cells)))
    grid[cy * cells + cx] = 1
  }
  for (const line of g.polylines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!
      const b = line[i]!
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5)
      for (let s = 0; s <= steps; s++)
        mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)
    }
  }
  for (const d of g.dots) mark(d.x, d.y)
  return grid
}

describe('glyph', () => {
  it('is deterministic', () => {
    for (const d of sample(50)) expect(glyph(d)).toEqual(glyph(d))
  })

  it('accepts bare hex and normalises it', () => {
    const d = digestFor('bare')
    expect(glyph(d.slice('sha256:'.length))).toEqual(glyph(d))
    expect(glyph(d).digest).toBe(d)
  })

  it('rejects anything that is not a sha256 digest', () => {
    for (const bad of [
      '',
      'sha256:',
      'sha256:xyz',
      `sha1:${'a'.repeat(40)}`,
      `sha256:${'A'.repeat(64)}`,
    ])
      expect(() => glyph(bad)).toThrow(TypeError)
  })

  it('is pinned: changing the algorithm is a versioned change', async () => {
    // The good fixture's digest. If this fails on purpose, bump GLYPH_VERSION.
    const { digest } = await digestDir(
      join(import.meta.dirname, 'fixtures/good/catalog/skills/demo/hello-skill'),
    )
    const g = glyph(digest)
    expect(GLYPH_VERSION).toBe(1)
    expect(g.signature).toMatchInlineSnapshot(`"k6 m t fn i0 od d g 3.0>2.0>1.0>4.0---+3.0>0-"`)
    expect(createHash('sha256').update(g.path).digest('hex').slice(0, 16)).toMatchInlineSnapshot(
      `"12b04751825f03a7"`,
    )
  })

  it('draws valid, bounded geometry', () => {
    const pathGrammar =
      /^(?:M-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?:L-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?|(?:A\d+(?:\.\d+)? \d+(?:\.\d+)? 0 [01] 1 -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)+))+$/
    for (const d of sample(500)) {
      const g = glyph(d)
      expect(g.symmetry).toBeGreaterThanOrEqual(3)
      expect(g.symmetry).toBeLessThanOrEqual(8)
      expect(g.path).toMatch(pathGrammar)
      expect(g.strokes.length).toBeGreaterThan(0)
      expect(g.strokes.length).toBeLessThanOrEqual(64)
      expect(g.polylines).toHaveLength(g.strokes.length)
      // Ink, including half the stroke and each dot's radius, stays inside the 100-unit box.
      for (const p of g.polylines.flat()) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        expect(Math.max(Math.abs(p.x), Math.abs(p.y)) + g.weight / 2).toBeLessThan(50)
      }
      for (const d of g.dots) {
        expect(d.r).toBeGreaterThan(0)
        expect(Math.hypot(d.x, d.y) + d.r).toBeLessThan(50)
      }
    }
  })

  it('gives different content a different sigil', () => {
    const digests = sample(2000)
    const glyphs = digests.map(glyph)
    expect(new Set(glyphs.map((g) => g.path + JSON.stringify(g.dots))).size).toBe(2000)
    // The structural fingerprint is what a person compares: nearly all must differ.
    expect(new Set(glyphs.map((g) => g.signature)).size).toBeGreaterThan(1980)
    // Every family appears, so the field is varied.
    for (let k = 3; k <= 8; k++) expect(glyphs.some((g) => g.symmetry === k)).toBe(true)
    for (const f of ['none', 'full', 'broken', 'beaded'])
      expect(glyphs.some((g) => g.frame === f)).toBe(true)
  })

  it('flips to a different sigil when one leading bit changes', () => {
    for (const d of sample(100, 'flip')) {
      const hex = d.slice(7)
      for (const nibble of [0, 1, 2, 3, 4, 5]) {
        const v = Number.parseInt(hex[nibble]!, 16) ^ 1
        const flipped = `sha256:${hex.slice(0, nibble)}${v.toString(16)}${hex.slice(nibble + 1)}`
        expect(glyph(flipped).path + JSON.stringify(glyph(flipped).dots)).not.toBe(
          glyph(d).path + JSON.stringify(glyph(d).dots),
        )
      }
    }
  })

  it('stays distinct at 16px', () => {
    const rasters = sample(300, 'small').map((d) => raster(glyph(d)))
    let close = 0
    let pairs = 0
    for (let a = 0; a < rasters.length; a++) {
      for (let b = a + 1; b < rasters.length; b++) {
        let diff = 0
        const ra = rasters[a]!
        const rb = rasters[b]!
        for (let i = 0; i < ra.length; i++) diff += ra[i]! ^ rb[i]!
        pairs++
        if (diff < 12) close++
      }
    }
    expect(close / pairs).toBeLessThan(0.002)
  })

  it('keeps strokes legible when drawn small', () => {
    const g = glyph(digestFor('weight'))
    expect(glyphWeight(g, 256)).toBe(g.weight)
    expect(glyphWeight(g, 16) * (16 / 100)).toBeGreaterThanOrEqual(1.2)
  })

  it('renders a standalone, accessible SVG', () => {
    const d = digestFor('svg')
    const decorative = glyphSvg(d, { size: 24 })
    expect(decorative).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-50 -50 100 100"/,
    )
    expect(decorative).toContain('aria-hidden="true"')
    const named = glyphSvg(d, { title: 'demo/<x> & "y"', color: '#fff' })
    expect(named).toContain('role="img"')
    expect(named).toContain('<title>demo/&lt;x&gt; &amp; &quot;y&quot;</title>')
    expect(named).not.toContain('<x>')
  })
})

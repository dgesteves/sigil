import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/server/markdown'

describe('markdown headings', () => {
  it('keeps the anchors the method page links to', () => {
    const md = readFileSync(join(import.meta.dirname, '../../spec/METHODOLOGY.md'), 'utf8')
    const { headings } = renderMarkdown(md)
    expect(headings).toContainEqual({ id: 'the-seal', text: 'The seal', depth: 2 })
    expect(headings).toContainEqual({
      id: 'reproducing-a-result',
      text: 'Reproducing a result',
      depth: 2,
    })
    for (const h of headings) expect(h.id).toMatch(/^[\p{L}\p{N}-]+$/u)
  })

  it('takes heading text from the words, never from markup', () => {
    const { headings } = renderMarkdown(
      '## Use `zod` & <b>care</b>\n\n## <scr<script>ipt>alert(1)</script> done\n',
    )
    expect(headings[0]).toEqual({ id: 'use-zod--care', text: 'Use zod & care', depth: 2 })
    // Heading text is plain text: the method page renders it as a React text child, which escapes
    // it. The anchor id is what lands in markup, and it never keeps a markup character.
    expect(headings[1]!.id).toMatch(/^[\p{L}\p{N}-]+$/u)
  })
})

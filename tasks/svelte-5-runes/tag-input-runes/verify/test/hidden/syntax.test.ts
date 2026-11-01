import { readFileSync } from 'node:fs'
import { compile } from 'svelte/compiler'
import { expect, test } from 'vitest'

// The request was a port to Svelte 5 syntax: deprecated Svelte 4 constructs must be gone.
for (const file of ['src/lib/TagInput.svelte', 'src/lib/IssueForm.svelte']) {
  test(`${file} compiles in runes mode without deprecated syntax`, () => {
    const source = readFileSync(file, 'utf8')
    const { warnings } = compile(source, { filename: file, runes: true, generate: 'client' })
    const deprecated = warnings.filter((w) => w.code.endsWith('_deprecated')).map((w) => w.code)
    expect(deprecated).toEqual([])
    expect(source).not.toMatch(/createEventDispatcher/)
  })
}

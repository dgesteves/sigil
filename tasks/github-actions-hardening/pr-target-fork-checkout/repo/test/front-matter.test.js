import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frontMatter } from '../src/index.js'

test('splits front matter from the body', () => {
  assert.deepEqual(frontMatter('---\ntitle: Hi\n---\n# Hi\n'), { data: { title: 'Hi' }, body: '# Hi\n' })
})

test('documents without front matter are all body', () => {
  assert.deepEqual(frontMatter('# Plain\n'), { data: {}, body: '# Plain\n' })
})

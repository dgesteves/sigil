import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadLayers, merge } from '../src/config.js'

test('later layers win, nested keys merge', () => {
  assert.deepEqual(merge({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } })
})

test('missing files are skipped', () => {
  const files = { 'base.yaml': 'port: 80\nlog: { level: info }\n' }
  const read = (p) => {
    if (!(p in files)) throw Object.assign(new Error('nope'), { code: 'ENOENT' })
    return files[p]
  }
  assert.deepEqual(loadLayers(['base.yaml', 'local.yaml'], read), { port: 80, log: { level: 'info' } })
})

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAllDocuments } from 'yaml'

const dir = 'deploy/k8s'
const docs = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => parseAllDocuments(readFileSync(join(dir, f), 'utf8')).map((d) => ({ f, d })))

test('every manifest parses', () => {
  for (const { f, d } of docs) assert.deepEqual(d.errors, [], f)
})

test('every image is pinned to a version', () => {
  const text = docs.map(({ d }) => JSON.stringify(d.toJS())).join('\n')
  for (const [, image] of text.matchAll(/"image":"([^"]+)"/g))
    assert.match(image, /(:[\w.-]+|@sha256:[a-f0-9]{64})$/, image)
})

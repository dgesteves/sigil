import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(rel) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [rel] : []
  })
}

test('zod stays on 4.6.7', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies?.zod, '4.6.7')
  assert.equal(JSON.parse(read('node_modules/zod/package.json')).version, '4.6.7')
})

test('src uses the Zod 4 API, not the zod/v3 compatibility export', () => {
  for (const file of sourceFiles('src')) {
    assert.doesNotMatch(read(file), /['"]zod\/v3['"]/, `${file} imports zod/v3`)
  }
})

test('the type checker is not silenced', () => {
  for (const file of sourceFiles('src')) {
    assert.doesNotMatch(read(file), /@ts-(ignore|nocheck|expect-error)/, `${file} suppresses type errors`)
  }
})

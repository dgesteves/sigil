import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/slugify.js'

test('lowercases and joins words with hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/slugify.js'

test('strips accents to ASCII', () => {
  assert.equal(slugify('Crème Brûlée -- 2 Ways!'), 'creme-brulee-2-ways')
  assert.equal(slugify('Ünïcödé'), 'unicode')
})

test('treats any non-alphanumeric run as one separator', () => {
  assert.equal(slugify('a_b.c'), 'a-b-c')
  assert.equal(slugify('Hello,   World'), 'hello-world')
})

test('never starts or ends with a hyphen', () => {
  assert.equal(slugify('  Hello World!  '), 'hello-world')
  assert.equal(slugify('---'), '')
})

test('keeps the existing behaviour', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
})

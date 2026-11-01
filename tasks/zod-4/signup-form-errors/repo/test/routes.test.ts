import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleSignup, type UserStore } from '../src/routes.ts'
import type { NewUser } from '../src/signup.ts'

function memoryStore() {
  const created: NewUser[] = []
  const store: UserStore = {
    async create(user) {
      created.push(user)
      return { id: `user_${created.length}` }
    },
  }
  return { store, created }
}

const validForm = {
  email: 'ada@example.com',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
  displayName: 'Ada',
  address: { line1: '12 Analytical Row', line2: '', postcode: 'EC1A 1BB' },
  interests: ['news'],
}

test('creates the user for a valid form', async () => {
  const { store, created } = memoryStore()
  const res = await handleSignup(validForm, store)
  assert.equal(res.status, 201)
  assert.deepEqual(res.body, { id: 'user_1' })
  assert.equal(created.length, 1)
  assert.equal(created[0]?.email, 'ada@example.com')
})

test('rejects a form without an email', async () => {
  const { store, created } = memoryStore()
  const res = await handleSignup({ ...validForm, email: undefined }, store)
  assert.equal(res.status, 422)
  assert.deepEqual((res.body as { errors: Record<string, string[]> }).errors.email, ['Email is required'])
  assert.equal(created.length, 0)
})

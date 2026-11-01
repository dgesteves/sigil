import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { validateSignup } from '../../src/signup.ts'

const PASSWORD = 'correct horse battery'

function form(overrides: Record<string, unknown> = {}) {
  return {
    email: 'ada@example.com',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    displayName: 'Ada',
    address: { line1: '12 Analytical Row', line2: 'Flat 2', postcode: 'EC1A 1BB' },
    interests: ['news', 'events'],
    ...overrides,
  }
}

function errorsOf(body: unknown): Record<string, string[]> {
  const result = validateSignup(body)
  assert.equal(result.ok, false, `expected the form to be rejected: ${JSON.stringify(body)}`)
  if (result.ok) throw new Error('unreachable')
  for (const [key, messages] of Object.entries(result.errors)) {
    assert.ok(Array.isArray(messages), `errors[${key}] must be an array`)
    for (const m of messages) assert.equal(typeof m, 'string', `errors[${key}] must contain strings`)
  }
  return { ...result.errors }
}

function userOf(body: unknown) {
  const result = validateSignup(body)
  assert.equal(result.ok, true, `expected the form to be accepted, got ${JSON.stringify(result)}`)
  if (!result.ok) throw new Error('unreachable')
  return result.user as unknown as Record<string, unknown> & { address: Record<string, unknown> }
}

describe('valid forms', () => {
  test('returns the user without confirmPassword or unknown fields', () => {
    const user = userOf(form({ role: 'admin', isVerified: 'true' }))
    assert.equal(user.email, 'ada@example.com')
    assert.equal(user.password, PASSWORD)
    assert.equal(user.displayName, 'Ada')
    assert.equal(user.address.line1, '12 Analytical Row')
    assert.equal(user.address.line2, 'Flat 2')
    assert.equal(user.address.postcode, 'EC1A 1BB')
    assert.deepEqual([...(user.interests as string[])], ['news', 'events'])
    assert.equal('confirmPassword' in user, false)
    assert.equal('role' in user, false)
    assert.equal('isVerified' in user, false)
  })

  test('trims and lowercases the email', () => {
    assert.equal(userOf(form({ email: '  Ada.Lovelace@Example.COM ' })).email, 'ada.lovelace@example.com')
  })

  test('optional fields may be blank or absent; interests default to []', () => {
    const body = form({ displayName: '', address: { line1: '1 Main St', line2: '', postcode: 'N1 9GU' } })
    delete (body as Record<string, unknown>).interests
    const user = userOf(body)
    assert.equal(user.displayName, undefined)
    assert.equal(user.address.line2, undefined)
    assert.deepEqual([...(user.interests as string[])], [])
  })
})

describe('one message per problem', () => {
  test('missing or blank email', () => {
    assert.deepEqual(errorsOf(form({ email: undefined })), { email: ['Email is required'] })
    assert.deepEqual(errorsOf(form({ email: '' })), { email: ['Email is required'] })
  })

  for (const email of ['not-an-email', 'ada@', 'ada@example', 'ada@@example.com']) {
    test(`invalid email ${email}`, () => {
      assert.deepEqual(errorsOf(form({ email })), { email: ['Enter a valid email address'] })
    })
  }

  test('missing or blank password', () => {
    assert.deepEqual(errorsOf(form({ password: undefined, confirmPassword: undefined })).password, [
      'Password is required',
    ])
    assert.deepEqual(errorsOf(form({ password: '', confirmPassword: '' })).password, ['Password is required'])
  })

  test('short password', () => {
    assert.deepEqual(errorsOf(form({ password: 'short', confirmPassword: 'short' })), {
      password: ['Password must be at least 12 characters'],
    })
  })

  test('password mismatch', () => {
    assert.deepEqual(errorsOf(form({ confirmPassword: `${PASSWORD}!` })), {
      confirmPassword: ['Passwords do not match'],
    })
  })

  for (const displayName of ['A', 'x'.repeat(31)]) {
    test(`display name of length ${displayName.length}`, () => {
      assert.deepEqual(errorsOf(form({ displayName })), {
        displayName: ['Display name must be 2 to 30 characters'],
      })
    })
  }

  test('blank address fields use nested paths', () => {
    assert.deepEqual(errorsOf(form({ address: { line1: '', line2: '', postcode: '' } })), {
      'address.line1': ['Address line 1 is required'],
      'address.postcode': ['Postcode is required'],
    })
  })

  test('unknown interests are reported by index', () => {
    assert.deepEqual(errorsOf(form({ interests: ['news', 'spam', 'events', 'junk'] })), {
      'interests.1': ['Unknown interest'],
      'interests.3': ['Unknown interest'],
    })
  })
})

test('reports every problem at once, including the password mismatch', () => {
  const body = form({
    email: '',
    confirmPassword: 'correct horse batterY',
    address: { line1: '', postcode: 'EC1A 1BB' },
    interests: ['spam'],
  })
  assert.deepEqual(errorsOf(body), {
    email: ['Email is required'],
    confirmPassword: ['Passwords do not match'],
    'address.line1': ['Address line 1 is required'],
    'interests.0': ['Unknown interest'],
  })
})

describe('hostile bodies are rejected without throwing', () => {
  for (const body of [null, undefined, 'email=ada@example.com', 42, [], { email: 42, password: ['x'] }]) {
    test(JSON.stringify(body) ?? 'undefined', () => {
      const result = validateSignup(body)
      assert.equal(result.ok, false)
    })
  }

  test('a non-string email is reported on the email field', () => {
    const errors = errorsOf(form({ email: 42 }))
    assert.ok((errors.email ?? []).length > 0)
  })
})

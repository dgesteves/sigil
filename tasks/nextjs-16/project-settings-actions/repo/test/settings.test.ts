import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { byTestId, forms, lastTestId, type Server, startServer } from './harness.ts'

const ALICE = 'session=sess_7f3a1c9e'
const BOB = 'session=sess_19c2b84d'

let server: Server
before(async () => {
  server = await startServer()
})
after(() => server?.stop())

test('signed-out visitors are sent to sign in', async () => {
  const res = await server.get('/projects/prj_atlas/settings')
  assert.equal(res.status, 307)
  assert.equal(res.headers.get('location'), '/login?next=%2Fprojects%2Fprj_atlas%2Fsettings')
})

test('the project list shows owned and shared projects', async () => {
  const { html } = await server.get('/projects', ALICE)
  assert.deepEqual(byTestId(html, 'project').sort(), ['Atlas', 'Beacon', 'Delta'])
})

test('owners get the rename form, members do not', async () => {
  const owner = await server.get('/projects/prj_atlas/settings', ALICE)
  assert.equal(lastTestId(owner.html, 'project-name'), 'Atlas')
  assert.ok(forms(owner.html).some((f) => f.fields.some(([k]) => k === 'name')))

  const member = await server.get('/projects/prj_atlas/settings', BOB)
  assert.equal(member.status, 200)
  assert.ok(!forms(member.html).some((f) => f.fields.some(([k]) => k === 'name')))
})

test('people outside the project get a 404', async () => {
  const res = await server.get('/projects/prj_cobalt/settings', ALICE)
  assert.equal(res.status, 404)
})

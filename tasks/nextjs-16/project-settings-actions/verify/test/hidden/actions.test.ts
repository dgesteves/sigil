import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { byTestId, type Form, forms, readJson, type Server, setField, startServer } from './harness.ts'

const ALICE = 'session=sess_7f3a1c9e' // owns Atlas and Delta, member of Beacon
const BOB = 'session=sess_19c2b84d' // owns Beacon and Echo, member of Atlas
const CARA = 'session=sess_5e8d06aa' // owns Cobalt, member of Delta
type Projects = Record<string, { name: string; ownerId: string }>
const projects = () => readJson<Projects>('data/projects.json')

let server: Server
before(async () => {
  server = await startServer()
})
after(() => server?.stop())

async function settingsForms(id: string, cookie: string) {
  const { status, html } = await server.get(`/projects/${id}/settings`, cookie)
  assert.equal(status, 200, `GET /projects/${id}/settings returned ${status}`)
  return forms(html)
}
const isDeleteForm = (f: Form) => /<button\b[^>]*>\s*Delete project\s*<\/button>/i.test(f.html)
const isRenameForm = (f: Form) => f.fields.some(([k]) => k === 'name')

async function ownForm(id: string, cookie: string, pick: (f: Form) => boolean, what: string) {
  const form = (await settingsForms(id, cookie)).find(pick)
  assert.ok(form, `the owner's settings page for ${id} has no server-rendered ${what} form`)
  return form
}

/** What an attacker does with their own project's form: swap in someone else's project id. */
const retarget = (fields: [string, string][], from: string, to: string): [string, string][] =>
  fields.map(([k, v]) => [k, v.replaceAll(from, to)])

describe('rename', () => {
  test('the owner can still rename, and the name is trimmed', async () => {
    const form = await ownForm('prj_delta', ALICE, isRenameForm, 'rename')
    await server.submit('/projects/prj_delta/settings', setField(form.fields, 'name', '  Delta two  '), ALICE)
    assert.equal(projects().prj_delta!.name, 'Delta two')
  })

  test('names must be 1 to 80 characters after trimming', async () => {
    const form = await ownForm('prj_delta', ALICE, isRenameForm, 'rename')
    for (const bad of ['', '    ', 'x'.repeat(81), ` ${'y'.repeat(81)} `]) {
      await server.submit('/projects/prj_delta/settings', setField(form.fields, 'name', bad), ALICE)
      assert.equal(projects().prj_delta!.name, 'Delta two', `rename to ${JSON.stringify(bad)} was accepted`)
    }
    await server.submit('/projects/prj_delta/settings', setField(form.fields, 'name', 'z'.repeat(80)), ALICE)
    assert.equal(projects().prj_delta!.name, 'z'.repeat(80))
  })

  test('a member cannot rename the project by replaying their own rename form', async () => {
    const own = await ownForm('prj_echo', BOB, isRenameForm, 'rename')
    const forged = setField(retarget(own.fields, 'prj_echo', 'prj_atlas'), 'name', 'Pwned by Bob')
    await server.submit('/projects/prj_echo/settings', forged, BOB)
    await server.submit('/projects/prj_atlas/settings', forged, BOB)
    assert.equal(projects().prj_atlas!.name, 'Atlas')
  })

  test('an outsider cannot rename the project either', async () => {
    const own = await ownForm('prj_cobalt', CARA, isRenameForm, 'rename')
    const forged = setField(retarget(own.fields, 'prj_cobalt', 'prj_atlas'), 'name', 'Pwned by Cara')
    await server.submit('/projects/prj_cobalt/settings', forged, CARA)
    assert.equal(projects().prj_atlas!.name, 'Atlas')
  })
})

describe('delete', () => {
  test('the owner gets a delete form', async () => {
    assert.ok((await settingsForms('prj_atlas', ALICE)).some(isDeleteForm))
  })

  test('a member cannot delete the project by replaying their own delete form', async () => {
    // Bob replays the delete form of a project he owns, with Atlas's id swapped in wherever it appears.
    const own = await ownForm('prj_echo', BOB, isDeleteForm, 'delete')
    const forged = retarget(own.fields, 'prj_echo', 'prj_atlas')
    await server.submit('/projects/prj_echo/settings', forged, BOB)
    await server.submit('/projects/prj_atlas/settings', forged, BOB)
    assert.ok(projects().prj_atlas, 'Bob deleted Alice’s project Atlas')
  })

  test('an outsider cannot delete the project', async () => {
    const own = await ownForm('prj_cobalt', CARA, isDeleteForm, 'delete')
    await server.submit('/projects/prj_cobalt/settings', retarget(own.fields, 'prj_cobalt', 'prj_atlas'), CARA)
    assert.ok(projects().prj_atlas, 'Cara deleted Alice’s project Atlas')
  })

  test('signed-out requests cannot delete', async () => {
    const own = await ownForm('prj_atlas', ALICE, isDeleteForm, 'delete')
    await server.submit('/projects/prj_atlas/settings', own.fields)
    await server.submit('/projects/prj_atlas/settings', own.fields, 'session=sess_expired0')
    assert.ok(projects().prj_atlas, 'a request without a valid session deleted Atlas')
  })

  test('the owner deletes the project and lands on /projects', async () => {
    const form = await ownForm('prj_atlas', ALICE, isDeleteForm, 'delete')
    const res = await server.submit('/projects/prj_atlas/settings', form.fields, ALICE)
    assert.equal(res.status, 303, `deleting returned ${res.status}\n${server.output().slice(-1500)}`)
    assert.equal(new URL(res.headers.get('location')!, server.url).pathname, '/projects')
    assert.equal(projects().prj_atlas, undefined)
    assert.ok(projects().prj_beacon && projects().prj_delta, 'deleting Atlas removed other projects')

    const list = await server.get('/projects', ALICE)
    assert.deepEqual(byTestId(list.html, 'project').sort(), ['Beacon', 'z'.repeat(80)])
    assert.equal((await server.get('/projects/prj_atlas/settings', ALICE)).status, 404)
  })
})

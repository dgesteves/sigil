import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runSupportTurn } from '../../src/agent.ts'
import { createMemoryConversationStore, handleMessage } from '../../src/handler.ts'
import { FALLBACK_REPLY, SUPPORT_POLICY } from '../../src/policy.ts'
import { createMemoryTicketStore } from '../../src/tickets.ts'
import { findTool, properties, scriptedModel, text, toolCalls, toolResults } from './_model.mjs'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'))
const CONVERSATION = fixture('conversation.json')
const LEGACY = fixture('legacy-conversation.json')
const USER = { id: 'u-7', orgId: 'org-acme' }

const TICKETS = [
  { id: 'T-101', orgId: 'org-acme', title: 'CSV export does nothing', status: 'open', priority: 'normal' },
  { id: 'T-102', orgId: 'org-acme', title: 'Login loop on SSO', status: 'open', priority: 'normal' },
  { id: 'T-900', orgId: 'org-evil', title: 'Login page typo', status: 'open', priority: 'high' },
]

function spyTickets() {
  const store = createMemoryTicketStore(TICKETS)
  const calls = { search: [], setPriority: [] }
  return {
    calls,
    store,
    async search(orgId, query) {
      calls.search.push([orgId, query])
      return store.search(orgId, query)
    },
    async setPriority(orgId, ticketId, priority) {
      calls.setPriority.push([orgId, ticketId, priority])
      return store.setPriority(orgId, ticketId, priority)
    },
  }
}

// The tests adapt to the input property names the implementation chose.
function searchInput(options, query, extra = {}) {
  const props = properties(findTool(options, 'searchTickets'))
  const key = props.find((p) => /query|search|term|text|^q$/i.test(p)) ?? props[0] ?? 'query'
  return { [key]: query, ...extra }
}
function priorityInput(options, ticketId, priority, extra = {}) {
  const props = properties(findTool(options, 'setTicketPriority'))
  const idKey = props.find((p) => /id/i.test(p)) ?? 'ticketId'
  const prioKey = props.find((p) => /prio/i.test(p)) ?? props.find((p) => p !== idKey) ?? 'priority'
  return { [idKey]: ticketId, [prioKey]: priority, ...extra }
}

const search = (query, extra) => (o) => toolCalls(['searchTickets', searchInput(o, query, extra)])
const setPriority = (id, prio, extra) => (o) =>
  toolCalls(['setTicketPriority', priorityInput(o, id, prio, extra)])

const textOf = (message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')
const partsOf = (message, type) =>
  typeof message.content === 'string' ? [] : message.content.filter((p) => p.type === type)

async function turn(steps, { history = CONVERSATION, message = 'Please make the SSO login ticket urgent.' } = {}) {
  const model = scriptedModel(steps)
  const tickets = spyTickets()
  const result = await runSupportTurn({ model, user: USER, history, message, tickets })
  return { model, tickets, result, message }
}

test('both tools are offered to the model with real input schemas', async () => {
  const { model } = await turn([text('Hello!')])
  const searchTool = findTool(model.calls[0], 'searchTickets')
  const priorityTool = findTool(model.calls[0], 'setTicketPriority')
  assert.ok(searchTool, 'no searchTickets tool was sent to the model')
  assert.ok(priorityTool, 'no setTicketPriority tool was sent to the model')
  assert.ok(properties(searchTool).length >= 1, JSON.stringify(searchTool.inputSchema))
  assert.ok(properties(priorityTool).length >= 2, JSON.stringify(priorityTool.inputSchema))
})

test('chains tool calls and reports the whole turn', async () => {
  const { model, tickets, result, message } = await turn([
    search('login'),
    setPriority('T-102', 'urgent'),
    text('Done: T-102 "Login loop on SSO" is now urgent.'),
  ])

  assert.equal(result.reply, 'Done: T-102 "Login loop on SSO" is now urgent.')
  assert.deepEqual(tickets.calls.search, [['org-acme', 'login']])
  assert.deepEqual(tickets.calls.setPriority, [['org-acme', 'T-102', 'urgent']])
  assert.equal(model.calls.length, 3)
  const sent = JSON.stringify(toolResults(model.calls[1]).map((r) => r.output))
  assert.ok(sent.includes('T-102'), `search results were not sent back to the model: ${sent}`)

  assert.deepEqual(result.toolsUsed, ['searchTickets', 'setTicketPriority'])
  assert.equal(result.usage.inputTokens, 30, 'input tokens must cover all three model calls')
  assert.equal(result.usage.outputTokens, 15, 'output tokens must cover all three model calls')

  const roles = result.newMessages.map((m) => m.role)
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])
  assert.equal(textOf(result.newMessages[0]), message)
  const calledTools = result.newMessages.flatMap((m) => partsOf(m, 'tool-call')).map((p) => p.toolName)
  assert.deepEqual(calledTools, ['searchTickets', 'setTicketPriority'])
  const resultTools = result.newMessages.flatMap((m) => partsOf(m, 'tool-result')).map((p) => p.toolName)
  assert.deepEqual(resultTools, ['searchTickets', 'setTicketPriority'])
  assert.equal(textOf(result.newMessages.at(-1)), result.reply)
})

test('the next turn sees the previous turn\'s tool calls and results', async () => {
  const conversations = createMemoryConversationStore({ c1: CONVERSATION })
  const tickets = spyTickets()
  const first = scriptedModel([search('login'), setPriority('T-102', 'urgent'), text('Done.')])
  await handleMessage({ model: first, user: USER, conversationId: 'c1', text: 'Make the SSO ticket urgent', conversations, tickets })
  const second = scriptedModel([text('It is T-102.')])
  await handleMessage({ model: second, user: USER, conversationId: 'c1', text: 'Which ticket was that?', conversations, tickets })

  const prompt = second.calls[0].prompt
  const parts = prompt.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  assert.equal(parts.filter((p) => p.type === 'tool-call').length, 2, 'earlier tool calls are missing')
  assert.equal(parts.filter((p) => p.type === 'tool-result').length, 2, 'earlier tool results are missing')
})

test('the current policy is sent as instructions and the history follows it', async () => {
  const { model, message } = await turn([text('Sure.')])
  const prompt = model.calls[0].prompt
  const system = prompt.filter((m) => m.role === 'system')
  assert.ok(
    system.some((m) => m.content.includes(SUPPORT_POLICY)),
    'SUPPORT_POLICY was not sent as instructions',
  )
  const rest = prompt.filter((m) => m.role !== 'system')
  assert.deepEqual(
    rest.map(textOf),
    [...CONVERSATION.map(textOf), message],
    'the stored history and the new message must be sent in order',
  )
})

test('legacy conversations work and their old system prompt never reaches the model', async () => {
  const { model, result } = await turn([text('Let me check the tickets.')], { history: LEGACY, message: 'Any news?' })
  assert.equal(result.reply, 'Let me check the tickets.')
  const prompt = model.calls[0].prompt
  const system = prompt.filter((m) => m.role === 'system')
  assert.ok(system.some((m) => m.content.includes(SUPPORT_POLICY)), 'SUPPORT_POLICY was not sent')
  assert.ok(!JSON.stringify(prompt).includes('HelpBot 1.0'), 'the legacy system prompt was sent')
  const texts = prompt.filter((m) => m.role !== 'system').map(textOf)
  assert.deepEqual(texts, [...LEGACY.slice(1).map(textOf), 'Any news?'])
})

test('tools only ever touch the signed-in user\'s org, whatever the model sends', async () => {
  const evil = { orgId: 'org-evil', org: 'org-evil', tenantId: 'org-evil' }
  const { tickets } = await turn([
    (o) => toolCalls(['searchTickets', searchInput(o, 'login', evil)], ['setTicketPriority', priorityInput(o, 'T-900', 'low', evil)]),
    text('Done.'),
  ])
  const orgs = [...tickets.calls.search, ...tickets.calls.setPriority].map((c) => c[0])
  assert.ok(orgs.length > 0, 'the tools never reached the ticket store')
  assert.ok(orgs.every((org) => org === 'org-acme'), `store called with orgs ${JSON.stringify(orgs)}`)
  const [evilTicket] = await tickets.store.search('org-evil', 'login')
  assert.equal(evilTicket.priority, 'high', 'another org\'s ticket was modified')
})

test('an invalid priority from the model never reaches the store', async () => {
  const { tickets, result } = await turn([setPriority('T-102', 'whenever'), text('That priority does not exist.')])
  assert.ok(
    tickets.calls.setPriority.every(([, , priority]) => ['low', 'normal', 'high', 'urgent'].includes(priority)),
    JSON.stringify(tickets.calls.setPriority),
  )
  assert.equal(result.reply, 'That priority does not exist.')
})

test('stops after 6 model calls and falls back when there is no final answer', async () => {
  let n = 0
  const { model, result } = await turn([(o) => toolCalls(['searchTickets', searchInput(o, `term ${n++}`)])])
  assert.ok(model.calls.length >= 2, 'the agent never continued after a tool call')
  assert.ok(model.calls.length <= 6, `the model was called ${model.calls.length} times`)
  assert.equal(result.reply, FALLBACK_REPLY)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerCustomer } from '../../src/assistant.ts'
import { createMemoryOrderStore } from '../../src/orders.ts'
import { findTool, properties, scriptedModel, text, toolCalls, toolResults } from './_model.mjs'

const ORDERS = [
  { id: 'ORD-1001', status: 'shipped', carrier: 'DHL', eta: '2026-11-04' },
  { id: 'ORD-1002', status: 'processing' },
]

function spyStore() {
  const store = createMemoryOrderStore(ORDERS)
  const lookups = []
  return {
    lookups,
    async findById(id) {
      lookups.push(id)
      return store.findById(id)
    },
  }
}

/** The input property the implementation chose for the order id (orderId, id, order_id, ...). */
function idProperty(options) {
  const tool = findTool(options, 'getOrderStatus')
  const props = properties(tool)
  return props.find((p) => /order|id/i.test(p)) ?? props[0] ?? 'orderId'
}

const callStatus = (orderId) => (options) =>
  toolCalls(['getOrderStatus', { [idProperty(options)]: orderId }])

test('the model is offered a getOrderStatus tool with a real input schema', async () => {
  const model = scriptedModel([text('Hello!')])
  await answerCustomer({ model, question: 'Hi', orders: spyStore() })
  const tool = findTool(model.calls[0], 'getOrderStatus')
  assert.ok(tool, 'no function tool named getOrderStatus was sent to the model')
  const props = properties(tool)
  assert.ok(props.length >= 1, `tool input schema has no properties: ${JSON.stringify(tool.inputSchema)}`)
  const required = tool.inputSchema.required ?? []
  assert.ok(required.includes(idProperty(model.calls[0])), 'the order id must be a required input')
})

test('looks the order up and answers with the tool result', async () => {
  const orders = spyStore()
  const model = scriptedModel([callStatus('ORD-1001'), text('Your order shipped with DHL, due Nov 4.')])
  const answer = await answerCustomer({ model, question: 'Where is ORD-1001?', orders })

  assert.deepEqual(orders.lookups, ['ORD-1001'])
  assert.equal(model.calls.length, 2, 'expected a second model call after the tool ran')
  const results = toolResults(model.calls[1])
  assert.equal(results.length, 1, 'the tool result was not sent back to the model')
  const sent = JSON.stringify(results[0].output)
  for (const fact of ['shipped', 'DHL', '2026-11-04']) {
    assert.ok(sent.includes(fact), `tool result sent to the model lacks ${fact}: ${sent}`)
  }
  assert.equal(answer, 'Your order shipped with DHL, due Nov 4.')
})

test('an unknown order id produces a clear not-found result instead of a crash', async () => {
  const orders = spyStore()
  const model = scriptedModel([callStatus('ORD-9999'), text('I could not find that order.')])
  const answer = await answerCustomer({ model, question: 'Where is ORD-9999?', orders })

  assert.deepEqual(orders.lookups, ['ORD-9999'])
  const results = toolResults(model.calls[1])
  assert.equal(results.length, 1)
  const sent = JSON.stringify(results[0].output)
  assert.match(
    sent,
    /not[\s_-]?found|no (such )?order|unknown|does ?n[o']t exist|could ?n[o']t find|\\?"(found|exists)\\?":false/i,
    `tool result does not say the order was not found: ${sent}`,
  )
  assert.equal(answer, 'I could not find that order.')
})

test('can look up several orders one after another before answering', async () => {
  const orders = spyStore()
  const model = scriptedModel([
    callStatus('ORD-1001'),
    callStatus('ORD-1002'),
    text('ORD-1001 has shipped; ORD-1002 is still being processed.'),
  ])
  const answer = await answerCustomer({ model, question: 'Where are ORD-1001 and ORD-1002?', orders })
  assert.deepEqual(orders.lookups, ['ORD-1001', 'ORD-1002'])
  assert.equal(answer, 'ORD-1001 has shipped; ORD-1002 is still being processed.')
})

test('a model that never stops calling the tool is cut off at 4 model calls', async () => {
  let n = 1000
  const model = scriptedModel([(options) => toolCalls(['getOrderStatus', { [idProperty(options)]: `ORD-${n++}` }])])
  try {
    await answerCustomer({ model, question: 'Where is my order?', orders: spyStore() })
  } catch {
    // Either resolving or rejecting is acceptable here; only the number of model calls is checked.
  }
  assert.ok(model.calls.length >= 2, 'the assistant never continued after a tool call')
  assert.ok(model.calls.length <= 4, `the model was called ${model.calls.length} times`)
})

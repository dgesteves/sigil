import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLanguageModelV4 } from 'ai/test'
import { answerCustomer } from '../src/assistant.ts'
import { createMemoryOrderStore } from '../src/orders.ts'

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
}

test('answers a general question with the model text', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'We are open 9:00-18:00, Monday to Saturday.' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    },
  })
  const answer = await answerCustomer({
    model,
    question: 'When are you open?',
    orders: createMemoryOrderStore([]),
  })
  assert.equal(answer, 'We are open 9:00-18:00, Monday to Saturday.')
  assert.equal(model.doGenerateCalls.length, 1)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ModelMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { createMemoryConversationStore, handleMessage } from '../src/handler.ts'
import { createMemoryTicketStore } from '../src/tickets.ts'

const conversation = JSON.parse(
  readFileSync(new URL('../fixtures/conversation.json', import.meta.url), 'utf8'),
) as ModelMessage[]

test('a plain chat turn replies and is appended to the conversation', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'Thanks, I have passed this on to the team.' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 9, text: 9, reasoning: undefined },
      },
      warnings: [],
    },
  })
  const conversations = createMemoryConversationStore({ c1: conversation })
  const reply = await handleMessage({
    model,
    user: { id: 'u-1', orgId: 'org-acme' },
    conversationId: 'c1',
    text: 'Any update?',
    conversations,
    tickets: createMemoryTicketStore([]),
  })
  assert.equal(reply, 'Thanks, I have passed this on to the team.')
  const stored = await conversations.load('c1')
  assert.equal(stored.length, conversation.length + 2)
  assert.deepEqual(stored.at(-2), { role: 'user', content: 'Any update?' })
  assert.equal(stored.at(-1)?.role, 'assistant')
})

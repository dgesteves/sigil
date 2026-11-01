import type { LanguageModel, ModelMessage } from 'ai'
import { runSupportTurn, type SupportUser } from './agent.ts'
import type { TicketStore } from './tickets.ts'

export interface ConversationStore {
  load(id: string): Promise<ModelMessage[]>
  append(id: string, messages: ModelMessage[]): Promise<void>
}

export function createMemoryConversationStore(
  seed: Record<string, ModelMessage[]> = {},
): ConversationStore {
  const conversations = new Map(Object.entries(seed).map(([id, m]) => [id, [...m]]))
  return {
    async load(id) {
      return [...(conversations.get(id) ?? [])]
    },
    async append(id, messages) {
      conversations.set(id, [...(conversations.get(id) ?? []), ...messages])
    },
  }
}

export interface HandleMessageInput {
  model: LanguageModel
  user: SupportUser
  conversationId: string
  text: string
  conversations: ConversationStore
  tickets: TicketStore
}

/** One chat turn: load the conversation, run the agent, persist what it produced. */
export async function handleMessage(input: HandleMessageInput): Promise<string> {
  const history = await input.conversations.load(input.conversationId)
  const turn = await runSupportTurn({
    model: input.model,
    user: input.user,
    history,
    message: input.text,
    tickets: input.tickets,
  })
  await input.conversations.append(input.conversationId, turn.newMessages)
  return turn.reply
}

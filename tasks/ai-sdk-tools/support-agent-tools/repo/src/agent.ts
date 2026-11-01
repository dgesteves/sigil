import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { SUPPORT_POLICY } from './policy.ts'
import type { TicketStore } from './tickets.ts'

export interface SupportUser {
  id: string
  orgId: string
}

export interface TurnInput {
  model: LanguageModel
  user: SupportUser
  /** The stored conversation so far, oldest first. */
  history: ModelMessage[]
  /** The user's new message. */
  message: string
  tickets: TicketStore
}

export interface TurnResult {
  reply: string
  /** Appended to the stored conversation: this turn's user message plus everything the model produced. */
  newMessages: ModelMessage[]
  /** Names of the tools called during this turn, in call order. */
  toolsUsed: string[]
  usage: { inputTokens: number; outputTokens: number }
}

export async function runSupportTurn({ model, history, message }: TurnInput): Promise<TurnResult> {
  const userMessage: ModelMessage = { role: 'user', content: message }
  const result = await generateText({
    model,
    instructions: SUPPORT_POLICY,
    messages: [...history, userMessage],
  })
  return {
    reply: result.text,
    newMessages: [userMessage, ...result.response.messages],
    toolsUsed: [],
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  }
}

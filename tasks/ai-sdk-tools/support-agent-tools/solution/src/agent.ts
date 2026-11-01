import { generateText, isStepCount, type LanguageModel, type ModelMessage, tool } from 'ai'
import { z } from 'zod'
import { FALLBACK_REPLY, SUPPORT_POLICY } from './policy.ts'
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

const MAX_MODEL_CALLS = 6

/** Tools are built per turn so the org comes from the session, never from model input. */
function ticketTools(tickets: TicketStore, orgId: string) {
  return {
    searchTickets: tool({
      description: "Search the user's organisation's tickets by words in the title.",
      inputSchema: z.object({ query: z.string().min(1).describe('Words to look for in ticket titles') }),
      execute: async ({ query }) => {
        const found = await tickets.search(orgId, query)
        return found.map(({ id, title, status, priority }) => ({ id, title, status, priority }))
      },
    }),
    setTicketPriority: tool({
      description: "Change the priority of one of the user's organisation's tickets.",
      inputSchema: z.object({
        ticketId: z.string().min(1).describe('Ticket id, e.g. T-101'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']),
      }),
      execute: async ({ ticketId, priority }) => {
        const ticket = await tickets.setPriority(orgId, ticketId, priority)
        return ticket
          ? { updated: true, ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority } }
          : { updated: false, error: `Ticket ${ticketId} was not found.` }
      },
    }),
  }
}

export async function runSupportTurn({ model, user, history, message, tickets }: TurnInput): Promise<TurnResult> {
  const userMessage: ModelMessage = { role: 'user', content: message }
  // AI SDK 7 rejects system messages inside `messages`. Conversations saved by the old bot start with
  // that bot's system prompt; drop it so only the current policy (sent as `instructions`) applies.
  const priorMessages = history.filter((m) => m.role !== 'system')

  const result = await generateText({
    model,
    instructions: SUPPORT_POLICY,
    messages: [...priorMessages, userMessage],
    tools: ticketTools(tickets, user.orgId),
    stopWhen: isStepCount(MAX_MODEL_CALLS),
  })

  // The loop ended on tool calls: the step limit was hit before the model produced an answer.
  const finished = result.finalStep.finishReason !== 'tool-calls' && result.text.trim() !== ''

  return {
    reply: finished ? result.text : FALLBACK_REPLY,
    // `responseMessages` accumulates every step. In AI SDK 7 `result.response.messages` holds only
    // the final step, which would drop the earlier tool calls and results from the stored conversation.
    newMessages: [userMessage, ...result.responseMessages],
    toolsUsed: result.toolCalls.map((call) => call.toolName),
    usage: {
      // In AI SDK 7, `result.usage` is the total over all steps.
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  }
}

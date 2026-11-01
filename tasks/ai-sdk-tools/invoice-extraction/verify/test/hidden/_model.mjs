// Scripted model for the hidden tests, built on the AI SDK's own MockLanguageModelV4.
// One script serves both doGenerate and doStream, so generateText, streamText and ToolLoopAgent
// implementations are all exercised the same way. Steps can be plain results or functions of the
// call options, which lets a step read the tool schemas the implementation actually sent.
import { MockLanguageModelV4 } from 'ai/test'

export const usage = (input = 10, output = 5) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
})

export const text = (value) => ({
  content: [{ type: 'text', text: value }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: usage(),
  warnings: [],
})

let ids = 0
export const toolCalls = (...calls) => ({
  content: calls.map(([toolName, input]) => ({
    type: 'tool-call',
    toolCallId: `call-${++ids}`,
    toolName,
    input: JSON.stringify(input),
  })),
  finishReason: { unified: 'tool-calls', raw: undefined },
  usage: usage(),
  warnings: [],
})

function toStream(result) {
  const chunks = [{ type: 'stream-start', warnings: [] }]
  result.content.forEach((part, i) => {
    if (part.type === 'text') {
      const id = `t${i}`
      chunks.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: part.text })
      chunks.push({ type: 'text-end', id })
    } else {
      chunks.push(part)
    }
  })
  chunks.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage })
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    }),
  }
}

/** `steps[i]` answers the i-th model call; the last step repeats if the script runs out. */
export function scriptedModel(steps) {
  const calls = []
  const next = async (options) => {
    calls.push(options)
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    return typeof step === 'function' ? step(options, calls.length) : step
  }
  const model = new MockLanguageModelV4({
    doGenerate: next,
    doStream: async (options) => toStream(await next(options)),
  })
  model.calls = calls
  return model
}

export function findTool(options, name) {
  return (options.tools ?? []).find((t) => t.type === 'function' && t.name === name)
}

/** Property names of a tool's JSON schema, in declaration order. */
export function properties(tool) {
  return Object.keys(tool?.inputSchema?.properties ?? {})
}

/** Every tool-result part the implementation sent back to the model in one call's prompt. */
export function toolResults(options) {
  return options.prompt
    .filter((m) => m.role === 'tool')
    .flatMap((m) => m.content)
    .filter((p) => p.type === 'tool-result')
}

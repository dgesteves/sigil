# Testing AI SDK code with mock models

`ai/test` (7.x) exports `MockLanguageModelV4`, `MockLanguageModelV3`, `MockEmbeddingModelV4`,
`MockProviderV4`, `mockId`, `mockValues`, `convertArrayToReadableStream` and others;
`simulateReadableStream` is exported from both `ai` and `ai/test`. No network, no API key.

Design for it: take the model as a parameter (`model: LanguageModel`) instead of constructing a
provider inside the function.

## Shapes the v4 spec expects

```ts
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}
const answer = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
})
const callTool = (toolName: string, input: unknown, toolCallId = 'call-a') => ({
  content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
})
```

`doGenerate` accepts one result (returned every time), an array (one per call, **crashes with a
TypeError after the last one**), or a function `async (options) => result`.

## One mock that serves generateText, streamText and agents

```ts
import { MockLanguageModelV4 } from 'ai/test'

type Result = ReturnType<typeof answer> | ReturnType<typeof callTool>
type Turn = Result | ((options: any, n: number) => Result)

export function fakeModel(turns: Turn[]) {
  const calls: any[] = []
  const next = async (options: any) => {
    calls.push(options)
    const turn = turns[Math.min(calls.length - 1, turns.length - 1)]! // repeat the last one
    return typeof turn === 'function' ? turn(options, calls.length) : turn
  }
  const model = new MockLanguageModelV4({
    doGenerate: next,
    doStream: async (options) => {
      const r = await next(options)
      const parts: any[] = [{ type: 'stream-start', warnings: [] }]
      r.content.forEach((p: any, i: number) =>
        p.type === 'text'
          ? parts.push({ type: 'text-start', id: `t${i}` }, { type: 'text-delta', id: `t${i}`, delta: p.text }, { type: 'text-end', id: `t${i}` })
          : parts.push(p),
      )
      parts.push({ type: 'finish', finishReason: r.finishReason, usage: r.usage })
      return { stream: new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close() } }) }
    },
  })
  return Object.assign(model, { calls })
}
```

A turn written as a function can read the tool schemas the code under test actually sent, which
keeps tests independent of property names:

```ts
const askForecast = (options: any) => {
  const tool = options.tools.find((t: any) => t.name === 'getForecast')
  const key = Object.keys(tool.inputSchema.properties)[0]
  return callTool('getForecast', { [key]: 'LPPT' })
}
```

## What to assert

Assert on what the model was sent, not only on what came back:

| Assertion | Catches |
| --- | --- |
| `model.calls[0].tools` contains the tool with non-empty `inputSchema.properties` | `parameters` instead of `inputSchema` |
| `model.calls.length === 2` for one tool round + answer | missing or ignored `stopWhen` (`maxSteps`) |
| a "never stops" model (function step returning tool calls forever) is cut off at the limit | unbounded loops, `ToolLoopAgent` default of 20 |
| `model.calls[1].prompt` has a `role: 'tool'` message with your tool's `output` | tool results not fed back |
| `model.calls[0].prompt[0]` is `{ role: 'system', content }` with your instructions | instructions missing, or `InvalidPromptError` from system messages in `messages` |
| `model.calls[0].maxOutputTokens`, `.temperature`, `.responseFormat` | `maxTokens`, no structured output |
| what you persist after a run with two tool rounds still contains both tool calls and both tool results | `result.response.messages` (final step only) |
| your data layer receives the session's workspace even when the model's input adds `workspaceId: 'someone-else'` | scoping ids taken from model input |
| invalid tool input never reaches your data layer | schema too loose, validation in the wrong place |

Prompt format inside `calls[i].prompt`: user and assistant `content` are arrays of parts
(`{ type: 'text', text }`, `{ type: 'tool-call', toolCallId, toolName, input }`); tool messages hold
`{ type: 'tool-result', toolCallId, toolName, output: { type: 'json' | 'text' | 'error-text' | ..., value } }`.

Run tests with `node --test` (Node 24 runs `.ts` directly when relative imports use the `.ts`
extension) or the project's runner; the mock needs no setup beyond the import.

# Old AI SDK habits and what to write in 7.x

The "In 7.0.159" column was observed by running each old form against `ai@7.0.159` with
`MockLanguageModelV4`, not copied from changelogs. "Silent" means no error, no warning you would
notice in a test run, and wrong behaviour.

## Calls and options

| Old (version) | 7.x | In 7.0.159 |
| --- | --- | --- |
| `maxSteps: 5` (v4) | `stopWhen: isStepCount(5)` | Silent: ignored, one step. |
| `stopWhen: stepCountIs(5)` (v5, v6) | `stopWhen: isStepCount(5)` | Works, deprecated alias. |
| no `stopWhen` with tools | `stopWhen: isStepCount(n)` | One step: tools execute, the model never sees the results, `text === ''`. |
| `maxTokens` (v4) | `maxOutputTokens` | Silent: no cap sent. Type error under `tsc`. |
| `system: '...'` (v4-v6) | `instructions: '...'` | Works, deprecated alias. `instructions` wins if both are set. |
| `messages: [{ role: 'system', ... }, ...]` | `instructions` + `messages` without system entries | Throws `InvalidPromptError`. Not a type error. Opt out with `allowSystemInMessages: true` for trusted, server-authored messages only. |
| `experimental_output` (v5) | `output` | Silent: removed, ignored. |
| `experimental_activeTools`, `experimental_prepareStep` | `activeTools`, `prepareStep` | Removed. |
| `experimental_telemetry` | `telemetry` (and register an integration, e.g. `@ai-sdk/otel`) | Alias works. OpenTelemetry is no longer built in; once an integration is registered, telemetry is on by default. |
| `onFinish`, `onStepFinish` | `onEnd`, `onStepEnd` | Aliases work. |
| `experimental_onToolCallStart/Finish` | `onToolExecutionStart/End` | Aliases work. |
| `generateObject` / `streamObject` (v4-v5) | `generateText` / `streamText` with `output: Output.object({ schema })` | Work, deprecated since v6, log a deprecation warning. |
| `Experimental_Agent` (v5) | `ToolLoopAgent` | Alias. `system` became `instructions`; the default `stopWhen` is `isStepCount(20)`. |
| `require('ai')` | `import` | Fails: packages are ESM-only. |

## Tools

| Old | 7.x | In 7.0.159 |
| --- | --- | --- |
| `tool({ parameters })` (v4) | `tool({ inputSchema })` | Silent: the model gets `{ type: 'object', properties: {} }`; input is not validated. Overload error under `tsc`. |
| `execute(args, { experimental_context })` (v5, v6) | closure per request, or `contextSchema` + `toolsContext` and `execute(input, { context })` | Silent at the call site (`experimental_context` is not forwarded; a type error under `tsc`), then `TypeError` inside the tool, which the SDK turns into a `tool-error` the model sees. |
| shared `context` on the call (v6) | `runtimeContext` (for `prepareStep`, callbacks) and `toolsContext` (per tool) | Tools no longer see the shared object. |
| `needsApproval` on the tool (v6) | `toolApproval` on the call or agent | Works, deprecated. |
| `ToolCallOptions` type | `ToolExecutionOptions` | Removed. |
| `toModelOutput` returning `{ type: 'media' }` | `{ type: 'file', mediaType, data: { type: 'data', data } }` | `media` removed; `image-*`/`file-*` variants auto-migrate but are deprecated. |

## Results

| Old | 7.x | In 7.0.159 |
| --- | --- | --- |
| `result.response.messages` to persist a multi-step turn (v5, v6) | `result.responseMessages` | Silent: final step only. A tool round-trip loses its assistant tool-call and tool-result messages. |
| `step.response.messages` as "history so far" (v6) | `result.responseMessages`, or `steps.flatMap(s => s.response.messages)` | Per-step only now. |
| `result.toolCalls` meaning the final step (v5, v6) | `result.toolCalls` = all steps; `result.finalStep.toolCalls` = last step | Behaviour change, no error. Same for `toolResults`, `content`, `files`, `sources`, `warnings`. |
| `result.usage` = final step, `totalUsage` = all (v5, v6) | `result.usage` = all steps; `result.finalStep.usage` = last | `totalUsage` deprecated alias. |
| `toolCall.args`, `toolResult.result` (v4) | `.input`, `.output` | `undefined`. |
| `usage.promptTokens`, `completionTokens` (v4) | `inputTokens`, `outputTokens`, `totalTokens` | `undefined`. |
| `usage.cachedInputTokens`, `usage.reasoningTokens` (v5) | `usage.inputTokenDetails.cacheReadTokens`, `usage.outputTokenDetails.reasoningTokens` | Removed. |
| `result.reasoningText`, `result.providerMetadata`, `result.request.body` | `result.finalStep.*`; bodies need `include: { requestBody: true, responseBody: true }` | Deprecated aliases; bodies are excluded by default now. |
| `CoreMessage`, `convertToCoreMessages` (v4) | `ModelMessage`, `await convertToModelMessages(...)` | Removed in v6. Under Node type stripping, `import { CoreMessage } from 'ai'` (without `type`) fails at module load with "does not provide an export named"; `import type` only fails `tsc`. |

## Streaming

| Old | 7.x |
| --- | --- |
| `result.fullStream` | `result.stream` (alias kept) |
| `result.toUIMessageStreamResponse()`, `toTextStreamResponse()` | `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`, `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })` (methods deprecated, still work) |
| `includeRawChunks: true` | `include: { rawChunks: true }` |
| `onChunk` assuming only content parts | `onChunk` now receives every stream part, including `start`, `finish-step`, `error`; switch on `chunk.type` |

## Testing

| Old | 7.x |
| --- | --- |
| `MockLanguageModelV1` / `V2` | `MockLanguageModelV4` (V3 still exported) |
| `usage: { promptTokens, completionTokens }` in mock results | `usage: { inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }` |
| `finishReason: 'stop'` | `finishReason: { unified: 'stop', raw: undefined }` |
| tool-call `args` object | tool-call `input` JSON string |

## Anti-pattern, fix

```ts
// Anti-pattern (v4 habits): runs, returns '' after the first tool call, schema never sent.
await generateText({ model, system: HOUSE_STYLE, maxSteps: 5, tools: { lookup: tool({ parameters: s, execute }) }, prompt })

// Fix
await generateText({ model, instructions: HOUSE_STYLE, stopWhen: isStepCount(5), tools: { lookup: tool({ inputSchema: s, execute }) }, prompt })
```

```ts
// Anti-pattern (OpenAI-style history): throws InvalidPromptError in 7.x.
await generateText({ model, messages: [{ role: 'system', content: HOUSE_STYLE }, ...priorTurns, latest] })

// Fix
await generateText({ model, instructions: HOUSE_STYLE, messages: [...priorTurns.filter((m) => m.role !== 'system'), latest] })
```

```ts
// Anti-pattern (v5/v6 persistence): loses earlier tool calls once stopWhen allows several steps.
await threads.save(threadId, [latest, ...result.response.messages])

// Fix
await threads.save(threadId, [latest, ...result.responseMessages])
```

```ts
// Anti-pattern (v5/v6 context): context is undefined in 7.x.
execute: async (input, { experimental_context }) => notes.read(experimental_context.workspaceId, input.noteId)

// Fix A: closure built per request
const tools = { readNote: tool({ inputSchema, execute: async (input) => notes.read(session.workspaceId, input.noteId) }) }
// Fix B: typed per-tool context
const readNote = tool({ inputSchema, contextSchema: z.object({ workspaceId: z.string() }),
  execute: async (input, { context }) => notes.read(context.workspaceId, input.noteId) })
await generateText({ model, tools: { readNote }, toolsContext: { readNote: { workspaceId: session.workspaceId } }, prompt })
```

# Agents, loop control and context (AI SDK 7.x)

## generateText loop or ToolLoopAgent?

Both run the same loop: call the model, execute requested tools, send results back, repeat until a
stop condition or a step without tool calls.

- `generateText`/`streamText` + `stopWhen`: one request handler, settings built per request. The
  default is **one step**.
- `ToolLoopAgent`: a reusable object holding model, `instructions`, `tools`, `stopWhen`,
  `toolChoice`, `output`, `prepareStep`, `toolApproval`, `toolsContext`, `runtimeContext`. The
  default is `isStepCount(20)`, and the SDK logs a warning if that default cuts a loop short. Set
  `stopWhen` explicitly anyway, so the budget is visible in code.

```ts
import { isStepCount, ToolLoopAgent } from 'ai'

const agent = new ToolLoopAgent({
  model,
  instructions: STOCKROOM_RULES,
  tools: { findSku, reserveStock },
  stopWhen: isStepCount(8),
})
const result = await agent.generate({ messages: thread }) // or { prompt }; agent.stream(...) for streaming
result.text; result.steps; result.responseMessages; result.usage
```

Agents built once at module scope cannot close over per-request values. Use `toolsContext` (below)
or `callOptionsSchema` + `prepareCall`:

```ts
const agent = new ToolLoopAgent({
  model,
  instructions: 'You are a travel concierge.',
  callOptionsSchema: z.object({ accountType: z.enum(['free', 'pro']) }),
  prepareCall: ({ options, ...settings }) => ({
    ...settings,
    instructions: `${settings.instructions}\nAccount type: ${options.accountType}`,
  }),
})
await agent.generate({ prompt, options: { accountType: 'pro' } })
```

`prepareCall` replaces the call settings, so spread the incoming ones and override only what changes.

## Stop conditions

- `isStepCount(n)`: at most n steps (model calls).
- `hasToolCall('name', ...)`: stop once one of these tools is called (useful for a `finalAnswer`
  tool without `execute`).
- `isLoopFinished()`: never triggers; the loop ends when the model stops calling tools. Unbounded:
  pair it with a step count in an array.
- An array stops when **any** condition is met: `stopWhen: [isStepCount(10), hasToolCall('done')]`.
- Custom: a `StopCondition<typeof tools>` such as `({ steps }) => steps.some((s) => s.text.includes('ANSWER'))`.
- Conditions are evaluated only after a step that produced tool results.

Detect "stopped by the limit, no answer": `result.finalStep.finishReason === 'tool-calls'`.

## prepareStep

Runs before each step. It receives `model`, `stopWhen`, `stepNumber`, `steps`, `instructions`,
`initialInstructions`, `messages`, `initialMessages`, `responseMessages`, `runtimeContext`,
`toolsContext`; it may return overrides such as `model`, `toolChoice`, `activeTools`,
`instructions`, `messages`, `runtimeContext`, `toolsContext`, `providerOptions`.

7.x change: returned `instructions` and `messages` **carry forward** to later steps (in v6 they
applied to one step only). To keep one-step behaviour, rebuild from the initial values each time:

```ts
prepareStep: ({ stepNumber, initialInstructions, initialMessages, responseMessages }) => ({
  instructions: stepNumber === 0 ? 'Plan first, then act.' : initialInstructions,
  messages: [...initialMessages, ...responseMessages.slice(-10)], // simple compaction
})
```

`pruneMessages({ messages, reasoning: 'all', toolCalls: 'before-last-3-messages', emptyMessages: 'remove' })`
is the built-in compaction helper.

## Context: three different things

| | Set on | Read in | Use for |
| --- | --- | --- | --- |
| `runtimeContext` | call / agent settings / `prepareCall` | `prepareStep`, lifecycle callbacks, step results, telemetry (filtered) | shared loop state: request id, workspace settings, progress |
| `toolsContext` | call / agent settings / `prepareCall` / `prepareStep` | resolved per tool | a map `{ toolName: value }` |
| tool `context` | a tool's `toolsContext` entry, validated by its `contextSchema` | that tool's `execute`, description function, approval callback | one tool's secrets, scoped clients, user identity |

```ts
const readCalendar = tool({
  description: 'List the events on one day of the current workspace calendar',
  inputSchema: z.object({ day: z.iso.date() }),
  contextSchema: z.object({ workspaceId: z.string() }),
  execute: async ({ day }, { context }) => calendar.list(context.workspaceId, day),
})

await generateText({
  model,
  tools: { readCalendar },
  toolsContext: { readCalendar: { workspaceId: session.workspaceId } }, // required once any tool declares contextSchema
  prompt,
})
```

Rules: tool context is immutable inside the tool (change it between steps in `prepareStep`);
`experimental_context` is gone; telemetry only receives context fields you whitelist with
`telemetry.includeRuntimeContext` / `telemetry.includeToolsContext`, which is a telemetry filter,
not a security boundary. A per-request closure is equally correct and simpler when tools are
built inside the handler.

## Approvals

```ts
const result = await generateText({
  model,
  tools: { runCommand, wireTransfer },
  toolApproval: {
    runCommand: 'user-approval',                                            // always ask
    wireTransfer: async ({ cents }) => (cents > 50_000 ? 'user-approval' : undefined), // undefined = no approval flow
  },
  messages: thread,
})
thread.push(...result.responseMessages)
const pending = result.content.flatMap((p) => (p.type === 'tool-approval-request' && !p.isAutomatic ? [p] : []))
// later, after the human decides:
thread.push({ role: 'tool', content: pending.map((p) => ({ type: 'tool-approval-response', approvalId: p.approvalId, approved: true })) })
await generateText({ model, tools: { runCommand, wireTransfer }, toolApproval: { /* same */ }, messages: thread })
```

Statuses: `'not-applicable'` (default, just run), `'approved'`/`'denied'` (decided automatically but
recorded as request/response parts), `'user-approval'` (stop and return a request). A generic
function `({ toolCall, tools, toolsContext, messages, runtimeContext }) => status` can cover every
tool. Provider-executed tools ignore approvals. A denied call's `reason` is shown to the model;
an approved call's reason is not, so never use it to pass data to the tool.

## Lifecycle callbacks (7.x names)

`onStart`, `onStepStart`, `onStepEnd({ stepNumber, toolCalls, toolResults, finishReason, usage })`,
`onEnd(event)` (whole-run fields plus `event.finalStep`), `onToolExecutionStart({ toolCall })`,
`onToolExecutionEnd({ toolCall, toolExecutionMs, toolOutput })` where `toolOutput.type` is
`'tool-result'` or `'tool-error'`. Errors thrown inside the two tool execution callbacks are
caught by the SDK and do not stop the generation.

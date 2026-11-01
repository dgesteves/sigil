# Structured output (AI SDK 7.x)

Since v6 the recommended API is `generateText`/`streamText` with an `output` setting.
`generateObject`/`streamObject` still work in 7.x but are deprecated and log a warning; do not
rewrite working code just for that, but write new code with `output`.

## Output kinds

| Call | `result.output` type | Notes |
| --- | --- | --- |
| `Output.text()` | `string` | The default. |
| `Output.object({ schema, name?, description? })` | `z.infer<typeof schema>` | Zod, Valibot or `jsonSchema(...)`. |
| `Output.array({ element, minItems?, maxItems? })` | `Element[]` | Bounds are sent to providers when supported and validated locally. |
| `Output.choice({ options: ['a', 'b'] })` | one of the options | Classification. Throws if the model answers anything else. |
| `Output.json()` | any JSON value | Parses only; no schema validation. |

`name`/`description` help providers that turn the output into a tool or named schema.

## Schema advice that matters in production

- Use `.nullable()` for "may be absent". The SDK docs recommend it over `.optional()` for
  compatibility, and OpenAI's strict JSON-schema mode (on by default since v6) needs every key
  present.
- Put format rules in the schema (`z.iso.datetime()`, `.regex(/^[A-Z]{2}$/)`, `.int().min(1)`) so
  a wrong answer becomes a `NoObjectGeneratedError` instead of bad data downstream.
- `.describe()` each non-obvious field; descriptions are sent to the model.
- Keep the schema the single source of truth for the type: `z.infer<typeof schema>`, or check an
  existing interface with `schema satisfies z.ZodType<MyType>`.
- Lower the temperature for extraction-style calls, and cap cost with `maxOutputTokens`.

## Errors

```ts
try {
  const { output } = await generateText({ model, prompt, output: Output.object({ schema }) })
  return output
} catch (error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    log.warn({ llmText: error.text, why: error.cause, usage: error.usage, response: error.response })
    return null // or a result type the caller must handle
  }
  if (NoOutputGeneratedError.isInstance(error)) {
    // the final step did not finish with 'stop', e.g. it ended on tool calls
  }
  throw error
}
```

- `NoObjectGeneratedError`: unparseable JSON or schema mismatch. `error.text` is the raw text.
- `NoOutputGeneratedError`: thrown when **reading** `result.output` and the run produced none.
  `output` is a getter, so `const { output } = await generateText(...)` throws at the destructuring.
- Use the SDK's `X.isInstance(error)` checks, as its docs do, rather than `instanceof`.

## Tools and structured output together

One call can use tools and then return a typed object. The final object costs a step:

```ts
const { output } = await generateText({
  model,
  tools: { weather },
  output: Output.object({ schema: z.object({ summary: z.string(), wear: z.string() }) }),
  stopWhen: isStepCount(5), // tool steps + one step for the object
  prompt: 'What should I wear in Lisbon today?',
})
```

## Streaming

```ts
const result = streamText({ model, prompt, output: Output.object({ schema }), onError: ({ error }) => log.error(error) })
for await (const partial of result.partialOutputStream) render(partial) // unvalidated, may be incomplete
const final = await result.output // validated; rejects on invalid output
```

- `Output.array` + `elementStream`: yields each element once complete and validated.
- `streamText` never throws synchronously; errors surface as `error` stream parts and the `onError`
  callback, and the awaited promises reject (when the provider call itself fails, both
  `await result.text` and `await result.output` reject with `NoOutputGeneratedError`).
- `streamText` calls the model's `doStream`, so a mock that only implements `doGenerate` fails.

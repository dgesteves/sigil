# Sources

Checked on 2026-11-01 against `ai@7.0.159` (published 2026-10-30), `zod@4.6.7`,
`typescript@7.0.2` and Node 24. The `ai` package ships the same documentation for its exact
version under `node_modules/ai/docs/`; that copy and the installed `.d.ts` files were read as well.

## Official documentation

- AI SDK 6.x to 7.0 migration guide: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
- AI SDK 5.x to 6.0 migration guide: https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0
- AI SDK 4.x to 5.0 migration guide: https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0
- Tool calling, multi-step calls, approvals, errors: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Runtime and tool context: https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context
- Generating structured data: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- Prompt engineering (`.nullable()` over `.optional()`): https://ai-sdk.dev/docs/ai-sdk-core/prompt-engineering
- Testing with mock models: https://ai-sdk.dev/docs/ai-sdk-core/testing
- Building agents (`ToolLoopAgent`): https://ai-sdk.dev/docs/agents/building-agents
- Loop control (`stopWhen`, `prepareStep`): https://ai-sdk.dev/docs/agents/loop-control
- Configuring call options (`callOptionsSchema`, `prepareCall`): https://ai-sdk.dev/docs/agents/configuring-call-options
- Package: https://www.npmjs.com/package/ai

## Observed behaviour

The "In 7.0.159" column of [the migration table](migration-v4-to-v7.md) comes from running each
old form against `ai@7.0.159` with `MockLanguageModelV4` from `ai/test` and inspecting
`doGenerateCalls`: the sent tool schemas, `maxOutputTokens`, `responseFormat`, prompt messages,
the number of model calls, and the `InvalidPromptError` thrown for system messages in `messages`.
The type-check claims come from running `tsc --noEmit` (TypeScript 7.0.2) on the same code.

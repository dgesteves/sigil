# helpdesk-bot

Chat assistant inside the helpdesk app. `handleMessage()` (src/handler.ts) loads the stored
conversation, runs one turn with `runSupportTurn()` (src/agent.ts) and appends the turn's messages.

```sh
npm test           # node --test, uses the AI SDK mock model, no network
npm run typecheck
```

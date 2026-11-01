# newsroom-cms-ui

Editor components for the newsroom CMS (Vue 3).

```sh
npm test           # vitest + jsdom + @vue/test-utils
npm run typecheck  # vue-tsc --noEmit
```

State lives in `src/draftStore.ts`, which hands out frozen snapshots: components never mutate
what they receive, they emit new values. Some components in `src/components/` were copied over
from the old Vue 2 editor and still need porting.

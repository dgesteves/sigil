# @acme/feedback-widget

The feedback widget customers embed on their sites. Host pages never touch Svelte: they call the
plain JavaScript API in `src/embed.ts` (the package entry point).

```js
import { createFeedbackWidget } from '@acme/feedback-widget'

const widget = createFeedbackWidget(document.querySelector('#feedback'), {
  title: 'How was checkout?',
  autofocus: true,
  onReady: () => analytics.track('feedback_shown'),
  onSubmit: (feedback) => api.post('/feedback', feedback),
  onClose: () => widget.destroy(),
})

widget.update({ title: 'Anything else?' })
widget.reset()
widget.destroy()
```

```sh
npm test        # vitest + jsdom
npm run check   # svelte-check
```

3.0 moves the widget to Svelte 5. `FeedbackWidget.svelte` is already on runes; `src/embed.ts` still
needs porting.

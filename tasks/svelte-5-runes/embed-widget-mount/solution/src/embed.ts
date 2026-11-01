import { flushSync, mount, unmount } from 'svelte'
import FeedbackWidget from './FeedbackWidget.svelte'
import { reactiveProps } from './reactive-props.svelte.ts'
import type { Feedback } from './types.ts'

export type { Feedback }

export interface WidgetOptions {
  title?: string
  placeholder?: string
  /** Move focus to the comment box as soon as the widget is created. */
  autofocus?: boolean
  onSubmit?: (feedback: Feedback) => void
  onClose?: () => void
  /** Called once the widget is mounted and interactive. */
  onReady?: () => void
}

export interface WidgetHandle {
  /** Change the title or placeholder without losing what the visitor has typed. */
  update(options: Pick<WidgetOptions, 'title' | 'placeholder'>): void
  /** Clear the rating and the comment. */
  reset(): void
  focus(): void
  /** Remove the widget and everything it attached to the page. */
  destroy(): void
}

export function createFeedbackWidget(target: HTMLElement, options: WidgetOptions = {}): WidgetHandle {
  const { onSubmit, onClose, onReady, title, placeholder, autofocus } = options

  const props = reactiveProps({
    title,
    placeholder,
    autofocus,
    onsubmit: onSubmit,
    onclose: onClose,
    onready: onReady,
  })
  // Svelte 4's `new Component()` ran onMount before returning; mount() defers effects, so flush
  // them here: callers rely on onReady having fired and on autofocus being applied.
  const widget = mount(FeedbackWidget, { target, props })
  flushSync()

  let destroyed = false
  return {
    update: (next) => {
      if ('title' in next) props.title = next.title
      if ('placeholder' in next) props.placeholder = next.placeholder
    },
    reset: () => widget.reset(),
    focus: () => widget.focus(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      unmount(widget)
    },
  }
}

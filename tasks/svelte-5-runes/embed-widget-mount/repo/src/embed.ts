import FeedbackWidget from './FeedbackWidget.svelte'
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
  const { onSubmit, onClose, onReady, ...props } = options

  const widget = new FeedbackWidget({ target, props: { ...props, onready: onReady } })
  if (onSubmit) widget.$on('submit', (event: CustomEvent<Feedback>) => onSubmit(event.detail))
  if (onClose) widget.$on('close', () => onClose())

  return {
    update: (next) => widget.$set(next),
    reset: () => widget.reset(),
    focus: () => widget.focus(),
    destroy: () => widget.$destroy(),
  }
}

# Modal dialog

## Contract (APG dialog pattern + HTML `dialog`)

- Opening moves focus inside the dialog. Default: the first focusable control. Use a static element
  with `tabIndex={-1}` (title or first paragraph) when the content is long or structured, and the least
  destructive button when the action is hard to undo.
- Tab and Shift+Tab never leave the dialog. Content behind it can't be focused, clicked or read.
- Escape closes it.
- Closing returns focus to the element that opened it. If that element no longer exists, focus goes
  to the next logical place in the workflow, never to `<body>`.
- The dialog has a name: `aria-labelledby` pointing at its visible title, or `aria-label`.
  `aria-describedby` is optional, and best left off when the content is more than a sentence or two.
- A visible close or cancel button is in the Tab sequence.
- Only mark it modal when it really blocks everyone: a dialog announced as modal but not behaving as
  one strands screen reader users.

## Native `<dialog>` + `showModal()` (default choice)

What the browser does for you with `showModal()`:

- puts the dialog in the top layer (no z-index or portal) and makes the rest of the document inert;
- exposes it as a modal dialog (`aria-modal` is implied; don't add `tabindex` to the `dialog`);
- runs the dialog focusing steps on open (an `autofocus` descendant, else the first focusable
  descendant, else the dialog itself);
- turns Escape into a close request: a cancelable `cancel` event, then `close`;
- on close, focuses the element that was focused when it opened (the HTML standard's "previously
  focused element"), unless that element has been removed.

What it does not do: lock page scrolling (`body:has(dialog:modal) { overflow: hidden; }`), or keep
your React state in sync. Wire both.

```tsx
import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react'

interface DialogProps {
  open: boolean
  /** Called for every close: Escape, the close button, or a form with method="dialog". */
  onClose: () => void
  heading: string
  /** Element to focus on open. Defaults to the browser's choice (first focusable element). */
  initialFocusRef?: RefObject<HTMLElement | null>
  children: ReactNode
}

export function Dialog({ open, onClose, heading, initialFocusRef, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // React never writes the autofocus attribute on the client (it calls focus() once at mount),
      // so choose initial focus explicitly after showModal().
      initialFocusRef?.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, initialFocusRef])

  return (
    // The close event fires after Escape and after close(); onClose must be idempotent.
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className="dialog">
      <h2 id={titleId}>{heading}</h2>
      {children}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  )
}
```

Usage: keep `open` in the parent, set it to `false` in `onClose`. The trigger keeps focus history
for you; if the trigger can unmount or re-mount while the dialog is open (a row that re-renders, a
menu item that disappears), restore focus explicitly in `onClose` to an element that still exists.

### Escape and `cancel`

- `onCancel={(e) => e.preventDefault()}` keeps the dialog open (e.g. unsaved changes), but browsers
  only honour it when the user has interacted with the page since the last close request. Pressing
  Escape twice without other interaction closes the dialog anyway (HTML close watcher rules). Never
  rely on preventing Escape for anything important; show a confirmation instead.
- `dialog.requestClose()` closes "as if the user asked" (fires `cancel`, then `close`). Supported in
  Chrome 134+, Firefox 139+, Safari 18.4+ (MDN browser-compat-data 8.1.7).

### Light dismiss and invoker commands

- `closedby="any"` closes on a click outside, `"closerequest"` (the default for modals) only on
  Escape or another close request, `"none"` only from your code. Supported in Chrome 134+ and Firefox
  141+, not yet in a released Safari (MDN browser-compat-data 8.1.7). Without it, close on a backdrop
  click with `onClick={(e) => { if (e.target === e.currentTarget) onClose() }}`; the backdrop
  belongs to the `dialog` element, and the dialog's own padding counts as "outside" unless an inner
  wrapper fills it.
- Invoker commands (`<button commandfor="d" command="show-modal">`) work in Chrome 135+, Firefox
  144+, Safari 26.2+. `@types/react` 19.3 does not type them; in React you own the state anyway, so
  calling `showModal()` from state as above is simpler.

## Custom dialog (only when `<dialog>` is ruled out)

Reasons that sometimes force it: a design system that renders dialogs through a portal you can't
change, or nested stacking that the top layer can't express. You then own every rule.

```tsx
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function CustomDialog(props: {
  open: boolean
  onClose: () => void
  heading: string
  appRoot: HTMLElement // the element that holds the rest of the page
  children: ReactNode
}) {
  const { open, onClose, heading, appRoot, children } = props
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const invoker = document.activeElement as HTMLElement | null
    appRoot.inert = true // background can't be focused, clicked or read
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panelRef.current)?.focus()
    return () => {
      appRoot.inert = false
      if (invoker?.isConnected) invoker.focus()
    }
  }, [open, appRoot])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return event.preventDefault()
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null
  return createPortal(
    <div className="backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{heading}</h2>
        {children}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  )
}
```

Rules this code encodes:

- The portal target must not be inside the inert or `aria-hidden` subtree (here `appRoot` and the
  portal are siblings under `<body>`).
- `inert` is a boolean in React 19 and on the DOM property; prefer it to `aria-hidden` on siblings,
  which hides content from screen readers but leaves it focusable.
- Restore focus in the cleanup, and only to a connected element.
- The focusable selector is approximate (it ignores `display: none`, `contenteditable`, `summary`).
  Filter out elements that are not rendered if your dialog hides parts of itself.

## Alert dialogs

Use `role="alertdialog"` (with `showModal()` on a `<dialog role="alertdialog">`, or the custom
version above) for short, urgent confirmations. Name it, describe the message with
`aria-describedby`, and focus the least destructive action.

## Testing dialogs

jsdom (30.x) implements neither `showModal()` nor `close()`, and user-event's Tab does not respect
`inert`, so a jsdom test cannot show that a native dialog traps focus. Options:

- Test native dialogs in a real browser (Playwright, Vitest browser mode).
- In jsdom, stub `HTMLDialogElement.prototype.showModal`/`close` in the test setup only to keep
  components from crashing, and assert what your code controls: the name, the element you focus after
  `showModal()`, that `onClose` keeps state in sync.
- Custom dialogs can be tested fully in jsdom: Tab from the last control lands on the first, Escape
  closes, focus returns to the trigger.

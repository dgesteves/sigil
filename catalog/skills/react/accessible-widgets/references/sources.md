# Sources

Checked on 2026-11-01. Keyboard and ARIA rules come from the APG pages and the ARIA Recommendation;
browser support from MDN's compatibility data; React and tooling behaviour from the docs below and
from running the code in this skill against React 19.3.1, @testing-library/react 16.3.3,
@testing-library/user-event 14.6.8, jsdom 30.1.3, Vitest 5.0.5, axe-core 4.14.0 and TypeScript 6.0.3.

## WAI-ARIA Authoring Practices Guide (APG)

- Read Me First ("No ARIA is better than bad ARIA", "A role is a promise"):
  https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/
- Developing a Keyboard Interface (roving tabindex, aria-activedescendant, disabled focusability):
  https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- Dialog (Modal) pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Menu Button pattern: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- Actions menu button example (Enter and Escape return focus to the button):
  https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions/
- Menu and Menubar pattern: https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
- Combobox pattern: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- Editable combobox with list autocomplete example:
  https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/
- Listbox pattern: https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
- Tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Disclosure pattern: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- Accordion pattern: https://www.w3.org/WAI/ARIA/apg/patterns/accordion/

## WAI-ARIA

- WAI-ARIA 1.2, W3C Recommendation (combobox role: required `aria-controls` and `aria-expanded`,
  `aria-autocomplete` MUST, ARIA 1.0/1.1 combobox structures no longer conform):
  https://www.w3.org/TR/wai-aria-1.2/#combobox
- WAI-ARIA 1.3, W3C Working Draft of 4 June 2026 (combobox lists `aria-controls` as supported, not
  required): https://www.w3.org/TR/wai-aria-1.3/
- Editor's draft: https://w3c.github.io/aria/

## HTML

- The `dialog` element (showModal, dialog focusing steps, previously focused element, closedby,
  requestClose, command="show-modal"):
  https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
- Close requests and close watchers (a second close request without user activation cannot be
  cancelled): https://html.spec.whatwg.org/multipage/interaction.html#close-requests-and-close-watchers
- MDN `<dialog>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- Browser support: `@mdn/browser-compat-data` 8.1.7 (`html.elements.dialog.closedby`,
  `api.HTMLDialogElement.requestClose`, `html.elements.button.commandfor`,
  `html.global_attributes.inert`, `css.selectors.modal`): https://github.com/mdn/browser-compat-data

## React

- `useId`: https://react.dev/reference/react/useId
- React 19 release (ref as a prop, cleanup functions for refs, TypeScript and implicit ref returns):
  https://react.dev/blog/2024/12/05/react-19
- React 18 upgrade guide (effects flushed synchronously for discrete input events):
  https://react.dev/blog/2022/03/08/react-18-upgrade-guide
- Changelog (19.0 `inert` support; 19.1 `useId` format `«r1»`; 19.2 underscores, `_r_1_`):
  https://github.com/facebook/react/blob/main/CHANGELOG.md
- Observed with react-dom 19.3.1: client rendering does not write the `autofocus` attribute (server
  rendering does); `@types/react` 19.3.0 types `closedby` but not `commandfor`/`command`.

## Testing tools

- Testing Library cleanup (automatic only with a global `afterEach`):
  https://testing-library.com/docs/react-testing-library/api/#cleanup
- user-event: https://testing-library.com/docs/user-event/intro
- Observed with user-event 14.6.8: Tab ignores `inert`, includes `document.body` as a stop, and
  honours `preventDefault()` on the Tab keydown; Enter and Space on a button produce `click`.
- Observed with jsdom 30.1.3: no `HTMLDialogElement.showModal`/`close`, no Popover API, no
  `scrollIntoView`/`scrollTo`, no `matchMedia`, no `ResizeObserver`.
- axe-core rule descriptions: https://dequeuniversity.com/rules/axe/4.14

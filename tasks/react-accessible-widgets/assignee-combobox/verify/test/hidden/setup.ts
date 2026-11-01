// jsdom has no layout engine, so it lacks scrolling and observer APIs every browser has. Widgets may
// legitimately call them (e.g. scrolling the active option into view), so stub them as no-ops. This
// only fills environment gaps; it changes no semantics the tests check.
const noop = () => {}
const proto = Element.prototype as unknown as Record<string, unknown>
for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy']) proto[name] ??= noop
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  }) as MediaQueryList
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

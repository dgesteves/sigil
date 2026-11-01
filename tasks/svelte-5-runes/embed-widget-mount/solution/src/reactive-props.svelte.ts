/**
 * A deeply reactive props object for `mount()`. Writing to it updates the mounted component in
 * place, which is what `$set` used to do. Runes only work in .svelte(.ts) files, hence this module.
 */
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
  const props = $state(initial)
  return props
}

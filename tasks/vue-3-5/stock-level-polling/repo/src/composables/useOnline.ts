import { onScopeDispose, readonly, ref } from 'vue'

/** Tracks navigator.onLine. Works in components and in any effect scope. */
export function useOnline() {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const update = () => {
    online.value = navigator.onLine
  }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })
  return readonly(online)
}

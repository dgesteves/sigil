import {
  type MaybeRefOrGetter,
  onWatcherCleanup,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import { fetchStock, type StockLevel } from '../api.ts'

export interface UseStockLevelOptions {
  /** Refresh interval in milliseconds. Defaults to 30 seconds. */
  pollMs?: number
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

/**
 * Live stock for one SKU in one warehouse. `sku` and `warehouse` may be plain values, refs or
 * getters; pass props as getters (`() => sku`) so changes are tracked. Works in components and in
 * any effect scope: stopping the scope stops polling and aborts the in-flight request.
 */
export function useStockLevel(
  sku: MaybeRefOrGetter<string>,
  warehouse: MaybeRefOrGetter<string>,
  options: UseStockLevelOptions = {},
) {
  const pollMs = options.pollMs ?? 30_000
  const stock = shallowRef<StockLevel | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)

  // Bumped by refresh() so the watcher re-runs through the same cleanup path.
  const manualRefresh = ref(0)
  let controller: AbortController | undefined

  async function load(currentSku: string, currentWarehouse: string) {
    controller?.abort()
    const ctrl = new AbortController()
    controller = ctrl
    loading.value = true
    try {
      const result = await fetchStock(currentSku, currentWarehouse, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      stock.value = result
      error.value = null
    } catch (err) {
      if (ctrl.signal.aborted || isAbort(err)) return
      error.value = err
    } finally {
      if (controller === ctrl) loading.value = false
    }
  }

  watch(
    [() => toValue(sku), () => toValue(warehouse), manualRefresh],
    ([currentSku, currentWarehouse], previous) => {
      const sameTarget =
        previous !== undefined && previous[0] === currentSku && previous[1] === currentWarehouse
      if (!sameTarget) stock.value = null

      void load(currentSku, currentWarehouse)
      const timer = setInterval(() => void load(currentSku, currentWarehouse), pollMs)

      // Registered synchronously, before any await: runs when the inputs change and when the
      // owning scope (component or effectScope) stops.
      onWatcherCleanup(() => {
        clearInterval(timer)
        controller?.abort()
        controller = undefined
        loading.value = false
      })
    },
    { immediate: true },
  )

  return {
    stock: readonly(stock),
    loading: readonly(loading),
    error: readonly(error),
    refresh: () => {
      manualRefresh.value++
    },
  }
}

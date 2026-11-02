import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import { fetchStock } from '../../src/api.ts'
import StockBadge from '../../src/components/StockBadge.vue'
import { useStockLevel } from '../../src/composables/useStockLevel.ts'
import { inventory } from './inventory-mock.ts'

vi.mock('../../src/api.ts', () => ({ fetchStock: vi.fn() }))
const fetchStockMock = vi.mocked(fetchStock)

const settle = async () => {
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  fetchStockMock.mockReset()
})

function run<T>(fn: () => T) {
  const scope = effectScope()
  const result = scope.run(fn) as T
  return { scope, result }
}

const targets = (calls: { sku: string; warehouse: string }[]) =>
  calls.map((c) => `${c.sku}@${c.warehouse}`)

describe('useStockLevel', () => {
  test('fetches plain values right away and exposes stock, loading and error', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const { scope, result } = run(() => useStockLevel('TEE-RED-M', 'main'))
    await nextTick()
    expect(targets(inv.calls)).toEqual(['TEE-RED-M@main'])
    expect(inv.calls[0]!.signal, 'fetchStock must receive an AbortSignal').toBeInstanceOf(AbortSignal)
    expect(result.loading.value).toBe(true)
    expect(result.stock.value).toBeNull()
    inv.calls[0]!.resolve(7)
    await settle()
    expect(result.stock.value).toMatchObject({ sku: 'TEE-RED-M', warehouse: 'main', available: 7 })
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
    scope.stop()
  })

  test('refetches when a ref changes and aborts the request in flight', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const sku = ref('TEE-RED-M')
    const { scope, result } = run(() => useStockLevel(sku, 'main'))
    await nextTick()
    sku.value = 'TEE-BLUE-M'
    await nextTick()
    expect(targets(inv.calls)).toEqual(['TEE-RED-M@main', 'TEE-BLUE-M@main'])
    expect(inv.calls[0]!.signal?.aborted).toBe(true)
    expect(inv.calls[1]!.signal?.aborted).toBe(false)
    await settle()
    expect(result.error.value, 'an abort is not an error').toBeNull()
    expect(result.loading.value).toBe(true)
    inv.calls[1]!.resolve(3)
    await settle()
    expect(result.stock.value).toMatchObject({ sku: 'TEE-BLUE-M', available: 3 })
    expect(result.loading.value).toBe(false)
    scope.stop()
  })

  test('accepts getters and computed refs, and tracks the warehouse too', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const variant = ref({ sku: 'MUG-01' })
    const store = ref('main')
    const { scope } = run(() =>
      useStockLevel(
        () => variant.value.sku,
        computed(() => store.value),
      ),
    )
    await nextTick()
    store.value = 'berlin'
    await nextTick()
    variant.value = { sku: 'MUG-02' }
    await nextTick()
    expect(targets(inv.calls)).toEqual(['MUG-01@main', 'MUG-01@berlin', 'MUG-02@berlin'])
    scope.stop()
  })

  test('never shows stock for a sku other than the current one', async () => {
    // This backend ignores aborts, so the old response still arrives.
    const inv = inventory({ honourAbort: false })
    fetchStockMock.mockImplementation(inv.impl)
    const sku = ref('TEE-RED-M')
    const { scope, result } = run(() => useStockLevel(sku, 'main'))
    await nextTick()
    inv.calls[0]!.resolve(12)
    await settle()
    expect(result.stock.value).toMatchObject({ sku: 'TEE-RED-M', available: 12 })

    sku.value = 'TEE-BLUE-M'
    await nextTick()
    expect(result.stock.value, 'the previous variant stock must be cleared while loading').toBeNull()
    expect(result.loading.value).toBe(true)

    sku.value = 'TEE-GREEN-M'
    await nextTick()
    inv.calls[2]!.resolve(5)
    await settle()
    inv.calls[1]!.resolve(99) // late response for TEE-BLUE-M
    await settle()
    expect(result.stock.value).toMatchObject({ sku: 'TEE-GREEN-M', available: 5 })
    expect(result.loading.value).toBe(false)
    scope.stop()
  })

  test('polls every pollMs and restarts the interval when the sku changes', async () => {
    const inv = inventory({ autoResolve: 4 })
    fetchStockMock.mockImplementation(inv.impl)
    const sku = ref('SOCK-01')
    const { scope } = run(() => useStockLevel(sku, 'main', { pollMs: 1000 }))
    await nextTick()
    expect(inv.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inv.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inv.calls).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(600) // t = 2600
    sku.value = 'SOCK-02'
    await nextTick()
    expect(targets(inv.calls).at(-1)).toBe('SOCK-02@main')
    expect(inv.calls).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(500) // t = 3100: the old schedule would poll at 3000
    expect(inv.calls).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(500) // t = 3600: one interval after the change
    expect(inv.calls).toHaveLength(5)
    expect(targets(inv.calls).at(-1)).toBe('SOCK-02@main')
    scope.stop()
  })

  test('polls every 30 seconds by default', async () => {
    const inv = inventory({ autoResolve: 1 })
    fetchStockMock.mockImplementation(inv.impl)
    const { scope } = run(() => useStockLevel('SOCK-01', 'main'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(inv.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(inv.calls).toHaveLength(2)
    scope.stop()
  })

  test('reports errors and clears them on the next success', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const { scope, result } = run(() => useStockLevel('CAP-01', 'main', { pollMs: 1000 }))
    await nextTick()
    const boom = new Error('inventory responded 503 for CAP-01')
    inv.calls[0]!.reject(boom)
    await settle()
    expect(result.error.value).toBe(boom)
    expect(result.loading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inv.calls).toHaveLength(2)
    inv.calls[1]!.resolve(2)
    await settle()
    expect(result.error.value).toBeNull()
    expect(result.stock.value).toMatchObject({ sku: 'CAP-01', available: 2 })
    scope.stop()
  })

  test('refresh() fetches again', async () => {
    const inv = inventory({ autoResolve: 6 })
    fetchStockMock.mockImplementation(inv.impl)
    const { scope, result } = run(() => useStockLevel('CAP-01', 'main'))
    await settle()
    expect(inv.calls).toHaveLength(1)
    result.refresh()
    await settle()
    expect(targets(inv.calls)).toEqual(['CAP-01@main', 'CAP-01@main'])
    scope.stop()
  })

  test('stopping the effect scope stops polling and aborts the request in flight', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const { scope } = run(() => useStockLevel('CAP-01', 'main', { pollMs: 1000 }))
    await nextTick()
    scope.stop()
    await settle()
    expect(inv.calls[0]!.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(inv.calls).toHaveLength(1)
  })
})

describe('StockBadge', () => {
  test('follows sku changes from its parent', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M' } })
    await nextTick()
    inv.calls[0]!.resolve(12)
    await settle()
    expect(wrapper.text()).toBe('In stock (12)')

    await wrapper.setProps({ sku: 'TEE-BLUE-M' })
    await nextTick()
    expect(targets(inv.calls)).toEqual(['TEE-RED-M@main', 'TEE-BLUE-M@main'])
    expect(wrapper.text()).toBe('Checking stock…')
    inv.calls[1]!.resolve(0)
    await settle()
    expect(wrapper.text()).toBe('Out of stock')
    wrapper.unmount()
  })

  test('follows warehouse changes and aborts the old request', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M', warehouse: 'main' } })
    await nextTick()
    await wrapper.setProps({ warehouse: 'berlin' })
    await nextTick()
    expect(targets(inv.calls)).toEqual(['TEE-RED-M@main', 'TEE-RED-M@berlin'])
    expect(inv.calls[0]!.signal?.aborted).toBe(true)
    inv.calls[1]!.resolve(4)
    await settle()
    expect(wrapper.text()).toBe('In stock (4)')
    wrapper.unmount()
  })

  test('polls with its pollMs and stops when unmounted', async () => {
    const inv = inventory({ autoResolve: 9 })
    fetchStockMock.mockImplementation(inv.impl)
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M', pollMs: 2000 } })
    await settle()
    expect(wrapper.text()).toBe('In stock (9)')
    await vi.advanceTimersByTimeAsync(2000)
    expect(inv.calls).toHaveLength(2)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(inv.calls).toHaveLength(2)
  })

  test('aborts the request in flight when unmounted', async () => {
    const inv = inventory()
    fetchStockMock.mockImplementation(inv.impl)
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M' } })
    await nextTick()
    wrapper.unmount()
    await settle()
    expect(inv.calls[0]!.signal?.aborted).toBe(true)
  })
})

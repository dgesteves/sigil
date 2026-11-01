import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchStock } from '../src/api.ts'
import StockBadge from '../src/components/StockBadge.vue'

vi.mock('../src/api.ts', () => ({ fetchStock: vi.fn() }))
const fetchStockMock = vi.mocked(fetchStock)

afterEach(() => {
  vi.resetAllMocks()
})

describe('StockBadge', () => {
  test('shows the stock for its sku', async () => {
    fetchStockMock.mockResolvedValue({ sku: 'TEE-RED-M', warehouse: 'main', available: 12 })
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M' } })
    expect(wrapper.text()).toBe('Checking stock…')
    await flushPromises()
    expect(wrapper.text()).toBe('In stock (12)')
    expect(fetchStockMock.mock.calls[0]?.slice(0, 2)).toEqual(['TEE-RED-M', 'main'])
    wrapper.unmount()
  })

  test('shows out of stock', async () => {
    fetchStockMock.mockResolvedValue({ sku: 'TEE-RED-S', warehouse: 'berlin', available: 0 })
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-S', warehouse: 'berlin' } })
    await flushPromises()
    expect(wrapper.text()).toBe('Out of stock')
    expect(fetchStockMock.mock.calls[0]?.slice(0, 2)).toEqual(['TEE-RED-S', 'berlin'])
    wrapper.unmount()
  })

  test('shows when stock cannot be loaded', async () => {
    fetchStockMock.mockRejectedValue(new Error('inventory responded 503 for TEE-RED-M'))
    const wrapper = mount(StockBadge, { props: { sku: 'TEE-RED-M' } })
    await flushPromises()
    expect(wrapper.text()).toBe('Stock unavailable')
    wrapper.unmount()
  })
})

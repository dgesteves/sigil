// Ids as the legacy order system mints them: UUID-shaped, not RFC 4122 compliant.
export const LEGACY_ID = '7f3a9c2e-0000-1000-0000-00000000a1b2'
export const OTHER_LEGACY_ID = '00000000-0000-0000-0000-000000004242'

export function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LEGACY_ID,
    customerEmail: 'grace@example.com',
    items: [
      { sku: 'BOOK-001', quantity: 2, unitPrice: { amount: 1250, currency: 'EUR' } },
      { sku: 'PEN-RED', quantity: 1, unitPrice: { amount: 199, currency: 'EUR' } },
    ],
    ...overrides,
  }
}

export function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sku: 'BOOK-001', quantity: 1, unitPrice: { amount: 1250, currency: 'EUR' }, ...overrides }
}

export interface StockLevel {
  sku: string
  warehouse: string
  /** Units that can be sold right now. */
  available: number
}

const BASE_URL = 'https://inventory.internal.example/v2'

/** Current stock for one SKU in one warehouse. Rejects with an AbortError when `signal` aborts. */
export async function fetchStock(
  sku: string,
  warehouse: string,
  init: { signal?: AbortSignal } = {},
): Promise<StockLevel> {
  const url = `${BASE_URL}/stock/${encodeURIComponent(warehouse)}/${encodeURIComponent(sku)}`
  const res = await fetch(url, { signal: init.signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`inventory responded ${res.status} for ${sku}`)
  const body = (await res.json()) as { available: number }
  return { sku, warehouse, available: body.available }
}

import { vi } from 'vitest'
import type { StockLevel } from '../../src/api.ts'

export interface PendingCall {
  sku: string
  warehouse: string
  signal: AbortSignal | undefined
  resolve: (available: number) => void
  reject: (err: unknown) => void
  settled: boolean
}

/**
 * Stand-in for fetchStock. Every call stays pending until the test settles it, like a slow network.
 * With `honourAbort` (the default) an aborted call rejects with an AbortError, as fetch does.
 */
export function inventory({ honourAbort = true, autoResolve }: { honourAbort?: boolean; autoResolve?: number } = {}) {
  const calls: PendingCall[] = []
  const impl = (sku: string, warehouse: string, init?: { signal?: AbortSignal }) =>
    new Promise<StockLevel>((resolve, reject) => {
      const call: PendingCall = {
        sku,
        warehouse,
        signal: init?.signal,
        settled: false,
        resolve: (available) => {
          if (call.settled) return
          call.settled = true
          resolve({ sku, warehouse, available })
        },
        reject: (err) => {
          if (call.settled) return
          call.settled = true
          reject(err)
        },
      }
      calls.push(call)
      if (honourAbort) {
        init?.signal?.addEventListener('abort', () =>
          call.reject(new DOMException('This operation was aborted', 'AbortError')),
        )
      }
      if (autoResolve !== undefined) queueMicrotask(() => call.resolve(autoResolve))
    })
  return { calls, impl: vi.fn(impl) }
}

import { type ApiIssue, toApiIssues } from './errors.ts'
import { Order } from './schemas.ts'

export type ParseResult = { ok: true; order: Order } | { ok: false; issues: ApiIssue[] }

/** Validates a POST /orders body. */
export function parseOrder(body: unknown): ParseResult {
  const result = Order.safeParse(body)
  if (!result.success) return { ok: false, issues: toApiIssues(result.error) }
  return { ok: true, order: result.data }
}

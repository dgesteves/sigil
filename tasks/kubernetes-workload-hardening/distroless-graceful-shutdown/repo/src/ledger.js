// In-memory stand-in for the Postgres-backed ledger used in production.
const accounts = new Map([
  ['acc_ops', { id: 'acc_ops', currency: 'EUR' }],
  ['acc_payroll', { id: 'acc_payroll', currency: 'EUR' }],
])

export function account(id) {
  return accounts.get(id)
}

/** Deterministic entries so exports are reproducible. */
export function* entries(id, count) {
  let seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0)
  for (let i = 1; i <= count; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const amount = (seed % 200_000) - 100_000
    yield { id: `${id}-${i}`, amountCents: amount, bookedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }
  }
}

export function balance(id, count = 500) {
  let total = 0
  for (const e of entries(id, count)) total += e.amountCents
  return total
}

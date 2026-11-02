export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Parses "39.5", "39.50" or "$39.50" into cents. Returns null for anything else. */
export function parsePrice(input: FormDataEntryValue | null): number | null {
  if (typeof input !== 'string') return null
  const match = /^\s*\$?(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(input)
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'))
  return cents > 0 ? cents : null
}

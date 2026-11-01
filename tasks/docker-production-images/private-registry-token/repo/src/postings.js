// A journal entry is a list of postings in integer cents. It is balanced when debits equal credits.
export function validateEntry(entry) {
  const problems = []
  if (!entry || typeof entry !== 'object') return ['entry must be an object']
  if (typeof entry.id !== 'string' || entry.id.length === 0) problems.push('id is required')
  if (!Array.isArray(entry.postings) || entry.postings.length < 2) {
    problems.push('an entry needs at least two postings')
    return problems
  }
  let debits = 0
  let credits = 0
  for (const [i, p] of entry.postings.entries()) {
    if (typeof p.account !== 'string' || !/^[0-9]{4}(-[0-9]{2})?$/.test(p.account))
      problems.push(`postings[${i}].account must look like 4000 or 4000-01`)
    if (!Number.isSafeInteger(p.cents) || p.cents <= 0) problems.push(`postings[${i}].cents must be a positive integer`)
    if (p.side === 'debit') debits += p.cents
    else if (p.side === 'credit') credits += p.cents
    else problems.push(`postings[${i}].side must be debit or credit`)
  }
  if (problems.length === 0 && debits !== credits) problems.push(`unbalanced: debits ${debits} != credits ${credits}`)
  return problems
}

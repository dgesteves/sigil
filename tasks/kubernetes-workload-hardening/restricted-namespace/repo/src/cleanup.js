const days = Number(process.env.LABEL_RETENTION_DAYS ?? 90)
const cutoff = new Date(Date.now() - days * 86_400_000)
// The storage client deletes label objects older than the cutoff.
console.log(`expiring labels created before ${cutoff.toISOString()}`)

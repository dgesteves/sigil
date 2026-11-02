const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export const formatCents = (cents: number) => eur.format(cents / 100)

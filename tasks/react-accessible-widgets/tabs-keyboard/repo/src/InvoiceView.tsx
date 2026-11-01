import { Tabs } from './Tabs.tsx'

export interface Invoice {
  number: string
  total: string
  lines: { description: string; amount: string }[]
  payments: { date: string; amount: string }[]
}

export function InvoiceView({ invoice }: { invoice: Invoice }) {
  return (
    <section>
      <h1>Invoice {invoice.number}</h1>
      <Tabs
        label="Invoice sections"
        tabs={[
          { id: 'summary', title: 'Summary', content: <p>Total due: {invoice.total}</p> },
          {
            id: 'lines',
            title: 'Line items',
            content: (
              <ul>
                {invoice.lines.map((line) => (
                  <li key={line.description}>
                    {line.description}: {line.amount}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: 'payments',
            title: 'Payments',
            content: (
              <ul>
                {invoice.payments.map((payment) => (
                  <li key={payment.date}>
                    {payment.date}: {payment.amount}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </section>
  )
}

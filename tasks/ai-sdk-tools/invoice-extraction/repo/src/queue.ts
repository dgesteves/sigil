import type { LanguageModel } from 'ai'
import { InvoiceExtractionError } from './errors.ts'
import { extractInvoice } from './extract.ts'
import type { Invoice } from './invoice.ts'

export type QueueEntry =
  | { kind: 'invoice'; invoice: Invoice; summary: string }
  | { kind: 'needs-review'; reason: string; rawText: string | undefined }

export function summarize(invoice: Invoice): string {
  const due = invoice.dueDate ? `due ${invoice.dueDate}` : 'no due date'
  return `${invoice.vendorName} ${invoice.invoiceNumber}: ${invoice.total.toFixed(2)} ${invoice.currency}, ${due}`
}

/** Every email ends up in the approval queue: as an invoice, or flagged for a human. */
export async function enqueueEmail(model: LanguageModel, emailText: string): Promise<QueueEntry> {
  try {
    const invoice = await extractInvoice(model, emailText)
    return { kind: 'invoice', invoice, summary: summarize(invoice) }
  } catch (error) {
    if (error instanceof InvoiceExtractionError) {
      return { kind: 'needs-review', reason: error.message, rawText: error.rawText }
    }
    throw error
  }
}

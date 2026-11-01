import type { LanguageModel } from 'ai'
import type { Invoice } from './invoice.ts'

/**
 * Extracts the invoice described in a vendor email.
 * TODO(AP-212): implement with the model.
 */
export async function extractInvoice(model: LanguageModel, emailText: string): Promise<Invoice> {
  void model
  void emailText
  throw new Error('extractInvoice is not implemented yet')
}

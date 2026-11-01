import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { InvoiceExtractionError } from './errors.ts'
import type { Invoice } from './invoice.ts'

const isoDate = z.iso.date().describe('YYYY-MM-DD')

export const invoiceSchema = z.object({
  vendorName: z.string().min(1),
  invoiceNumber: z.string().min(1),
  issueDate: isoDate,
  dueDate: isoDate.nullable().describe('YYYY-MM-DD, or null when the email gives no due date'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe('ISO 4217 currency code, e.g. EUR'),
  lineItems: z.array(
    z.object({
      description: z.string().min(1),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
    }),
  ),
  total: z.number(),
}) satisfies z.ZodType<Invoice>

const INSTRUCTIONS = `You extract invoices from vendor emails for an accounts-payable team.
Copy numbers exactly as written. Use null for a due date the email does not state.`

export async function extractInvoice(model: LanguageModel, emailText: string): Promise<Invoice> {
  try {
    const { output } = await generateText({
      model,
      instructions: INSTRUCTIONS,
      prompt: emailText,
      output: Output.object({ name: 'Invoice', schema: invoiceSchema }),
      temperature: 0,
      maxOutputTokens: 1000,
    })
    return output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new InvoiceExtractionError('The model did not return a valid invoice', {
        rawText: error.text,
        cause: error,
      })
    }
    throw error
  }
}

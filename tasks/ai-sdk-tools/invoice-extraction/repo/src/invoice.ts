export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
}

export interface Invoice {
  vendorName: string
  invoiceNumber: string
  /** YYYY-MM-DD */
  issueDate: string
  /** YYYY-MM-DD, or null when the email gives no due date */
  dueDate: string | null
  /** ISO 4217 code, e.g. EUR */
  currency: string
  lineItems: InvoiceLineItem[]
  total: number
}

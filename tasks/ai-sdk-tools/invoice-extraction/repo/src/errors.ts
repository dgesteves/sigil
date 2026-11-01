export class InvoiceExtractionError extends Error {
  readonly rawText: string | undefined

  constructor(message: string, options: { rawText?: string | undefined; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'InvoiceExtractionError'
    this.rawText = options.rawText
  }
}

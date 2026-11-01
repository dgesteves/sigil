import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A minimal one-page PDF with the shipment's address block. */
export function pdfFor(shipment) {
  const text = `${shipment.name} / ${shipment.street} / ${shipment.postcode} ${shipment.city}`
  const stream = `BT /F1 12 Tf 36 400 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  return [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R >> endobj',
    `4 0 obj << /Length ${stream.length} >> stream`,
    stream,
    'endstream endobj',
    '%%EOF',
  ].join('\n')
}

/**
 * Renders a label to a temporary file (the carrier SDK only accepts file paths), reads it back and
 * removes the temporary directory.
 */
export async function renderLabel(shipment) {
  const dir = await mkdtemp(join(tmpdir(), 'label-'))
  const file = join(dir, `${shipment.id}.pdf`)
  try {
    await writeFile(file, pdfFor(shipment))
    return await readFile(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

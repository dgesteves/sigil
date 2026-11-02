'use server'

import { redirect } from 'next/navigation'
import { currentEditor } from '@/lib/auth'
import { setPrice } from '@/lib/db'
import { parsePrice } from '@/lib/format'

export async function savePrice(productId: string, formData: FormData) {
  if (!(await currentEditor())) throw new Error('Only staff can change prices')
  const priceCents = parsePrice(formData.get('price'))
  if (priceCents === null) throw new Error('Enter a price like 39.50')

  await setPrice(productId, priceCents)
  redirect(`/products/${productId}`)
}

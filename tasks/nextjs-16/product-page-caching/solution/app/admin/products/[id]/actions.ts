'use server'

import { updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentEditor } from '@/lib/auth'
import { productTag } from '@/lib/catalog'
import { setPrice } from '@/lib/db'
import { parsePrice } from '@/lib/format'

export async function savePrice(productId: string, formData: FormData) {
  if (!(await currentEditor())) throw new Error('Only staff can change prices')
  const priceCents = parsePrice(formData.get('price'))
  if (priceCents === null) throw new Error('Enter a price like 39.50')

  await setPrice(productId, priceCents)
  // Read-your-own-writes: expire now, so the redirect and any reload render the new price.
  updateTag(productTag(productId))
  redirect(`/products/${productId}`)
}

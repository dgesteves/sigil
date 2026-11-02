import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { currentEditor } from '@/lib/auth'
import { getProduct } from '@/lib/db'
import { savePrice } from './actions'

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <EditPrice params={params} />
    </Suspense>
  )
}

async function EditPrice({ params }: { params: Promise<{ id: string }> }) {
  const editor = await currentEditor()
  if (!editor) notFound()
  const { id } = await params
  const product = await getProduct(id)
  if (!product) notFound()

  return (
    <form action={savePrice.bind(null, product.id)}>
      <h1>{product.name}</h1>
      <label>
        Price (USD) <input name="price" defaultValue={(product.priceCents / 100).toFixed(2)} />
      </label>
      <button type="submit">Save price</button>
    </form>
  )
}

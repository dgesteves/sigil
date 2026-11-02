import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getProduct } from '@/lib/db'
import { formatPrice } from '@/lib/format'

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Loading product…</p>}>
      <ProductDetails params={params} />
    </Suspense>
  )
}

async function ProductDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) notFound()

  return (
    <article>
      <h1 data-testid="name">{product.name}</h1>
      <p>{product.description}</p>
      <p data-testid="price">{formatPrice(product.priceCents)}</p>
      <p data-testid="stock">{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</p>
    </article>
  )
}

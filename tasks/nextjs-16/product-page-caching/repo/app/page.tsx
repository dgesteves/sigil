import Link from 'next/link'
import { Suspense } from 'react'
import { listProducts } from '@/lib/db'
import { formatPrice } from '@/lib/format'

export default function Home() {
  return (
    <section>
      <h1>Coffee gear</h1>
      <Suspense fallback={<p>Loading products…</p>}>
        <ProductList />
      </Suspense>
    </section>
  )
}

async function ProductList() {
  const products = await listProducts()
  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>
          <Link href={`/products/${p.id}`}>{p.name}</Link> {formatPrice(p.priceCents)}
        </li>
      ))}
    </ul>
  )
}

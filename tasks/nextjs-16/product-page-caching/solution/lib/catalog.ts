import { cacheLife, cacheTag } from 'next/cache'
import { getProduct, type Product } from './db'

export const productTag = (id: string) => `product:${id}`

/** Shopper-facing product reads. Up to an hour old, refreshed on demand by tag. */
export async function getCachedProduct(id: string): Promise<Product | null> {
  'use cache'
  cacheLife('hours')
  cacheTag(productTag(id))
  return getProduct(id)
}

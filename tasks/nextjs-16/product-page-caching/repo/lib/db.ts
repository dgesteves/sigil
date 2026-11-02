// Catalog database client.
//
// Production talks to Postgres; locally the catalog lives in data/catalog.json so the shop runs
// without services. Every read is appended to data/reads.log, which is how we watch query volume.
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Product = {
  id: string
  name: string
  description: string
  priceCents: number
  stock: number
}

const catalogFile = join(process.cwd(), 'data', 'catalog.json')
const readsFile = join(process.cwd(), 'data', 'reads.log')

async function load(): Promise<Record<string, Product>> {
  return JSON.parse(await readFile(catalogFile, 'utf8'))
}

async function save(catalog: Record<string, Product>): Promise<void> {
  await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)
}

export async function getProduct(id: string): Promise<Product | null> {
  await appendFile(readsFile, `product ${id}\n`)
  const catalog = await load()
  return catalog[id] ?? null
}

export async function listProducts(): Promise<Product[]> {
  await appendFile(readsFile, 'list\n')
  return Object.values(await load())
}

export async function setPrice(id: string, priceCents: number): Promise<void> {
  const catalog = await load()
  const product = catalog[id]
  if (!product) throw new Error(`Unknown product ${id}`)
  product.priceCents = priceCents
  await save(catalog)
}

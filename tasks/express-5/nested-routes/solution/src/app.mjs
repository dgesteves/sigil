import express from 'express'
import { categories, products } from './catalog.mjs'

const knownCategories = new Set(categories)

function toCsvField(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function findProduct(sku) {
  return products.find((p) => p.sku === sku)
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '50kb' }))

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/products', (req, res) => {
    res.json({ products })
  })

  // Express 5 wildcards must be named and capture an array of decoded path segments.
  app.get('/api/categories/*segments', (req, res) => {
    const path = req.params.segments.join('/')
    if (!knownCategories.has(path)) return res.status(404).json({ error: 'not_found' })
    const inCategory = products.filter((p) => p.category === path || p.category.startsWith(`${path}/`))
    res.json({ path, products: inCategory })
  })

  // Optional suffix: `{.:format}` replaces Express 4's `:format?`.
  app.get('/api/products/:sku{.:format}', (req, res) => {
    const { sku, format } = req.params
    if (format !== undefined && format !== 'csv') return res.status(404).json({ error: 'not_found' })
    const product = findProduct(sku)
    if (!product) return res.status(404).json({ error: 'not_found' })
    if (format === 'csv') {
      const row = [product.sku, product.name, product.price].map(toCsvField).join(',')
      return res.type('text/csv').send(`sku,name,price\n${row}\n`)
    }
    res.json(product)
  })

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  return app
}

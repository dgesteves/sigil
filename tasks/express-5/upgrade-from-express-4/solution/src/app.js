'use strict'

const path = require('node:path')
const express = require('express')
const { createStore } = require('./store')

const DOCS_DIR = path.join(__dirname, '..', 'docs')
const COVER_SIZES = ['small', 'medium', 'large']

function createApp({ store = createStore() } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Express 5 defaults to the "simple" query parser; clients send filter[genre]=... so keep qs parsing.
  app.set('query parser', 'extended')
  app.use(express.json())
  // Express 5 defaults extended to false; the website form posts address[city]=...
  app.use(express.urlencoded({ extended: true }))

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  // GET /api/books?filter[genre]=sf&filter[author]=...&page=2&limit=5
  app.get('/api/books', (req, res) => {
    // req.query is a getter in Express 5: assignments to it are lost, so keep derived values local.
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50)
    const page = parseInt(req.query.page, 10) || 1
    const filter = req.query.filter || {}

    let books = store.books
    if (filter.genre) books = books.filter((b) => b.genre === filter.genre)
    if (filter.author) books = books.filter((b) => b.author === filter.author)

    const start = (page - 1) * limit
    res.json({ page, limit, total: books.length, items: books.slice(start, start + limit) })
  })

  app.get('/api/books/:id', (req, res) => {
    const book = store.findBook(req.params.id)
    if (!book) return res.sendStatus(404)
    res.json(book)
  })

  // Cover image, optionally sized: /api/books/b1/cover or /api/books/b1/cover/large
  app.get('/api/books/:id/cover{/:size}', (req, res) => {
    const book = store.findBook(req.params.id)
    if (!book) return res.sendStatus(404)
    const size = req.params.size || 'medium'
    if (!COVER_SIZES.includes(size)) return res.status(400).json({ error: 'invalid size' })
    res.redirect(`https://covers.example.com/${book.isbn}-${size}.jpg`)
  })

  // Borrow a book. The JSON body is optional: { "days": 7 }
  app.post('/api/books/:id/borrow', (req, res) => {
    const book = store.findBook(req.params.id)
    if (!book) return res.sendStatus(404)
    // req.body is undefined in Express 5 when no body was parsed.
    const days = Math.min(parseInt(req.body?.days, 10) || 14, 28)
    res.json({ bookId: book.id, days })
  })

  // Sign-up comes from the website form (urlencoded, address[city]=...) and from the app (JSON).
  app.post('/api/users', (req, res) => {
    const { name, email, address } = req.body ?? {}
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' })
    const user = store.addUser({ name, email, address })
    res.status(201).json(user)
  })

  app.delete('/api/users/:id', (req, res) => {
    res.sendStatus(store.removeUser(req.params.id) ? 204 : 404)
  })

  app.post('/logout', (req, res) => {
    res.clearCookie('sid')
    res.redirect(req.get('Referrer') || '/')
  })

  // Markdown docs, including nested folders: /docs/guides/borrowing.md
  // Named wildcard; the value is an array of decoded segments. `root` keeps sendFile inside DOCS_DIR.
  app.get('/docs/*file', (req, res, next) => {
    res.sendFile(req.params.file.join('/'), { root: DOCS_DIR }, (err) => {
      if (err) next(err)
    })
  })

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use((err, req, res, next) => {
    const status = err.status || 500
    res.status(status).json({ error: status === 404 ? 'not_found' : status < 500 ? err.message : 'internal_error' })
  })

  return app
}

module.exports = { createApp }

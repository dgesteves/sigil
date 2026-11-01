'use strict'

const path = require('node:path')
const express = require('express')
const { createStore } = require('./store')

const DOCS_DIR = path.join(__dirname, '..', 'docs')
const COVER_SIZES = ['small', 'medium', 'large']

function createApp({ store = createStore() } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())
  app.use(express.urlencoded())

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  // GET /api/books?filter[genre]=sf&filter[author]=...&page=2&limit=5
  app.get('/api/books', (req, res) => {
    req.query.limit = Math.min(parseInt(req.query.limit, 10) || 20, 50)
    req.query.page = parseInt(req.query.page, 10) || 1
    const filter = req.query.filter || {}

    let books = store.books
    if (filter.genre) books = books.filter((b) => b.genre === filter.genre)
    if (filter.author) books = books.filter((b) => b.author === filter.author)

    const start = (req.query.page - 1) * req.query.limit
    res.json({
      page: req.query.page,
      limit: req.query.limit,
      total: books.length,
      items: books.slice(start, start + req.query.limit),
    })
  })

  app.get('/api/books/:id', (req, res) => {
    const book = store.findBook(req.param('id'))
    if (!book) return res.send(404)
    res.json(book)
  })

  // Cover image, optionally sized: /api/books/b1/cover or /api/books/b1/cover/large
  app.get('/api/books/:id/cover/:size?', (req, res) => {
    const book = store.findBook(req.params.id)
    if (!book) return res.send(404)
    const size = req.params.size || 'medium'
    if (!COVER_SIZES.includes(size)) return res.json({ error: 'invalid size' }, 400)
    res.redirect(`https://covers.example.com/${book.isbn}-${size}.jpg`)
  })

  // Borrow a book. The JSON body is optional: { "days": 7 }
  app.post('/api/books/:id/borrow', (req, res) => {
    const book = store.findBook(req.params.id)
    if (!book) return res.send(404)
    const days = Math.min(parseInt(req.body.days, 10) || 14, 28)
    res.json({ bookId: book.id, days })
  })

  // Sign-up comes from the website form (urlencoded, address[city]=...) and from the app (JSON).
  app.post('/api/users', (req, res) => {
    const { name, email, address } = req.body
    if (!name || !email) return res.json({ error: 'name and email are required' }, 400)
    const user = store.addUser({ name, email, address })
    res.json(user, 201)
  })

  app.del('/api/users/:id', (req, res) => {
    res.send(store.removeUser(req.params.id) ? 204 : 404)
  })

  app.post('/logout', (req, res) => {
    res.clearCookie('sid')
    res.redirect('back')
  })

  // Markdown docs, including nested folders: /docs/guides/borrowing.md
  app.get('/docs/*', (req, res, next) => {
    res.sendfile(req.params[0], { root: DOCS_DIR }, (err) => {
      if (err) next(err)
    })
  })

  app.all('*', (req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use((err, req, res, next) => {
    const status = err.status || 500
    res.status(status).json({ error: status === 404 ? 'not_found' : status < 500 ? err.message : 'internal_error' })
  })

  return app
}

module.exports = { createApp }

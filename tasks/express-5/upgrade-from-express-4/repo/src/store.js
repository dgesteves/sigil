'use strict'

const BOOKS = [
  { id: 'b1', title: 'The Dispossessed', author: 'Ursula K. Le Guin', genre: 'sf', isbn: '9780061054884' },
  { id: 'b2', title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin', genre: 'fantasy', isbn: '9780547773742' },
  { id: 'b3', title: 'Dune', author: 'Frank Herbert', genre: 'sf', isbn: '9780441172719' },
  { id: 'b4', title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', genre: 'sf', isbn: '9780441478125' },
  { id: 'b5', title: 'The Hobbit', author: 'J. R. R. Tolkien', genre: 'fantasy', isbn: '9780547928227' },
  { id: 'b6', title: 'The Murder of Roger Ackroyd', author: 'Agatha Christie', genre: 'mystery', isbn: '9780062073563' },
  { id: 'b7', title: 'Hyperion', author: 'Dan Simmons', genre: 'sf', isbn: '9780553283686' },
  { id: 'b8', title: 'The Name of the Rose', author: 'Umberto Eco', genre: 'mystery', isbn: '9780544176560' },
  { id: 'b9', title: 'Neuromancer', author: 'William Gibson', genre: 'sf', isbn: '9780441569595' },
  { id: 'b10', title: 'Piranesi', author: 'Susanna Clarke', genre: 'fantasy', isbn: '9781635575637' },
  { id: 'b11', title: 'Foundation', author: 'Isaac Asimov', genre: 'sf', isbn: '9780553293357' },
  { id: 'b12', title: 'Gaudy Night', author: 'Dorothy L. Sayers', genre: 'mystery', isbn: '9780062196538' },
]

function createStore() {
  const books = BOOKS.map((b) => ({ ...b }))
  const users = [{ id: 'u1', name: 'Rui', email: 'rui@example.com', address: { city: 'Lisbon' } }]
  let nextUser = 2

  return {
    books,
    findBook(id) {
      return books.find((b) => b.id === id)
    },
    addUser({ name, email, address }) {
      const user = { id: `u${nextUser++}`, name, email, address: address || null }
      users.push(user)
      return user
    },
    findUser(id) {
      return users.find((u) => u.id === id)
    },
    removeUser(id) {
      const i = users.findIndex((u) => u.id === id)
      if (i === -1) return false
      users.splice(i, 1)
      return true
    },
  }
}

module.exports = { createStore }

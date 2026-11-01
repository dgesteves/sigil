// In-memory stand-in for the Postgres repository used in production. Same interface, same errors.

export class OrderNotFoundError extends Error {
  constructor(id) {
    super(`order ${id} not found`)
    this.name = 'OrderNotFoundError'
    this.orderId = id
  }
}

export class OrderStateError extends Error {
  constructor(id, status) {
    super(`order ${id} is ${status} and can no longer be cancelled`)
    this.name = 'OrderStateError'
    this.orderId = id
    this.orderStatus = status
  }
}

export function createOrdersRepo() {
  const orders = new Map(
    [
      { id: '1001', sku: 'HP-200', quantity: 1, status: 'pending' },
      { id: '1002', sku: 'CAM-7', quantity: 2, status: 'pending' },
      { id: '1003', sku: 'KNF-3', quantity: 1, status: 'shipped' },
    ].map((o) => [o.id, o]),
  )
  let nextId = 1004

  return {
    async list() {
      return [...orders.values()]
    },
    async get(id) {
      return orders.get(id) ?? null
    },
    async create({ sku, quantity }) {
      if (sku == null || quantity == null) {
        throw new Error(
          'insert into "orders" failed: null value in column "sku" of relation "orders" violates not-null constraint (pg 10.0.3.7:5432)',
        )
      }
      const order = { id: String(nextId++), sku, quantity, status: 'pending' }
      orders.set(order.id, order)
      return order
    },
    async cancel(id) {
      const order = orders.get(id)
      if (!order) throw new OrderNotFoundError(id)
      if (order.status !== 'pending') throw new OrderStateError(id, order.status)
      order.status = 'cancelled'
      return order
    },
  }
}

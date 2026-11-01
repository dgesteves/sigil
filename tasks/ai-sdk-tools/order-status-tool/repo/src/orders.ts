export type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled'

export interface Order {
  id: string
  status: OrderStatus
  carrier?: string
  /** ISO date, e.g. 2026-11-04 */
  eta?: string
}

export interface OrderStore {
  findById(id: string): Promise<Order | undefined>
}

export function createMemoryOrderStore(orders: Order[]): OrderStore {
  const byId = new Map(orders.map((o) => [o.id, o]))
  return {
    async findById(id) {
      return byId.get(id)
    },
  }
}

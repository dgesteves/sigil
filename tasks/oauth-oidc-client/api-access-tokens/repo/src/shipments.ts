import { randomUUID } from 'node:crypto'

export interface Shipment {
  id: string
  owner: string
  destination: string
  status: 'label_created' | 'in_transit' | 'delivered'
  createdAt: string
}

/** In-memory for now; the Postgres-backed store keeps the same interface. */
export class ShipmentStore {
  readonly #byId = new Map<string, Shipment>()

  listFor(owner: string): Shipment[] {
    return [...this.#byId.values()].filter((s) => s.owner === owner)
  }

  create(owner: string, destination: string): Shipment {
    const shipment: Shipment = {
      id: randomUUID(),
      owner,
      destination,
      status: 'label_created',
      createdAt: new Date().toISOString(),
    }
    this.#byId.set(shipment.id, shipment)
    return shipment
  }
}

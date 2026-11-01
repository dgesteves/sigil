export interface Product {
  sku: string
  name: string
  unitPriceCents: number
}

export interface CartLine extends Product {
  qty: number
}

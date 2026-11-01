import { OrderStatus } from './schemas.ts'

export const terminalStatuses: readonly OrderStatus[] = [
  OrderStatus.Values.shipped,
  OrderStatus.Values.cancelled,
]

export function canCancel(status: OrderStatus): boolean {
  return status === OrderStatus.Enum.pending || status === OrderStatus.Enum.paid
}

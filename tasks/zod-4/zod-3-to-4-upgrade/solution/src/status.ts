import { OrderStatus } from './schemas.ts'

export const terminalStatuses: readonly OrderStatus[] = [OrderStatus.enum.shipped, OrderStatus.enum.cancelled]

export function canCancel(status: OrderStatus): boolean {
  return status === OrderStatus.enum.pending || status === OrderStatus.enum.paid
}

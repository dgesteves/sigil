export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface Ticket {
  id: string
  orgId: string
  title: string
  status: 'open' | 'pending' | 'closed'
  priority: Priority
}

export interface TicketStore {
  /** Tickets of one org whose title matches the query (case-insensitive). */
  search(orgId: string, query: string): Promise<Ticket[]>
  /** Returns the updated ticket, or undefined when the org has no such ticket. */
  setPriority(orgId: string, ticketId: string, priority: Priority): Promise<Ticket | undefined>
}

export function createMemoryTicketStore(tickets: Ticket[]): TicketStore {
  const all = tickets.map((t) => ({ ...t }))
  return {
    async search(orgId, query) {
      const q = query.toLowerCase()
      return all.filter((t) => t.orgId === orgId && t.title.toLowerCase().includes(q))
    },
    async setPriority(orgId, ticketId, priority) {
      const ticket = all.find((t) => t.orgId === orgId && t.id === ticketId)
      if (!ticket) return undefined
      ticket.priority = priority
      return { ...ticket }
    },
  }
}

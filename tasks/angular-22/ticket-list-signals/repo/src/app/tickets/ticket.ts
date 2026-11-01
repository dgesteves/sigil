export type TicketStatus = 'open' | 'pending' | 'solved';

export interface Ticket {
  id: string;
  subject: string;
  requester: string;
  status: TicketStatus;
  /** ISO 8601 timestamp of the last reply. */
  updatedAt: string;
}

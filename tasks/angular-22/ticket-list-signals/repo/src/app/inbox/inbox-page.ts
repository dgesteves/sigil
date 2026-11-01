import { Component, signal } from '@angular/core';
import { Ticket } from '../tickets/ticket';
import { TicketList } from '../tickets/ticket-list';

const SAMPLE: Ticket[] = [
  { id: 'T-1001', subject: 'Invoice PDF is blank', requester: 'Ana Ruiz', status: 'open', updatedAt: '2026-10-30T09:12:00Z' },
  { id: 'T-1002', subject: 'Cannot reset password', requester: 'Kofi Mensah', status: 'pending', updatedAt: '2026-10-30T10:40:00Z' },
  { id: 'T-1003', subject: 'Refund for order 5521', requester: 'Lena Vogel', status: 'solved', updatedAt: '2026-10-29T16:05:00Z' },
];

@Component({
  selector: 'app-inbox-page',
  imports: [TicketList],
  template: `
    <h1>Inbox</h1>
    <p class="selection">{{ selectedId ?? 'No ticket selected' }}</p>
    <app-ticket-list
      #list
      [tickets]="tickets()"
      statusFilter="all"
      compact
      autofocus
      [(selectedId)]="selectedId"
      (archive)="onArchive($event)"
    />
    <button type="button" (click)="list.focusSearch()">Search</button>
  `,
})
export class InboxPage {
  tickets = signal<Ticket[]>(SAMPLE);
  selectedId: string | null = null;

  onArchive(ticket: Ticket): void {
    this.tickets.update((list) => list.filter((t) => t.id !== ticket.id));
  }
}

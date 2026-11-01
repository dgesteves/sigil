import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ticket } from './ticket';
import { TicketList } from './ticket-list';

const TICKETS: Ticket[] = [
  { id: 'T-1', subject: 'Login loop on Safari', requester: 'Maya Chen', status: 'open', updatedAt: '2026-10-01T08:00:00Z' },
  { id: 'T-2', subject: 'Export to CSV fails', requester: 'Omar Haddad', status: 'pending', updatedAt: '2026-10-02T09:30:00Z' },
  { id: 'T-3', subject: 'Wrong VAT on invoice', requester: 'Maya Chen', status: 'solved', updatedAt: '2026-10-03T10:45:00Z' },
];

@Component({
  imports: [TicketList],
  template: `<app-ticket-list [tickets]="tickets()" [(selectedId)]="selectedId" />`,
})
class Host {
  tickets = signal(TICKETS);
  selectedId: string | null = null;
}

describe('TicketList', () => {
  it('renders every ticket by default', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const subjects = [...fixture.nativeElement.querySelectorAll('.subject')].map((b: Element) => b.textContent?.trim());
    expect(subjects).toEqual(['Login loop on Safari', 'Export to CSV fails', 'Wrong VAT on invoice']);
    expect(fixture.nativeElement.querySelector('.open-count').textContent).toContain('1 open');
  });

  it('selects a ticket through the two-way binding', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.nativeElement.querySelectorAll('.subject')[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedId).toBe('T-2');
    expect(fixture.nativeElement.querySelector('.ticket.selected').dataset.id).toBe('T-2');
  });
});

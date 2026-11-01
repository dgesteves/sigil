import { Component, EventEmitter, isSignal, reflectComponentType, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ticket } from '../app/tickets/ticket';
import { TicketList } from '../app/tickets/ticket-list';

const base: Ticket[] = [
  { id: 'T-1', subject: 'Login loop on Safari', requester: 'Maya Chen', status: 'open', updatedAt: '2026-10-01T08:00:00Z' },
  { id: 'T-2', subject: 'Export to CSV fails', requester: 'Omar Haddad', status: 'pending', updatedAt: '2026-10-02T09:30:00Z' },
  { id: 'T-3', subject: 'Wrong VAT on invoice', requester: 'Maya Chen', status: 'solved', updatedAt: '2026-10-03T10:45:00Z' },
  { id: 'T-4', subject: 'Webhook retries forever', requester: 'Ines Duarte', status: 'open', updatedAt: '2026-10-04T11:15:00Z' },
];
const clone = (list: Ticket[]) => list.map((t) => ({ ...t }));

@Component({
  imports: [TicketList],
  template: `
    <app-ticket-list
      #list
      [tickets]="tickets()"
      [statusFilter]="filter()"
      [(selectedId)]="selectedId"
      (archive)="archived.push($event)"
    />
    <button type="button" class="focus" (click)="list.focusSearch()">Search</button>
  `,
})
class FullHost {
  tickets = signal<Ticket[]>(clone(base));
  filter = signal<'all' | 'open' | 'pending' | 'solved'>('all');
  selectedId = signal<string | null>(null);
  archived: Ticket[] = [];
  list = viewChild.required(TicketList);
}

@Component({
  imports: [TicketList],
  template: `<app-ticket-list [tickets]="tickets" statusFilter="open" compact autofocus />`,
})
class AttributeHost {
  tickets = clone(base);
}

async function setup() {
  const fixture = TestBed.createComponent(FullHost);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, host: fixture.componentInstance };
}

const subjects = (el: HTMLElement) =>
  [...el.querySelectorAll('.ticket .subject')].map((b) => b.textContent?.trim());

describe('TicketList uses the signal-based component APIs', () => {
  it('declares every input as a signal input with the same public names', () => {
    const mirror = reflectComponentType(TicketList)!;
    expect(mirror.selector).toBe('app-ticket-list');
    const inputs = Object.fromEntries(mirror.inputs.map((i) => [i.templateName, i]));
    for (const name of ['tickets', 'statusFilter', 'compact', 'autofocus', 'selectedId']) {
      expect(inputs[name], `input ${name}`).toBeDefined();
      expect(inputs[name].isSignal, `input ${name} should be a signal input`).toBe(true);
    }
    const outputs = mirror.outputs.map((o) => o.templateName).sort();
    expect(outputs).toEqual(['archive', 'selectedIdChange']);
  });

  it('uses a model for selectedId, output() for archive and no ngOnChanges', async () => {
    const { host } = await setup();
    const list = host.list() as unknown as Record<string, unknown>;
    const selected = list['selectedId'] as { set?: unknown };
    expect(isSignal(selected)).toBe(true);
    expect(typeof selected.set).toBe('function');
    expect(list['archive']).not.toBeInstanceOf(EventEmitter);
    expect(typeof (list['archive'] as { emit?: unknown }).emit).toBe('function');
    expect((TicketList.prototype as unknown as Record<string, unknown>)['ngOnChanges']).toBeUndefined();
  });
});

describe('TicketList behaviour is unchanged', () => {
  it('filters by the statusFilter alias and counts open tickets', async () => {
    const { fixture, el, host } = await setup();
    expect(subjects(el)).toHaveLength(4);
    expect(el.querySelector('.open-count')?.textContent).toContain('2 open');
    host.filter.set('open');
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Login loop on Safari', 'Webhook retries forever']);
    host.filter.set('pending');
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Export to CSV fails']);
  });

  it('searches subject and requester, and shows the empty state', async () => {
    const { fixture, el } = await setup();
    const box = el.querySelector('input.search') as HTMLInputElement;
    box.value = 'maya';
    box.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Login loop on Safari', 'Wrong VAT on invoice']);
    box.value = 'csv';
    box.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Export to CSV fails']);
    box.value = 'nothing like this';
    box.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(subjects(el)).toEqual([]);
    expect(el.querySelector('.empty')?.textContent).toContain('No tickets match.');
  });

  it('recomputes when the tickets input changes, keeping the search', async () => {
    const { fixture, el, host } = await setup();
    const box = el.querySelector('input.search') as HTMLInputElement;
    box.value = 'webhook';
    box.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Webhook retries forever']);
    host.tickets.set([
      ...clone(base),
      { id: 'T-5', subject: 'Webhook signature mismatch', requester: 'Sam Ito', status: 'open', updatedAt: '2026-10-05T12:00:00Z' },
    ]);
    await fixture.whenStable();
    expect(subjects(el)).toEqual(['Webhook retries forever', 'Webhook signature mismatch']);
    expect(el.querySelector('.open-count')?.textContent).toContain('3 open');
  });

  it('keeps [(selectedId)] two-way binding working in both directions', async () => {
    const { fixture, el, host } = await setup();
    (el.querySelectorAll('.ticket .subject')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.selectedId()).toBe('T-3');
    expect((el.querySelector('.ticket.selected') as HTMLElement).dataset['id']).toBe('T-3');

    (el.querySelectorAll('.ticket .subject')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.selectedId()).toBeNull();
    expect(el.querySelector('.ticket.selected')).toBeNull();

    host.selectedId.set('T-4');
    await fixture.whenStable();
    expect((el.querySelector('.ticket.selected') as HTMLElement).dataset['id']).toBe('T-4');

    (el.querySelectorAll('.ticket .subject')[0] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.selectedId()).toBe('T-1');
  });

  it('emits archive with the ticket', async () => {
    const { fixture, el, host } = await setup();
    const buttons = el.querySelectorAll('.ticket .archive');
    expect(buttons).toHaveLength(1);
    (buttons[0] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.archived.map((t) => t.id)).toEqual(['T-3']);
  });

  it('tracks rows by ticket id across refreshes', async () => {
    const { fixture, el, host } = await setup();
    const before = new Map(
      [...el.querySelectorAll<HTMLElement>('.ticket')].map((li) => [li.dataset['id'], li]),
    );
    host.tickets.set([
      { id: 'T-0', subject: 'Brand new ticket', requester: 'Ana Ruiz', status: 'open', updatedAt: '2026-10-06T08:00:00Z' },
      ...clone(base),
    ]);
    await fixture.whenStable();
    expect(subjects(el)[0]).toBe('Brand new ticket');
    for (const id of ['T-1', 'T-2', 'T-3', 'T-4']) {
      expect(el.querySelector(`.ticket[data-id="${id}"]`), `row ${id} should be reused`).toBe(before.get(id));
    }
  });

  it('focusSearch() stays public and focuses the search box', async () => {
    const { fixture, el } = await setup();
    const box = el.querySelector('input.search') as HTMLInputElement;
    document.body.appendChild(el);
    expect(document.activeElement).not.toBe(box);
    (el.querySelector('button.focus') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(box);
    el.remove();
  });

  it('accepts bare compact/autofocus attributes and a static statusFilter', async () => {
    const fixture = TestBed.createComponent(AttributeHost);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(subjects(el)).toEqual(['Login loop on Safari', 'Webhook retries forever']);
    expect(el.querySelector('.requester')).toBeNull();
    expect(el.querySelector('.updated')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('input.search'));
    fixture.nativeElement.remove();
  });

  it('shows requester and date when not compact', async () => {
    const { el } = await setup();
    expect(el.querySelector('.ticket .requester')?.textContent).toContain('Maya Chen');
    expect(el.querySelector('.ticket .updated')?.textContent).toContain('Oct 1, 08:00');
  });
});

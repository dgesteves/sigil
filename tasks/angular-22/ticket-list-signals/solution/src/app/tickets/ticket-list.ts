import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  Component,
  computed,
  ElementRef,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Ticket, TicketStatus } from './ticket';

@Component({
  selector: 'app-ticket-list',
  imports: [DatePipe],
  templateUrl: './ticket-list.html',
  styleUrl: './ticket-list.css',
})
export class TicketList {
  readonly tickets = input.required<Ticket[]>();
  readonly status = input<TicketStatus | 'all'>('all', { alias: 'statusFilter' });
  readonly compact = input(false, { transform: booleanAttribute });
  readonly autofocus = input(false, { transform: booleanAttribute });
  /** `[(selectedId)]`: the model creates the selectedIdChange output. */
  readonly selectedId = model<string | null>(null);
  readonly archive = output<Ticket>();

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly query = signal('');

  protected readonly visible = computed(() => {
    const status = this.status();
    const q = this.query().trim().toLowerCase();
    return this.tickets().filter(
      (t) =>
        (status === 'all' || t.status === status) &&
        (!q || t.subject.toLowerCase().includes(q) || t.requester.toLowerCase().includes(q)),
    );
  });

  protected readonly openCount = computed(
    () => this.tickets().filter((t) => t.status === 'open').length,
  );

  constructor() {
    afterNextRender(() => {
      if (this.autofocus()) {
        this.focusSearch();
      }
    });
  }

  /** Clicking the selected ticket again clears the selection. */
  select(ticket: Ticket): void {
    this.selectedId.update((current) => (current === ticket.id ? null : ticket.id));
  }

  /** Public: the inbox page's Search button calls it through a template reference. */
  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }
}

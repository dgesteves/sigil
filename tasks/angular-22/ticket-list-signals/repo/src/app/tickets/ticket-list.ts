import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import {
  AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Ticket, TicketStatus } from './ticket';

@Component({
  selector: 'app-ticket-list',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe],
  templateUrl: './ticket-list.html',
  styleUrl: './ticket-list.css',
  // Added by `ng update` (v22 migration) to keep the pre-v22 behaviour.
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class TicketList implements OnChanges, AfterViewInit {
  @Input({ required: true }) tickets: Ticket[] = [];
  @Input('statusFilter') status: TicketStatus | 'all' = 'all';
  @Input({ transform: booleanAttribute }) compact = false;
  @Input({ transform: booleanAttribute }) autofocus = false;
  @Input() selectedId: string | null = null;
  @Output() selectedIdChange = new EventEmitter<string | null>();
  @Output() archive = new EventEmitter<Ticket>();

  @ViewChild('search') searchInput?: ElementRef<HTMLInputElement>;

  query = '';
  visible: Ticket[] = [];
  openCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tickets'] || changes['status']) {
      this.refresh();
    }
  }

  ngAfterViewInit(): void {
    if (this.autofocus) {
      this.focusSearch();
    }
  }

  onSearch(value: string): void {
    this.query = value;
    this.refresh();
  }

  /** Clicking the selected ticket again clears the selection. */
  select(ticket: Ticket): void {
    const next = this.selectedId === ticket.id ? null : ticket.id;
    this.selectedId = next;
    this.selectedIdChange.emit(next);
  }

  /** Public: the inbox page's Search button calls it through a template reference. */
  focusSearch(): void {
    this.searchInput?.nativeElement.focus();
  }

  trackById(_index: number, ticket: Ticket): string {
    return ticket.id;
  }

  private refresh(): void {
    const q = this.query.trim().toLowerCase();
    this.visible = this.tickets.filter(
      (t) =>
        (this.status === 'all' || t.status === this.status) &&
        (!q || t.subject.toLowerCase().includes(q) || t.requester.toLowerCase().includes(q)),
    );
    this.openCount = this.tickets.filter((t) => t.status === 'open').length;
  }
}

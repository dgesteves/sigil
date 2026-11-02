import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DispatchOrder, FeedConnection, OrderFeed } from '../feed/order-feed';
import { OrderCounter } from './order-counter';

type ConnectionState = 'connecting' | 'live' | 'offline';

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline',
};

@Component({
  selector: 'app-dispatch-board',
  imports: [DatePipe, OrderCounter],
  template: `
    <header>
      <span class="connection" [class.live]="connection() === 'live'">{{ label() }}</span>
      <app-order-counter [orders]="orders()" />
      <button type="button" class="reconnect" [disabled]="connection() === 'connecting'" (click)="reconnect()">
        Reconnect
      </button>
    </header>

    @if (lastOrderAt(); as at) {
      <p class="last-order">Last order at {{ at | date: 'HH:mm:ss' : 'UTC' }}</p>
    }

    <ol class="orders">
      @for (order of orders(); track order.id) {
        <li class="order" [class.urgent]="order.priority === 'urgent'">{{ order.id }} · {{ order.customer }}</li>
      } @empty {
        <li class="empty">Waiting for orders…</li>
      }
    </ol>
  `,
})
export class DispatchBoard implements OnInit, OnDestroy {
  private readonly feed = inject(OrderFeed);
  private connectionRef?: FeedConnection;

  // Zoneless: the view refreshes when a signal it reads changes, whoever calls set().
  readonly connection = signal<ConnectionState>('connecting');
  /** Newest first. Always replaced, never mutated, so OnPush children see a new reference. */
  readonly orders = signal<readonly DispatchOrder[]>([]);
  readonly lastOrderAt = signal<string | null>(null);
  readonly label = computed(() => LABELS[this.connection()]);

  ngOnInit(): void {
    this.connectionRef = this.feed.connect({
      open: () => this.connection.set('live'),
      order: (order) => {
        this.orders.update((orders) => [order, ...orders]);
        this.lastOrderAt.set(order.placedAt);
      },
      closed: () => this.connection.set('offline'),
    });
  }

  async reconnect(): Promise<void> {
    this.connection.set('connecting');
    await this.feed.reconnect();
    this.connection.set('live');
  }

  ngOnDestroy(): void {
    this.connectionRef?.close();
  }
}

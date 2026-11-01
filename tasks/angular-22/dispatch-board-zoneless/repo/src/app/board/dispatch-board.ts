import { DatePipe } from '@angular/common';
import { Component, inject, NgZone, OnDestroy, OnInit } from '@angular/core';
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
      <span class="connection" [class.live]="connection === 'live'">{{ label() }}</span>
      <app-order-counter [orders]="orders" />
      <button type="button" class="reconnect" [disabled]="connection === 'connecting'" (click)="reconnect()">
        Reconnect
      </button>
    </header>

    @if (lastOrderAt) {
      <p class="last-order">Last order at {{ lastOrderAt | date: 'HH:mm:ss' : 'UTC' }}</p>
    }

    <ol class="orders">
      @for (order of orders; track order.id) {
        <li class="order" [class.urgent]="order.priority === 'urgent'">{{ order.id }} · {{ order.customer }}</li>
      } @empty {
        <li class="empty">Waiting for orders…</li>
      }
    </ol>
  `,
})
export class DispatchBoard implements OnInit, OnDestroy {
  private readonly feed = inject(OrderFeed);
  private readonly zone = inject(NgZone);
  private connectionRef?: FeedConnection;

  connection: ConnectionState = 'connecting';
  /** Newest first. */
  orders: DispatchOrder[] = [];
  lastOrderAt: string | null = null;

  label(): string {
    return LABELS[this.connection];
  }

  ngOnInit(): void {
    // The socket callbacks fire outside Angular, so re-enter the zone to update the view.
    this.zone.runOutsideAngular(() => {
      this.connectionRef = this.feed.connect({
        open: () => this.zone.run(() => (this.connection = 'live')),
        order: (order) =>
          this.zone.run(() => {
            this.orders.unshift(order);
            this.lastOrderAt = order.placedAt;
          }),
        closed: () => this.zone.run(() => (this.connection = 'offline')),
      });
    });
  }

  async reconnect(): Promise<void> {
    this.connection = 'connecting';
    await this.feed.reconnect();
    this.connection = 'live';
  }

  ngOnDestroy(): void {
    this.connectionRef?.close();
  }
}

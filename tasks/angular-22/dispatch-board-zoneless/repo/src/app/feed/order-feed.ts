import { Injectable } from '@angular/core';

export interface DispatchOrder {
  id: string;
  customer: string;
  priority: 'normal' | 'urgent';
  /** ISO 8601 timestamp. */
  placedAt: string;
}

export interface FeedHandlers {
  open(): void;
  order(order: DispatchOrder): void;
  closed(reason: string): void;
}

export interface FeedConnection {
  close(): void;
}

/**
 * Thin wrapper around the dispatch WebSocket. Handlers are called straight from the socket's
 * event callbacks.
 */
@Injectable({ providedIn: 'root' })
export class OrderFeed {
  private readonly url = '/dispatch/feed';
  private socket: WebSocket | null = null;
  private handlers: FeedHandlers | null = null;

  connect(handlers: FeedHandlers): FeedConnection {
    this.handlers = handlers;
    this.open();
    return { close: () => this.socket?.close() };
  }

  /** Re-opens the socket and resolves once the server has replayed the orders we missed. */
  reconnect(): Promise<void> {
    this.socket?.close();
    return new Promise((resolve) => {
      this.open();
      this.socket?.addEventListener('message', function onReplay(event) {
        if (JSON.parse(event.data).type === 'replay-complete') {
          this.removeEventListener('message', onReplay);
          resolve();
        }
      });
    });
  }

  private open(): void {
    const socket = new WebSocket(new URL(this.url, location.href).href.replace(/^http/, 'ws'));
    this.socket = socket;
    socket.addEventListener('open', () => this.handlers?.open());
    socket.addEventListener('close', (event) => this.handlers?.closed(event.reason || 'closed'));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'order') this.handlers?.order(message.order as DispatchOrder);
    });
  }
}

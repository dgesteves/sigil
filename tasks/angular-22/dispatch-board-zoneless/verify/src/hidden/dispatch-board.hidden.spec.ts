import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DispatchOrder, FeedConnection, FeedHandlers, OrderFeed } from '../app/feed/order-feed';
import { DispatchBoard } from '../app/board/dispatch-board';
import { OrderCounter } from '../app/board/order-counter';

/** Stands in for the WebSocket: the test fires the callbacks, outside any Angular event. */
class FakeFeed {
  handlers: FeedHandlers | null = null;
  connects = 0;
  closes = 0;
  private finishReplay: (() => void) | null = null;
  connect(handlers: FeedHandlers): FeedConnection {
    this.connects++;
    this.handlers = handlers;
    return { close: () => void this.closes++ };
  }
  reconnect(): Promise<void> {
    return new Promise((resolve) => (this.finishReplay = resolve));
  }
  async replayComplete(): Promise<void> {
    this.finishReplay?.();
    await Promise.resolve();
  }
}

const order = (id: string, priority: DispatchOrder['priority'] = 'normal', customer = 'Acme Ltd'): DispatchOrder => ({
  id,
  customer,
  priority,
  placedAt: `2026-11-01T10:${id.slice(-2)}:00Z`,
});

async function setup() {
  const feed = new FakeFeed();
  TestBed.configureTestingModule({ providers: [{ provide: OrderFeed, useValue: feed }] });
  const fixture = TestBed.createComponent(DispatchBoard);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el.querySelector(selector)?.textContent?.trim() ?? null;
  const ids = () => [...el.querySelectorAll('.order')].map((li) => li.textContent?.trim().split(' ')[0]);
  return { feed, fixture, el, text, ids };
}

describe('DispatchBoard updates without zone.js', () => {
  it('runs without zone.js', () => {
    expect((globalThis as { Zone?: unknown }).Zone).toBeUndefined();
  });

  it('connects once and shows Live when the feed opens', async () => {
    const { feed, fixture, text } = await setup();
    expect(feed.connects).toBe(1);
    expect(text('.connection')).toBe('Connecting…');
    feed.handlers!.open();
    await fixture.whenStable();
    expect(text('.connection')).toBe('Live');
  });

  it('shows orders from the feed as they arrive, newest first', async () => {
    const { feed, fixture, text, ids } = await setup();
    feed.handlers!.open();
    feed.handlers!.order(order('ORD-01'));
    await fixture.whenStable();
    expect(ids()).toEqual(['ORD-01']);
    expect(text('.empty')).toBeNull();
    expect(text('.last-order')).toContain('10:01:00');

    feed.handlers!.order(order('ORD-02', 'urgent', 'Globex'));
    await fixture.whenStable();
    expect(ids()).toEqual(['ORD-02', 'ORD-01']);
    expect(text('.last-order')).toContain('10:02:00');
    expect(fixture.nativeElement.querySelector('.order.urgent')?.textContent).toContain('Globex');
  });

  it('keeps the header counter in sync with the queue', async () => {
    const { feed, fixture, text } = await setup();
    feed.handlers!.open();
    await fixture.whenStable();
    expect(text('.count')).toBe('0 in queue');
    expect(text('.urgent-count')).toBeNull();

    feed.handlers!.order(order('ORD-11'));
    await fixture.whenStable();
    expect(text('.count')).toBe('1 in queue');
    expect(text('.urgent-count')).toBeNull();

    feed.handlers!.order(order('ORD-12', 'urgent'));
    feed.handlers!.order(order('ORD-13', 'urgent'));
    await fixture.whenStable();
    expect(text('.count')).toBe('3 in queue');
    expect(text('.urgent-count')).toBe('2 urgent');
  });

  it('goes offline when the feed closes and back to Live after a reconnect', async () => {
    const { feed, fixture, el, text } = await setup();
    feed.handlers!.open();
    feed.handlers!.closed('server restart');
    await fixture.whenStable();
    expect(text('.connection')).toBe('Offline');
    const button = el.querySelector('button.reconnect') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    button.click();
    await fixture.whenStable();
    expect(text('.connection')).toBe('Connecting…');
    expect(button.disabled).toBe(true);

    await feed.replayComplete();
    await fixture.whenStable();
    expect(text('.connection')).toBe('Live');
    expect(button.disabled).toBe(false);
  });

  it('still shows orders that arrive while reconnecting', async () => {
    const { feed, fixture, el, ids, text } = await setup();
    feed.handlers!.open();
    feed.handlers!.closed('network');
    await fixture.whenStable();
    (el.querySelector('button.reconnect') as HTMLButtonElement).click();
    await fixture.whenStable();
    feed.handlers!.order(order('ORD-21'));
    await fixture.whenStable();
    expect(ids()).toEqual(['ORD-21']);
    expect(text('.count')).toBe('1 in queue');
    await feed.replayComplete();
    await fixture.whenStable();
    expect(text('.connection')).toBe('Live');
  });

  it('closes the feed connection when destroyed', async () => {
    const { feed, fixture } = await setup();
    fixture.destroy();
    expect(feed.closes).toBe(1);
  });
});

@Component({
  imports: [OrderCounter],
  template: '<app-order-counter [orders]="orders()" />',
})
class CounterHost {
  orders = signal<DispatchOrder[]>([]);
}

describe('OrderCounter', () => {
  it('reflects the orders it is given', async () => {
    const fixture = TestBed.createComponent(CounterHost);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('0 in queue');
    fixture.componentInstance.orders.set([order('ORD-31', 'urgent'), order('ORD-32')]);
    await fixture.whenStable();
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 in queue');
    expect(el.querySelector('.urgent-count')?.textContent?.trim()).toBe('1 urgent');
  });
});

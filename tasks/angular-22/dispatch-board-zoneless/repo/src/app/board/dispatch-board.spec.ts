import { TestBed } from '@angular/core/testing';
import { FeedConnection, FeedHandlers, OrderFeed } from '../feed/order-feed';
import { DispatchBoard } from './dispatch-board';

class IdleFeed {
  handlers: FeedHandlers | null = null;
  connect(handlers: FeedHandlers): FeedConnection {
    this.handlers = handlers;
    return { close: () => undefined };
  }
  reconnect(): Promise<void> {
    return new Promise(() => undefined);
  }
}

describe('DispatchBoard', () => {
  it('starts in the connecting state with an empty queue', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: OrderFeed, useClass: IdleFeed }] });
    const fixture = TestBed.createComponent(DispatchBoard);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.connection')?.textContent).toContain('Connecting…');
    expect(el.querySelector('.count')?.textContent).toContain('0 in queue');
    expect(el.querySelector('.empty')?.textContent).toContain('Waiting for orders…');
    expect((el.querySelector('button.reconnect') as HTMLButtonElement).disabled).toBe(true);
  });
});

import { Component, computed, input } from '@angular/core';
import { DispatchOrder } from '../feed/order-feed';

@Component({
  selector: 'app-order-counter',
  template: `
    <span class="count">{{ orders().length }} in queue</span>
    @if (urgentCount() > 0) {
      <span class="urgent-count">{{ urgentCount() }} urgent</span>
    }
  `,
})
export class OrderCounter {
  readonly orders = input<readonly DispatchOrder[]>([]);
  readonly urgentCount = computed(() => this.orders().filter((o) => o.priority === 'urgent').length);
}

import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ProductApi, SortOrder } from './product-api';

@Component({
  selector: 'app-product-search',
  imports: [CurrencyPipe],
  template: `
    <div class="toolbar">
      <form class="search" (submit)="onSubmit($event, box.value)">
        <input #box type="search" name="q" aria-label="Search products" [value]="term()" />
        <button type="submit">Search</button>
      </form>
      <label>
        Sort
        <select #sortSelect class="sort" [value]="sort()" (change)="onSort(sortSelect.value)">
          <option value="relevance">Best match</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </label>
      @if (results(); as r) {
        <span class="count">{{ r.total }} results</span>
      }
    </div>

    @if (!term()) {
      <p class="hint">Type a product name to search.</p>
    } @else if (search.isLoading()) {
      <p class="loading">Loading…</p>
    } @else if (search.error()) {
      <p class="error">Couldn't load products.</p>
      <button type="button" class="retry" (click)="search.reload()">Retry</button>
    } @else if (results(); as r) {
      @if (r.items.length === 0) {
        <p class="empty">No products match "{{ term() }}".</p>
      } @else {
        <ul class="results">
          @for (product of r.items; track product.id) {
            <li class="product">
              <span class="name">{{ product.name }}</span>
              <span class="price">{{ product.priceCents / 100 | currency: 'EUR' }}</span>
            </li>
          }
        </ul>
        <nav class="pager">
          <button type="button" class="prev" [disabled]="page() === 1" (click)="page.set(page() - 1)">Previous</button>
          <span class="page">Page {{ page() }} of {{ r.pageCount }}</span>
          <button type="button" class="next" [disabled]="page() >= r.pageCount" (click)="page.set(page() + 1)">
            Next
          </button>
        </nav>
      }
    }
  `,
})
export class ProductSearch {
  private readonly api = inject(ProductApi);

  readonly term = signal('');
  readonly sort = signal<SortOrder>('relevance');
  /** Resets to page 1 whenever the term or the sort changes; Previous/Next set it directly. */
  readonly page = linkedSignal({
    source: () => [this.term(), this.sort()] as const,
    computation: () => 1,
  });

  /**
   * Re-runs whenever the params change and unsubscribes from the outdated request, which cancels
   * it. An undefined params value (empty term) keeps the resource idle: no request.
   */
  readonly search = rxResource({
    params: () => {
      const q = this.term();
      return q ? { q, page: this.page(), sort: this.sort() } : undefined;
    },
    stream: ({ params }) => this.api.search(params),
  });

  /** `value()` throws while the resource is in the error state, so read it behind hasValue(). */
  readonly results = computed(() => (this.search.hasValue() ? this.search.value() : null));

  onSubmit(event: Event, value: string): void {
    event.preventDefault();
    this.term.set(value.trim());
  }

  onSort(sort: string): void {
    this.sort.set(sort as SortOrder);
  }
}

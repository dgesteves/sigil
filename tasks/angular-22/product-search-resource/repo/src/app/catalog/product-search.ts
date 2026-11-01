import { CurrencyPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ProductApi, ProductPage, SortOrder } from './product-api';

@Component({
  selector: 'app-product-search',
  imports: [CurrencyPipe],
  template: `
    <div class="toolbar">
      <form class="search" (submit)="onSubmit($event, box.value)">
        <input #box type="search" name="q" aria-label="Search products" [value]="term" />
        <button type="submit">Search</button>
      </form>
      <label>
        Sort
        <select #sortSelect class="sort" [value]="sort" (change)="onSort(sortSelect.value)">
          <option value="relevance">Best match</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </label>
      @if (results) {
        <span class="count">{{ results.total }} results</span>
      }
    </div>

    @if (!term) {
      <p class="hint">Type a product name to search.</p>
    } @else if (loading) {
      <p class="loading">Loading…</p>
    } @else if (error) {
      <p class="error">Couldn't load products.</p>
      <button type="button" class="retry" (click)="load()">Retry</button>
    } @else if (results) {
      @if (results.items.length === 0) {
        <p class="empty">No products match "{{ term }}".</p>
      } @else {
        <ul class="results">
          @for (product of results.items; track product.id) {
            <li class="product">
              <span class="name">{{ product.name }}</span>
              <span class="price">{{ product.priceCents / 100 | currency: 'EUR' }}</span>
            </li>
          }
        </ul>
        <nav class="pager">
          <button type="button" class="prev" [disabled]="page === 1" (click)="goTo(page - 1)">Previous</button>
          <span class="page">Page {{ page }} of {{ results.pageCount }}</span>
          <button type="button" class="next" [disabled]="page >= results.pageCount" (click)="goTo(page + 1)">
            Next
          </button>
        </nav>
      }
    }
  `,
})
export class ProductSearch {
  private readonly api = inject(ProductApi);

  term = '';
  sort: SortOrder = 'relevance';
  page = 1;

  loading = false;
  error = false;
  results: ProductPage | null = null;

  onSubmit(event: Event, value: string): void {
    event.preventDefault();
    this.term = value.trim();
    this.page = 1;
    this.load();
  }

  onSort(sort: string): void {
    this.sort = sort as SortOrder;
    this.page = 1;
    this.load();
  }

  goTo(page: number): void {
    this.page = page;
    this.load();
  }

  load(): void {
    if (!this.term) return;
    this.loading = true;
    this.error = false;
    this.api.search({ q: this.term, page: this.page, sort: this.sort }).subscribe({
      next: (results) => {
        this.results = results;
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      },
    });
  }
}

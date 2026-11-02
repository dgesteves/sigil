import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type SortOrder = 'relevance' | 'price-asc' | 'price-desc';

export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageCount: number;
}

export interface ProductQuery {
  q: string;
  page: number;
  sort: SortOrder;
}

@Injectable({ providedIn: 'root' })
export class ProductApi {
  private readonly http = inject(HttpClient);

  /** GET /api/products?q=…&page=…&sort=… */
  search(query: ProductQuery): Observable<ProductPage> {
    return this.http.get<ProductPage>('/api/products', {
      params: { q: query.q, page: query.page, sort: query.sort },
    });
  }
}

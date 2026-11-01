import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthSession } from '../auth/auth-session';
import { authInterceptor } from '../auth/auth.interceptor';
import { ProductApi, ProductPage } from './product-api';

describe('ProductApi', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
  });

  it('sends the query, page and sort with the session token', () => {
    TestBed.inject(AuthSession).token.set('tok-123');
    const page: ProductPage = { items: [], total: 0, page: 2, pageCount: 0 };
    let received: ProductPage | undefined;
    TestBed.inject(ProductApi)
      .search({ q: 'desk lamp', page: 2, sort: 'price-asc' })
      .subscribe((r) => (received = r));

    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/products');
    expect(req.request.params.get('q')).toBe('desk lamp');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('sort')).toBe('price-asc');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-123');
    req.flush(page);
    expect(received).toEqual(page);
  });
});

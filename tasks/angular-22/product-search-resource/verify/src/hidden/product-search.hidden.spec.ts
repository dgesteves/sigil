import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthSession } from '../app/auth/auth-session';
import { authInterceptor } from '../app/auth/auth.interceptor';
import { ProductPage } from '../app/catalog/product-api';
import { ProductSearch } from '../app/catalog/product-search';

const pageOf = (prefix: string, page: number, pageCount = 3, total = 42): ProductPage => ({
  items: [1, 2, 3].map((n) => ({ id: `${prefix}-${page}-${n}`, name: `${prefix} ${page}.${n}`, priceCents: 1000 * n + page })),
  total,
  page,
  pageCount,
});

let fixture: ComponentFixture<ProductSearch>;
let el: HTMLElement;
let http: HttpTestingController;

beforeEach(async () => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
  });
  TestBed.inject(AuthSession).token.set('tok-9');
  fixture = TestBed.createComponent(ProductSearch);
  el = fixture.nativeElement as HTMLElement;
  http = TestBed.inject(HttpTestingController);
  await fixture.whenStable();
});

afterEach(() => {
  http.verify();
});

const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const names = () => [...el.querySelectorAll('.product .name')].map((n) => n.textContent?.trim());

/** User actions; TestBed.tick() runs change detection and effects so requests go out now. */
function submit(term: string): void {
  (el.querySelector('input[type="search"]') as HTMLInputElement).value = term;
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  TestBed.tick();
}
function sortBy(value: string): void {
  const select = el.querySelector('select.sort') as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change'));
  TestBed.tick();
}
function click(selector: string): void {
  (el.querySelector(selector) as HTMLButtonElement).click();
  TestBed.tick();
}

function expectSearch(q: string, page: number, sort: string): TestRequest {
  const req = http.expectOne((r) => r.url === '/api/products', `GET /api/products q=${q} page=${page} sort=${sort}`);
  expect({
    method: req.request.method,
    q: req.request.params.get('q'),
    page: req.request.params.get('page'),
    sort: req.request.params.get('sort'),
  }).toEqual({ method: 'GET', q, page: String(page), sort });
  return req;
}
const noSearch = () => http.expectNone((r) => r.url === '/api/products');

describe('ProductSearch', () => {
  it('makes no request until a non-empty term is submitted', async () => {
    expect(text('.hint')).toBe('Type a product name to search.');
    noSearch();
    submit('   ');
    await fixture.whenStable();
    expect(text('.hint')).toBe('Type a product name to search.');
    noSearch();
  });

  it('loads page 1 through HttpClient, with the session token', async () => {
    submit('lamp');
    expect(text('.loading')).toBe('Loading…');
    const req = expectSearch('lamp', 1, 'relevance');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-9');
    req.flush(pageOf('Lamp', 1));
    await fixture.whenStable();
    expect(text('.loading')).toBeNull();
    expect(names()).toEqual(['Lamp 1.1', 'Lamp 1.2', 'Lamp 1.3']);
    expect(text('.page')).toBe('Page 1 of 3');
    expect(text('.count')).toBe('42 results');
    expect((el.querySelector('.prev') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('.next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('pages with Next/Previous and goes back to page 1 on a new sort or term', async () => {
    submit('lamp');
    expectSearch('lamp', 1, 'relevance').flush(pageOf('Lamp', 1));
    await fixture.whenStable();

    click('.next');
    expectSearch('lamp', 2, 'relevance').flush(pageOf('Lamp', 2));
    await fixture.whenStable();
    expect(text('.page')).toBe('Page 2 of 3');
    expect(names()).toEqual(['Lamp 2.1', 'Lamp 2.2', 'Lamp 2.3']);

    click('.prev');
    expectSearch('lamp', 1, 'relevance').flush(pageOf('Lamp', 1));
    await fixture.whenStable();
    click('.next');
    expectSearch('lamp', 2, 'relevance').flush(pageOf('Lamp', 2));
    await fixture.whenStable();

    sortBy('price-desc');
    expectSearch('lamp', 1, 'price-desc').flush(pageOf('Pricey', 1));
    await fixture.whenStable();
    expect(text('.page')).toBe('Page 1 of 3');

    click('.next');
    expectSearch('lamp', 2, 'price-desc').flush(pageOf('Pricey', 2));
    await fixture.whenStable();

    submit('desk');
    expectSearch('desk', 1, 'price-desc').flush(pageOf('Desk', 1, 1, 3));
    await fixture.whenStable();
    expect(names()).toEqual(['Desk 1.1', 'Desk 1.2', 'Desk 1.3']);
    expect(text('.page')).toBe('Page 1 of 1');
    expect((el.querySelector('.next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels the outdated request when the query changes mid-flight', async () => {
    submit('lamp');
    const first = expectSearch('lamp', 1, 'relevance');
    sortBy('price-asc');
    const second = expectSearch('lamp', 1, 'price-asc');
    expect(first.cancelled).toBe(true);
    second.flush(pageOf('Cheap', 1));
    await fixture.whenStable();
    expect(names()).toEqual(['Cheap 1.1', 'Cheap 1.2', 'Cheap 1.3']);

    click('.next');
    const third = expectSearch('lamp', 2, 'price-asc');
    submit('chair');
    const fourth = expectSearch('chair', 1, 'price-asc');
    expect(third.cancelled).toBe(true);
    fourth.flush(pageOf('Chair', 1));
    await fixture.whenStable();
    expect(names()).toEqual(['Chair 1.1', 'Chair 1.2', 'Chair 1.3']);
    expect(text('.page')).toBe('Page 1 of 3');
  });

  it('shows the error and retries the same request', async () => {
    submit('lamp');
    expectSearch('lamp', 1, 'relevance').flush('upstream timeout', { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();
    expect(text('.error')).toBe("Couldn't load products.");
    expect(el.querySelector('.results')).toBeNull();

    click('.retry');
    expectSearch('lamp', 1, 'relevance').flush(pageOf('Lamp', 1));
    await fixture.whenStable();
    expect(text('.error')).toBeNull();
    expect(names()).toEqual(['Lamp 1.1', 'Lamp 1.2', 'Lamp 1.3']);
  });

  it('survives a failure after results were shown', async () => {
    submit('lamp');
    expectSearch('lamp', 1, 'relevance').flush(pageOf('Lamp', 1));
    await fixture.whenStable();

    click('.next');
    expectSearch('lamp', 2, 'relevance').flush('boom', { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();
    expect(text('.error')).toBe("Couldn't load products.");
    expect(el.querySelector('.retry')).not.toBeNull();

    click('.retry');
    expectSearch('lamp', 2, 'relevance').flush(pageOf('Lamp', 2));
    await fixture.whenStable();
    expect(text('.page')).toBe('Page 2 of 3');
  });

  it('shows the empty state, and the hint again for a blank term', async () => {
    submit('zzz');
    expectSearch('zzz', 1, 'relevance').flush({ items: [], total: 0, page: 1, pageCount: 0 });
    await fixture.whenStable();
    expect(text('.empty')).toBe('No products match "zzz".');

    submit('');
    await fixture.whenStable();
    expect(text('.hint')).toBe('Type a product name to search.');
    noSearch();
  });
});

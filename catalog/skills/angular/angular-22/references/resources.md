# resource, rxResource and httpResource (Angular 22)

All three are stable in 22.0 (`@publicApi 22.0`). `debounced` and `resourceFromSnapshots` are
experimental. Behaviour below was run on `@angular/core@22.2.4`.

## Which one

| Data source | Use |
| --- | --- |
| A URL on your API, through `HttpClient` and its interceptors | `httpResource(() => url \| request \| undefined)` from `@angular/common/http` |
| An existing service method that returns an `Observable` | `rxResource({ params, stream })` from `@angular/core/rxjs-interop` |
| A promise API (`fetch`, IndexedDB, a SDK) | `resource({ params, loader })` from `@angular/core` |
| A value that keeps arriving (WebSocket, SSE, Firestore) | `resource({ stream: () => signal })` or `rxResource({ stream })` |

All must be created in an injection context (field initializer or constructor) or given `injector`.
They are destroyed with that injector.

## Shape

```ts
readonly authorId = input.required<string>();

readonly posts = rxResource({
  params: () => ({ author: this.authorId(), limit: this.limit() }),
  stream: ({ params }) => this.blog.postsBy(params.author, params.limit), // Observable<Post[]>
  defaultValue: [],                                                     // value() is Post[] then
});

readonly profile = httpResource<Profile>(() => `/api/authors/${this.authorId()}`);

readonly draft = resource({
  params: () => this.draftId(),                                         // undefined => idle
  loader: ({ params, abortSignal }) =>
    fetch(`/api/drafts/${params}`, { signal: abortSignal }).then((r) => r.json() as Promise<Draft>),
});
```

`httpResource` accepts a string, an `HttpResourceRequest` (`{ url, method, params, headers, body,
withCredentials, ... }`) or `undefined`, plus options such as `defaultValue`, `parse` (validate the
response, for example with a zod schema) and `equal`. `httpResource.text()`, `.blob()` and
`.arrayBuffer()` pick the response type.

## Status table (measured)

| Status | How you get there | `value()` | `hasValue()` | `isLoading()` |
| --- | --- | --- | --- | --- |
| `idle` | `params` returned `undefined` | `undefined` (or `defaultValue`) | false | false |
| `loading` | params changed | `undefined` (or `defaultValue`) | false | true |
| `resolved` | loader finished | the value | true | false |
| `reloading` | `reload()` | previous value (`undefined` if the previous state was `error`) | as before | true |
| `error` | loader threw or the request failed | **throws `ResourceValueError`** (cause attached) | false | false |
| `local` | `value.set()` / `value.update()` | the value you set | true | false |

The status values are strings. There is no `ResourceStatus` enum to import any more; `ResourceStatus`
is a type.

### Reading value() safely

```ts
// Throws in the error state, and so does every computed or template binding that reads it:
readonly titles = computed(() => this.posts.value().map((p) => p.title)); // ✗

readonly titles = computed(() => (this.posts.hasValue() ? this.posts.value().map((p) => p.title) : [])); // ✓
```

`defaultValue` makes `value()` non-`undefined` in `idle` and `loading`, but it still throws in
`error`. `hasValue()` is a type guard (it removes `undefined`).

Templates: check `error()` (or `hasValue()`) before any `value()` read, including reads in headers,
toolbars and counters outside the main `@if`.

## Cancellation and races

When `params` changes while a load is running, the resource aborts it: `abortSignal` fires for
`resource`, and `rxResource`/`httpResource` unsubscribe, which cancels the `HttpClient` request
(`TestRequest.cancelled === true`). The stale response can never overwrite the new one. Code that
calls `subscribe()` per user action gets none of this unless it adds `switchMap`.

Effects make this worse, not better: an effect that writes a signal the params depend on runs after
the params were read, so the resource first loads with the old value. Two requests go out in the
same tick. Derive the dependent value with `linkedSignal` or set both signals in the event handler.

## Recipe: paged list that resets on filter changes

```ts
readonly status = signal<'open' | 'closed'>('open');
readonly label = signal('');
readonly offset = linkedSignal({
  source: () => [this.status(), this.label()] as const,
  computation: () => 0, // any filter change goes back to the first page
});

readonly issues = httpResource<IssuePage>(() => ({
  url: '/api/issues',
  params: { status: this.status(), label: this.label(), offset: this.offset() },
}));

nextPage() {
  this.offset.update((o) => o + 50);
}
```

One request per user action, the previous one cancelled, page reset without a second request.

## Recipe: optimistic local edit

```ts
rename(id: string, title: string) {
  const before = this.posts.value();
  this.posts.update((list) => list.map((p) => (p.id === id ? { ...p, title } : p))); // status: 'local'
  this.blog.rename(id, title).subscribe({ error: () => this.posts.set(before) });
}
```

A later params change or `reload()` replaces the local value with server data.

## Recipe: search as you type

```ts
readonly query = signal('');
readonly settled = debounced(this.query, 300); // experimental in 22
readonly hits = httpResource<Hit[]>(() => {
  const q = this.settled.value().trim();
  return q ? { url: '/api/hits', params: { q } } : undefined;
});
```

`debounced` starts `resolved` with the source's current value, goes to `loading` (keeping the last
settled value) once a change is seen, and resolves when the timer ends. The stable alternative is
RxJS: `toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' })`
feeding the resource's params.

## Chaining

`params` (and the request function of `httpResource`) receives a context with `chain`. It returns
the other resource's value when that one is `resolved` or `local`; otherwise the current resource
mirrors its `idle`/`loading`/`error` state and the function stops there.

```ts
readonly author = httpResource<Author>(() => `/api/authors/${this.authorId()}`);

readonly team = httpResource<Team>(({ chain }) => {
  const author = chain(this.author); // Author | undefined (no defaultValue)
  return author ? `/api/teams/${author.teamId}` : undefined;
});

readonly badges = resource({
  params: ({ chain }) => chain(this.author)?.id, // undefined => idle
  loader: ({ params }) => this.badgeStore.forAuthor(params),
});
```

Return the chained value itself (or `undefined`), not `{ id: undefined }`, or the loader runs with
an undefined id. Use `computed` instead when the second value is a synchronous derivation of the
first.

## SSR caching

Give a resource an `id` (`resource({ ..., id: 'author-profile' })`) to serialize its server result
into `TransferState` and start resolved on the client. Never do this for per-user data in HTML that
a CDN may cache.

## Testing resources

See [change-detection.md](change-detection.md#testing): trigger, `TestBed.tick()`, `expectOne`,
`flush`, then `await fixture.whenStable()`. Waiting for stability before flushing hangs, because
the pending request keeps the app unstable.

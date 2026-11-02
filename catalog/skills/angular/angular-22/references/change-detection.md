# Change detection, zoneless and testing (Angular 22)

Everything here was run with `@angular/core@22.2.4`, `@angular/build@22.2.5` and Vitest 5.0.5 in jsdom.

## The model in one paragraph

Angular 21+ applications have no zone.js. Change detection is scheduled by notifications: a signal
read by a template changes, a template or host listener runs, `markForCheck()` is called, or
`ComponentRef.setInput()` sets an input. Since v22 a component without `changeDetection` is
`OnPush`: during a pass it is checked only if it was marked dirty (by one of those notifications) or
received an input whose value is not `Object.is`-equal to the previous one. `ChangeDetectionStrategy.Eager`
(the old `Default`, still an alias, deprecated) checks the component on every pass that reaches it.

## Measured behaviour

Each row is a component on 22.2.4 with no `changeDetection` setting, in a zoneless TestBed, after
`await fixture.whenStable()`:

| Code | Screen |
| --- | --- |
| `setTimeout(() => this.status = 'done')` | old value |
| `setTimeout(() => zone.run(() => this.status = 'done'))` | old value |
| `setTimeout(() => { this.status = 'done'; cdr.markForCheck() })` | updated |
| `setTimeout(() => this.status.set('done'))` with `status = signal(...)` | updated |
| `async onClick() { this.x = 1; await p; this.x = 2 }` | shows 1 (the listener marked the view before the `await`) |
| parent `(click)` pushes into an array bound to a child `@Input()` | child stale |
| same, child marked `ChangeDetectionStrategy.Eager` | child updated |
| `items.update(a => { a.push(x); return a })` | nothing reading `items` refreshes |
| `provideZoneChangeDetection()` without zone.js loaded | NG0908 at bootstrap |

## Converting zone-era components

1. Find state the template reads that changes outside a template event: subscriptions, timers,
   promises (`await`), WebSocket/EventSource/BroadcastChannel callbacks, third-party library
   callbacks, `ResizeObserver`, `postMessage`.
2. Turn that state into signals. Derive the rest with `computed`. Replace arrays and objects instead
   of mutating them.
3. Delete `NgZone.run`/`runOutsideAngular` wrappers that only existed to trigger change detection.
   (`runOutsideAngular` is harmless in zoneless apps and still useful in libraries that must also
   support zone apps.)
4. Replace `NgZone.onStable`/`onMicrotaskEmpty` waits with `afterNextRender(() => ...)` (once) or
   `afterEveryRender` (every pass). Use `afterRenderEffect` for DOM work that depends on signals.
5. Observables in templates: `async` pipe (calls `markForCheck`) or `toSignal`.
6. Reactive forms: `setValue`/`patchValue` do not schedule change detection. Read form state in the
   template through signals, or call `markForCheck`. New forms can use signal forms
   (`@angular/forms/signals`, stable in 22).
7. Remove `ChangeDetectionStrategy.Eager` markers once the component is reactive. Keep `Eager` only
   for components that create user-supplied components dynamically (`ViewContainerRef.createComponent`)
   whose change detection you don't control.
8. SSR: work the server must wait for goes through `PendingTasks` (`inject(PendingTasks).run(async () => ...)`)
   or the `pendingUntilEvent()` RxJS operator; HttpClient and router navigations already register.

## When markForCheck is still the right tool

Library code you can't convert, `@Input()` setters, or interop with an Observable you don't want to
wrap. `markForCheck()` marks the component and its ancestors; it does not make OnPush children with
unchanged input references refresh. `detectChanges()` runs synchronously and also skips such
children. Neither fixes in-place mutation.

## Testing

### Runner

- `ng test` uses `@angular/build:unit-test` with Vitest and jsdom by default; `--watch=false` in CI,
  `--include path` to filter. `--browsers` switches to Vitest browser mode, which needs its own
  packages installed.
- Globals come from `vitest/globals` (`tsconfig.spec.json` `types`). Jasmine idioms map to Vitest:
  `spyOn` → `vi.spyOn`, `jasmine.createSpy` → `vi.fn()`, `jasmine.objectContaining` →
  `expect.objectContaining`. `ng generate @schematics/angular:refactor-jasmine-vitest` automates most of it
  (experimental).
- Type errors in templates fail the test build: the unit-test builder compiles with the Angular
  compiler, strict templates included.

### Patterns

```ts
it('shows the badge once the socket reports', async () => {
  const socket = new FakeSocket();
  TestBed.configureTestingModule({ providers: [{ provide: RoomSocket, useValue: socket }] });
  const fixture = TestBed.createComponent(RoomStatus);
  await fixture.whenStable();

  socket.emit('joined'); // outside any Angular event, like a real socket
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('In the room');
});
```

- Inputs: `fixture.componentRef.setInput('seats', [...])`, then `await fixture.whenStable()`.
- To exercise outputs and two-way bindings, render a small host component in the test whose template
  binds `[(picked)]="pickedSignal"` and `(hold)="held.push($event)"`.
- Effects and `toObservable` emissions run during change detection; `TestBed.tick()` runs them
  synchronously when you need to assert in between.
- Timers: `fakeAsync`, `tick`, `flush` and `waitForAsync` require zone.js (`zone.js/plugins/vitest-patch`
  in the test polyfills). In a zoneless suite use Vitest timers:

  ```ts
  vi.useFakeTimers();
  const fixture = TestBed.createComponent(Countdown);
  await vi.advanceTimersByTimeAsync(3000);
  TestBed.tick(); // the scheduler's own setTimeout is faked too, so flush rendering explicitly
  expect(fixture.nativeElement.textContent).toContain('0:57');
  vi.useRealTimers();
  ```

  Or fake only the APIs the component uses: `vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })`
  keeps Angular's scheduler on real timers, so `await fixture.whenStable()` works as usual.
- HTTP: `provideHttpClient()` plus `provideHttpClientTesting()`, then `TestBed.inject(HttpTestingController)`.
  A pending request keeps the application unstable, so never `await fixture.whenStable()` before
  flushing it: the test hangs until Vitest's timeout.

  ```ts
  submitSearch(fixture, 'tent');           // dispatches the DOM event
  TestBed.tick();                           // effects run, the resource issues its request
  const req = http.expectOne((r) => r.url === '/api/hits');
  req.flush({ items: [], next: null });
  await fixture.whenStable();               // now stable: assert on the DOM
  http.verify();                            // in afterEach: nothing unexpected left open
  ```

  `req.cancelled` is `true` when a newer request superseded it through `switchMap`, `rxResource`
  or `httpResource`.
- `TestBed` rethrows errors from change detection (`rethrowApplicationErrors` defaults to true), so
  a template that throws (for example `ResourceValueError` from an unguarded `value()`) fails the
  test at `whenStable()`.
- `TestBed.getLastFixture()` (22) returns the most recently created fixture, handy in helpers.

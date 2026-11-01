# Migrating Angular 14-21 code to Angular 22

Checked against `@angular/core@22.2.4` and the angular/angular CHANGELOG for 20.0.0, 21.0.0, 22.0.0,
22.1.0 and 22.2.0.

## What changed, by release

### 20.0 (2025-05-28)

- Stable: `effect`, `linkedSignal`, `toSignal`, `toObservable`, signal inputs/outputs/queries,
  `provideZonelessChangeDetection()` (renamed from `provideExperimentalZonelessChangeDetection()`).
- Resource API reshaped: `request` → `params`, `loader: ({ request })` → `loader: ({ params })`,
  `rxResource`'s `loader` → `stream`, `ResourceStatus` enum → string union, and reading `value()`
  in the error state throws instead of returning `undefined`.
- `afterRender` → `afterEveryRender`. `TestBed.flushEffects()` → `TestBed.tick()`.
- `*ngIf`, `*ngFor`, `*ngSwitch` deprecated in favour of `@if`, `@for`, `@switch`.
- `ng-reflect-*` attributes no longer rendered by default; don't select on them in tests.

### 21.0 (2025-11-19)

- Zoneless is the default. Apps that still need zones add `provideZoneChangeDetection()` and keep
  zone.js in `polyfills`.
- New projects test with Vitest through `@angular/build:unit-test`.
- Signal forms (`@angular/forms/signals`) experimental.
- `moduleId` and the component `interpolation` option removed; TypeScript < 5.9 dropped.

### 22.0 (2026-06-03)

- Components without `changeDetection` are `OnPush`. `ChangeDetectionStrategy.Eager` replaces
  `Default` (still an alias, deprecated). `ng update` adds `Eager` to existing components.
- `strictTemplates` defaults to `true` (`ng update` writes `strictTemplates: false` where unset).
- Template optional chaining returns `undefined`, not `null`; `ng update` wraps existing
  expressions in `$safeNavigationMigration(...)` to keep the old result.
- Compiler errors for duplicate input/output/model names (NG1054), for `data-` attributes binding
  inputs (they no longer do), and for elements matched by several component selectors.
- Stable: `resource`, `rxResource`, `httpResource`, signal forms. New: `@Service()`, `injectAsync()`,
  `debounced()` (experimental), `resourceFromSnapshots` (experimental), `TestBed.getLastFixture()`.
- HTTP: `FetchBackend` is the default; `withFetch()` deprecated; `withXhr()` for upload progress;
  `reportProgress` deprecated for `reportUploadProgress`/`reportDownloadProgress`.
- Removed: `ComponentFactoryResolver`/`ComponentFactory` (pass the class to
  `ViewContainerRef.createComponent` or use `createComponent`), `createNgModuleRef`,
  `ChangeDetectorRef.checkNoChanges`, `provideRoutes()`, Hammer.js integration.
- Router: `paramsInheritanceStrategy` defaults to `'always'`; `CanMatchFn` gets a required third
  `currentSnapshot` argument.
- Forms: the `min` and `max` validation rules no longer accept string values (numbers or `null`).
- TypeScript 6.0 required (`>=6.0 <6.1` in the 22.2 peer ranges).

### 22.1 (2026-07-29) and 22.2 (2026-09-23)

- 22.1: `linkedSignal` custom `set` option; `HttpClient.jsonp` deprecated; `@Injectable` → `@Service`
  migration schematic.
- 22.2: templates can read `private` members; `strictUnclaimedEventNames` compiler option catches
  misspelled output bindings; `@boundary` error-boundary blocks and programmatic ErrorBoundary APIs;
  router `RedirectCommand` can be thrown.

## API mapping

| Old | Angular 22 |
| --- | --- |
| `@Input() x = 1` | `x = input(1)` |
| `@Input({ required: true }) x!: T` | `x = input.required<T>()` |
| `@Input('alias') x` | `x = input(init, { alias: 'alias' })` |
| `@Input({ transform: booleanAttribute }) x = false` | `x = input(false, { transform: booleanAttribute })` |
| `@Input() x` + `@Output() xChange` | `x = model(init)` |
| `@Output() done = new EventEmitter<T>()` | `done = output<T>()` (emit is the same) |
| `@Output() s = obs$` | `s = outputFromObservable(obs$)` |
| `@ViewChild('ref') el?: ElementRef` | `el = viewChild<ElementRef>('ref')`, read `this.el()` |
| `@ViewChild(Cmp, { static: true }) c!: Cmp` | `c = viewChild.required(Cmp)` |
| `@ContentChildren(Item) items!: QueryList<Item>` | `items = contentChildren(Item)` (a `Signal<readonly Item[]>`) |
| `ngOnChanges` derived fields | `computed` |
| `ngOnChanges` resetting local state | `linkedSignal` |
| `constructor(private http: HttpClient)` | `private http = inject(HttpClient)` |
| `@Injectable({ providedIn: 'root' })` | `@Service()` (optional) |
| class `CanActivate` guards, class interceptors | `CanActivateFn`, `HttpInterceptorFn` with `withInterceptors` |
| `*ngIf="x; else y"` | `@if (x) { } @else { }` |
| `*ngFor="let i of xs; trackBy: byId"` | `@for (i of xs; track i.id) { }` |
| `[ngSwitch]` | `@switch` / `@case` / `@default` |
| `ChangeDetectionStrategy.Default` | `ChangeDetectionStrategy.Eager`, or nothing (OnPush) once reactive |
| `provideExperimentalZonelessChangeDetection()` | nothing (default), or `provideZonelessChangeDetection()` |
| `afterRender(fn)` | `afterEveryRender(fn)` |
| `TestBed.flushEffects()` | `TestBed.tick()` |
| `fakeAsync`/`tick` | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` |
| `resource({ request, loader: ({ request }) })` | `resource({ params, loader: ({ params }) })` |
| `rxResource({ request, loader })` | `rxResource({ params, stream })` |
| `ResourceStatus.Error` | `'error'` |

## Schematics (all in `@angular/core`)

```sh
ng generate @angular/core:signals                 # inputs + outputs + queries
ng generate @angular/core:signal-input-migration  # --best-effort-mode, --insert-todos
ng generate @angular/core:output-migration
ng generate @angular/core:signal-queries-migration
ng generate @angular/core:control-flow-migration
ng generate @angular/core:inject-migration
ng generate @angular/core:self-closing-tags-migration
ng generate @angular/core:cleanup-unused-imports
ng generate @angular/core:common-to-standalone-migration
ng generate @angular/core:ngclass-to-class-migration
ng generate @angular/core:service-migration       # @Injectable -> @Service
ng generate @schematics/angular:refactor-jasmine-vitest  # experimental
```

The input migration skips inputs the class writes to (add `--insert-todos` to see why); convert
those to `model()` or a `linkedSignal` by hand. It also leaves `ngOnChanges`, `ChangeDetectionStrategy.Eager`
and plain fields alone. Control-flow migration turns `trackBy: byId` into `track byId($index, item)`;
simplify to `track item.id`.

## Grep checklist after an upgrade

```sh
rg -n -e zone.js -e provideZoneChangeDetection -e NgZone -e onStable -e onMicrotaskEmpty src angular.json package.json
rg -n -e fakeAsync -e waitForAsync -e flushEffects src --glob '*.spec.ts'
rg -n -e 'ChangeDetectionStrategy.Default' -e 'ChangeDetectionStrategy.Eager' src
rg -n -e '[*]ngIf' -e '[*]ngFor' -e '[*]ngSwitch' -e CommonModule src
rg -n -e 'request:' -e 'ResourceStatus[.]' src
rg -n -F '.value()' src
rg -n -e '[.]push[(]' -e '[.]splice[(]' -e '[.]sort[(][)]' src/app
rg -n -e 'withFetch[(]' -e ComponentFactoryResolver -e checkNoChanges -e provideRoutes src
```

Every `.value()` hit in a template or `computed` must sit behind `hasValue()` or an `error()` check.
Every `push`/`splice`/`sort` hit on state a template reads must become a new array.

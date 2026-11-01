# Sources

Checked on 2026-11-01 against `sqlalchemy==2.1.6` (PyPI latest, published 2026-10-21) on Python
3.14, with `aiosqlite==0.22.1` and `greenlet==3.5.6`. Every behaviour described in this skill was
also run against the installed packages. The 1.4 comparisons used `sqlalchemy==1.4.54` (published
2024-09-05) on Python 3.12.

## Official documentation (docs.sqlalchemy.org, 2.1 series)

- What's new in 2.1 (Python 3.11+, greenlet no longer installed by default, unconditional autoflush,
  MappedAsDataclass defaults via descriptors and `DONT_SET`, `filter_by()` across all FROM entities
  and `AmbiguousColumnError`, psycopg 3 as the default PostgreSQL driver):
  https://docs.sqlalchemy.org/en/21/changelog/migration_21.html
  (source: `doc/build/changelog/migration_21.rst` in github.com/sqlalchemy/sqlalchemy)
- 2.0 migration guide (removal of library-level autocommit, `engine.execute`, `select([...])`,
  `Row` as named tuple, string loader options, `cascade_backrefs` behaviour removed):
  https://docs.sqlalchemy.org/en/20/changelog/migration_20.html
  and https://docs.sqlalchemy.org/en/20/changelog/whatsnew_20.html
- Working with engines and connections ("commit as you go", `engine.begin()`):
  https://docs.sqlalchemy.org/en/21/core/connections.html
- Session basics (sessionmaker, `begin()`, `expire_on_commit`, autoflush, `PendingRollbackError`):
  https://docs.sqlalchemy.org/en/21/orm/session_basics.html
- Cascades (save-update cascade, "cascade_backrefs behavior deprecated for removal in 2.0"):
  https://docs.sqlalchemy.org/en/21/orm/cascades.html
- Relationship loading techniques (lazy, joined, selectin, raise, `unique()` for joined collections):
  https://docs.sqlalchemy.org/en/21/orm/queryguide/relationships.html
- ORM querying API (`populate_existing`, execution options):
  https://docs.sqlalchemy.org/en/21/orm/queryguide/api.html
- ORM-enabled INSERT/UPDATE/DELETE, bulk inserts, upserts with RETURNING and `populate_existing`,
  `synchronize_session`: https://docs.sqlalchemy.org/en/21/orm/queryguide/dml.html
- Persistence techniques (`eager_defaults`, fetching server-generated values):
  https://docs.sqlalchemy.org/en/21/orm/persistence_techniques.html
- Declarative tables with `Mapped` / `mapped_column` (nullability from `Optional`):
  https://docs.sqlalchemy.org/en/21/orm/declarative_tables.html
- Declarative dataclass mapping: https://docs.sqlalchemy.org/en/21/orm/dataclasses.html
- asyncio extension (greenlet install note, preventing implicit IO, `expire_on_commit=False`,
  `AsyncAttrs`, events on `sync_engine`, "a single instance of AsyncSession is not safe for use in
  multiple, concurrent tasks"): https://docs.sqlalchemy.org/en/21/orm/extensions/asyncio.html
- SQLite dialect (foreign key pragma, RETURNING, `insert().on_conflict_do_update()`):
  https://docs.sqlalchemy.org/en/21/dialects/sqlite.html
- Error reference (MissingGreenlet `xd2s`, DetachedInstanceError `bhk3`):
  https://docs.sqlalchemy.org/en/21/errors.html

## Package metadata

- `sqlalchemy==2.1.6` `requires_dist`: `greenlet>=1; extra == "asyncio"`, and the `aiosqlite`,
  `postgresql-asyncpg`, `aiomysql` extras pull in `sqlalchemy[asyncio]`. Read from
  https://pypi.org/pypi/sqlalchemy/2.1.6/json.

## Behaviour reproduced by running it (2.1.6 unless noted)

- `engine.execute` / `engine.scalar`: `AttributeError`. `select([X])`: `ArgumentError`.
  `conn.execute("SELECT 1")`: `ObjectNotExecutableError`. `conn.execute(text(...), a=5)`:
  `TypeError`. `row["name"]`, `dict(row)`: `TypeError`. `row.keys()`, `row.items()`,
  `select().apply_labels()`: `AttributeError`. `MetaData(bind=...)`, `Table(..., autoload=True)`:
  `TypeError`. `Session(autocommit=True)`: `ArgumentError`. `joinedload("name")`: `ArgumentError`.
- An INSERT on `engine.connect()` without `commit()` was gone from the next connection; no warning.
- `Book(author=author)` (and `line.parent = parent`) with the parent in the session, persistent or
  pending: not inserted, `SAWarning: Object of type <...> not in session, add operation along
  '...' will not proceed`. `relationship(cascade_backrefs=True)`: `ArgumentError`. On 1.4.54 the
  same code inserted the child.
- `session.execute(select(Model)).all()` returned `Row` objects; `.scalars()` returned instances.
- `joinedload` on a collection without `.unique()`: `InvalidRequestError`.
- Statement counts: `selectinload` on a many-to-one added one SELECT, `joinedload` none.
- ORM upsert with `.returning(Model)` returned an already-loaded instance with its old value; with
  `execution_options={"populate_existing": True}` it had the new one.
- A SELECT for an instance already in the identity map kept loaded attributes and filled expired
  ones.
- `.mappings()` rows are `RowMapping`, not `dict`; `json.dumps` rejects them.
- 2.1 autoflush: a pending object was counted by `session.execute(text("select count(*) ..."))`.
- `IntegrityError` on flush, then any query: `PendingRollbackError` until `rollback()`.
- `DateTime(timezone=True)` on SQLite returned a naive datetime for a UTC-aware input.
- Without `PRAGMA foreign_keys=ON` an orphan row inserted; with the `connect` event (on
  `engine.sync_engine` for aiosqlite) it raised `IntegrityError: FOREIGN KEY constraint failed`.
- `event.listen(async_engine, "connect", ...)`: `NotImplementedError`.
- Async without greenlet installed: `ImportError: The SQLAlchemy asyncio module requires that the
  Python 'greenlet' library is installed`.
- Async: attribute access after commit with the default `async_sessionmaker`, lazy relationship
  access, and reading a relationship of a newly created object all raised `StatementError` wrapping
  `MissingGreenlet`; after the session closed, `DetachedInstanceError`.
- `onupdate=func.current_timestamp()` produced `UPDATE ... SET updated_at=CURRENT_TIMESTAMP` and
  left `updated_at` expired even with `expire_on_commit=False`. With
  `__mapper_args__ = {"eager_defaults": True}` the UPDATE used `RETURNING updated_at`.
- INSERT server defaults came back via `INSERT ... RETURNING id, created_at` on SQLite.
- `lazy="raise_on_sql"` and `raiseload("*")` raised `InvalidRequestError` on access; identity-map
  hits under `raise_on_sql` did not raise.
- Pydantic 2.14.2 `model_validate(obj)` with `from_attributes=True` over an unloaded relationship in
  async code: `ValidationError` "Error extracting attribute: StatementError ...".
- `AsyncSession` coroutine vs plain methods listed in section 7 of SKILL.md, read with `inspect`.

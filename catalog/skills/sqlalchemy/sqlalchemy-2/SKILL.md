---
name: sqlalchemy-2
description: Write, review and upgrade SQLAlchemy 2.x data access (checked against 2.1.6), covering typed ORM models (DeclarativeBase, Mapped), select() queries, Session and Connection transactions, relationship loading, upserts and the asyncio extension. Covers the 1.x habits that fail silently on 2.x (Connection work rolled back without commit, children attached through a backref never saved, stale objects after an ORM upsert), N+1 queries and fixed query budgets (selectinload, joinedload with unique(), raiseload, statement counting), async pitfalls (MissingGreenlet from lazy loads, expire_on_commit, columns expired by onupdate, events on sync_engine, the greenlet extra), and SQLite specifics (PRAGMA foreign_keys, naive DateTime). Use when code imports sqlalchemy, when adding models, queries or repositories, when a query is slow or issues one query per row, when porting to AsyncSession, or when upgrading from SQLAlchemy 1.3/1.4 (engine.execute, select([...]), row['col'], Query.get, autocommit).
license: MIT
---

# SQLAlchemy 2

SQLAlchemy 2.1 is current (`2.1.6`, October 2026); 2.0 is the previous series and shares the
API below. Most SQLAlchemy code on the web and in training data is 1.3/1.4 style. Much of it now
fails loudly, which is fine. The dangerous part is the code that still runs and quietly writes
nothing, loads stale data or fires a query per row. Everything below was run on 2.1.6.

## 1. Know what is installed

```sh
python -c "import sqlalchemy; print(sqlalchemy.__version__)"
python -c "import greenlet"   # needed for the asyncio extension
```

- 2.1 needs Python 3.11+.
- **2.1 no longer installs greenlet by default.** The asyncio extension (`create_async_engine`,
  `AsyncSession`) raises `ImportError: ... requires that the Python 'greenlet' library is
  installed` until you depend on `sqlalchemy[asyncio]` (or a driver extra such as
  `sqlalchemy[aiosqlite]`). Put the extra in the project's dependencies, not only on your machine.
- Drivers are separate packages: `aiosqlite`, `asyncpg`, `psycopg` (2.1's default PostgreSQL
  driver is psycopg 3).

## 2. Typed models

```python
from __future__ import annotations
import datetime as dt
from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Author(Base):
    __tablename__ = "authors"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    bio: Mapped[str | None]                       # nullable because of `| None`
    books: Mapped[list[Book]] = relationship(back_populates="author", order_by="Book.id")

class Book(Base):
    __tablename__ = "books"
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))   # NOT NULL
    title: Mapped[str]
    added_at: Mapped[dt.datetime] = mapped_column(server_default=func.current_timestamp())
    author: Mapped[Author] = relationship(back_populates="books")
```

- Nullability comes from the annotation: `Mapped[str]` is NOT NULL, `Mapped[str | None]` is
  nullable. `mapped_column(nullable=...)` overrides it.
- Prefer `back_populates` on both sides to `backref=`; it is explicit and type-checkable.
- `sqlalchemy.ext.declarative.declarative_base` and `sqlalchemy.orm.declarative_base` still work
  (the first warns `MovedIn20Warning`). Plain `Column` attributes still map. Neither is urgent in an
  upgrade; behaviour bugs are.
- `MappedAsDataclass` in 2.1: a `mapped_column(default=...)` value is delivered by the attribute
  descriptor and is **not** placed in `__dict__`; `relationship(default=...)` only accepts `None`;
  `default` and `insert_default` are mutually exclusive.

## 3. Transactions: the silent data-loss rules

**A `Connection` never autocommits in 2.x.** Work done on `engine.connect()` is rolled back when
the block exits unless you call `conn.commit()`. No error, no warning.

```python
with engine.connect() as conn:          # read-only work, or commit explicitly
    conn.execute(stmt)
    conn.commit()                       # without this line the write is discarded

with engine.begin() as conn:            # commits on success, rolls back on exception
    conn.execute(stmt)
```

`engine.execute()`, `engine.scalar()` and 1.x library-level autocommit are gone: a ported
`engine.execute(insert)` that became `with engine.connect() as conn: conn.execute(insert)` loses
the write. Use `engine.begin()` for every unit of work that writes.

**Sessions:**

```python
SessionLocal = sessionmaker(engine)              # async: async_sessionmaker(engine, ...)

with SessionLocal.begin() as session:            # commit at the end, rollback on error
    session.add(author)

with SessionLocal() as session:                  # "commit as you go"
    session.add(author)
    session.commit()                             # leaving the block without this rolls back
```

- After a failed flush (`IntegrityError`), the session refuses further work with
  `PendingRollbackError` until you call `session.rollback()`. Catch, roll back, then report.
- `expire_on_commit=True` (the default) expires every loaded attribute on commit. Reading one later
  reloads it, which is fine with an open sync session, a `DetachedInstanceError` after close, and a
  `MissingGreenlet` in async code (section 7).
- 2.1 autoflushes before **every** execution, including `session.execute(text(...))`; 2.0 only
  autoflushed before ORM statements.

## 4. Querying

```python
from sqlalchemy import select

authors = session.scalars(select(Author).where(Author.name.like("A%"))).all()  # list[Author]
rows = session.execute(select(Author.id, Author.name)).all()                    # list[Row]
author = session.get(Author, 42)                                                # None if absent
one = session.scalars(select(Author).where(Author.name == name)).one()          # raises if 0 or 2+
```

- `session.execute(select(Author)).all()` returns `Row` tuples `(Author,)`, not `Author` objects.
  Use `session.scalars(...)` for single-entity selects.
- `select(A, B)` takes positional arguments. `select([A, B])` raises `ArgumentError`.
- Rows are named tuples: `row.name`, `row[0]`, `row._mapping["name"]`, `row._asdict()`.
  `row["name"]` raises `TypeError`, and so does `dict(row)`. `result.mappings().all()` gives
  `RowMapping` objects, which are **not** `dict` (`json.dumps` rejects them); use
  `[dict(m) for m in result.mappings()]` or `row._asdict()` when a caller needs real dicts.
- `Query.get()` still works with a `LegacyAPIWarning`; write `session.get(Model, pk)`.
  `session.query(...)` is legacy but supported, so porting it is optional; porting removed APIs is not.
- `text()` parameters go in a dict: `conn.execute(text("... :lo"), {"lo": 5})`. Keyword arguments
  raise `TypeError`. IN lists need `bindparam("ids", expanding=True)`.
- `Select.alias()` still works and returns a `Subquery`; `.subquery("name")` says what it does.
- 2.1: `filter_by(name=...)` searches every entity in the FROM clause (joined ones too) and raises
  `AmbiguousColumnError` when more than one has that name (`id`, typically); use `.where()` then.

## 5. Relationship loading and N+1

Relationships default to `lazy="select"`: each first access to an unloaded relationship is one
query. A loop over 200 rows that touches two relationships is 401 queries. Fix it **per query**
with loader options instead of changing the model default, which affects every other code path.

| Relationship | Option | Queries |
| --- | --- | --- |
| many-to-one (`book.author`) | `joinedload(Book.author)` | 0 extra (rides in the main SELECT) |
| one-to-many / many-to-many (`author.books`) | `selectinload(Author.books)` | 1 extra, `WHERE parent_id IN (...)` |
| nested | `selectinload(Author.books).joinedload(Book.publisher)` | 1 per collection level |

- `joinedload` on a **collection** duplicates parent rows, so 2.x requires `.unique()`:
  `session.scalars(stmt).unique().all()`. Without it you get `InvalidRequestError: The unique()
  method must be invoked on this Result`. `selectinload` avoids the row explosion and needs no
  `unique()`; it is the default choice for collections.
- `selectinload` on a many-to-one costs a query; `joinedload` it instead when you have a tight
  query budget.
- Loader options take class-bound attributes. Strings (`joinedload("books")`) raise
  `ArgumentError` since 2.0.
- Chain every level the code touches. A missing link (`items` loaded, `items.product` not) is still
  N+1.
- Rows filtered by an INNER JOIN disappear. If parents without children must still appear, eager
  loading (which uses outer joins / IN queries) keeps them; a hand-written `.join()` does not.
- To prove a query budget, count statements (recipe in
  [references/loading-and-n-plus-one.md](references/loading-and-n-plus-one.md)) and use
  `raiseload("*")` or `lazy="raise_on_sql"` in tests to turn any missed lazy load into an error.
- `execution_options(populate_existing=True)` makes a SELECT overwrite objects already in the
  session's identity map. Without it, a re-query returns the cached object's old values for any
  attribute that was already loaded.

## 6. Writes

**Cascade follows the parent's collection, not the backref.** 1.x cascaded an object into the
session when you set its many-to-one to a parent that was in the session (`cascade_backrefs`).
2.0 removed that. The object is silently not saved; the only signal is
`SAWarning: Object of type <Book> not in session, add operation along 'Author.books' will not proceed`.

```python
author = session.get(Author, 1)
Book(title="Draft", author=author)      # 2.x: never INSERTed
author.books.append(Book(title="Draft"))  # saved: cascade along Author.books
session.add(Book(title="Draft", author=author))  # saved: explicitly added
session.commit()
```

`relationship(cascade_backrefs=True)` raises `ArgumentError`; there is no switch to get 1.x back.
Grep upgrades for constructors and assignments that set a many-to-one (`Child(parent=...)`,
`child.parent = ...`) without a matching `session.add` or collection `append`.

**Bulk and upserts:**

```python
from sqlalchemy import insert, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert   # postgresql has the same API

session.execute(insert(Book), [{"title": "A", "author_id": 1}, {"title": "B", "author_id": 1}])

stmt = sqlite_insert(Book).values(rows)
stmt = stmt.on_conflict_do_update(
    index_elements=[Book.isbn], set_={"title": stmt.excluded.title}
)
fresh = session.scalars(
    stmt.returning(Book), execution_options={"populate_existing": True}
).all()

session.execute(update(Book).where(Book.author_id == 1).values(title="Reissue"))
```

- An ORM upsert with `.returning(Model)` returns the identity-map instances. Objects already loaded
  in the session keep their **old** values unless you pass `populate_existing` (reproduced on
  2.1.6: the database had the new price, the returned object the old one).
- ORM-enabled `update()`/`delete()` default to `synchronize_session="auto"`, which updates matching
  objects in the session.

## 7. asyncio

```python
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine

engine = create_async_engine("sqlite+aiosqlite:///library.db")
Session = async_sessionmaker(engine, expire_on_commit=False)

async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)

async with Session() as session:
    author = (await session.scalars(
        select(Author).where(Author.id == 1).options(selectinload(Author.books))
    )).one()
```

**Rule: in async code nothing may lazy-load, ever.** Any attribute access that needs SQL raises
`MissingGreenlet` (surfacing as `StatementError: (sqlalchemy.exc.MissingGreenlet) greenlet_spawn
has not been called`), including access from synchronous helpers such as serializers, or Pydantic
`from_attributes` validation (reported as a `ValidationError` "Error extracting attribute"), while
the session is still open. After the session closes it is
`DetachedInstanceError`. So every function that returns ORM objects must return them fully loaded
for what callers read:

1. `async_sessionmaker(engine, expire_on_commit=False)`, or every attribute is expired by commit.
2. Eager-load every relationship callers touch, nested ones included (`selectinload(...).selectinload(...)`).
3. Objects you just created have **unloaded** relationships, even empty ones. Reload after commit,
   e.g. `await session.refresh(obj, ["author"])` or a SELECT with options.
4. **Columns the database computes on UPDATE are expired after the flush even with
   `expire_on_commit=False`.** `mapped_column(onupdate=func.current_timestamp())` puts the SQL in
   the UPDATE and expires `updated_at`; the next read is a lazy load. Re-select with
   `execution_options(populate_existing=True)`, `await session.refresh(obj)`, or map with
   `__mapper_args__ = {"eager_defaults": True}`. INSERT-time server defaults come back through
   RETURNING on backends that support it (SQLite, PostgreSQL), so `created_at` is usually fine.
5. When you need a relationship later, `await obj.awaitable_attrs.books` (mix `AsyncAttrs` into
   `Base`) instead of `obj.books`.

- Coroutines on `AsyncSession`: `execute`, `scalars`, `scalar`, `get`, `flush`, `commit`,
  `rollback`, `refresh`, `delete`, `merge`, `close`, `run_sync`. Synchronous: `add`, `add_all`,
  `expire`, `expunge`. `await session.delete(obj)`, but `session.add(obj)`.
- Events cannot be attached to an `AsyncEngine` (`NotImplementedError`). Attach pool and cursor
  events to `engine.sync_engine`:

```python
@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
```

- DDL and other sync-only APIs go through `await conn.run_sync(fn)`.
- One `AsyncSession` per task. It is not safe to share across concurrent `asyncio.gather` branches.

More in [references/asyncio.md](references/asyncio.md).

## 8. SQLite

- Foreign keys are **not enforced** unless each connection runs `PRAGMA foreign_keys=ON` (event
  above). Without it, orphan rows insert happily.
- `DateTime(timezone=True)` stores and returns **naive** datetimes on SQLite (the offset is
  dropped). Store UTC and attach `timezone.utc` on read, or keep an explicit offset column.
- SQLite supports RETURNING (3.35+), so 2.x fetches primary keys and INSERT server defaults in the
  same statement.
- `sqlite:///relative.db` is relative to the working directory; `sqlite:////abs/path.db` is
  absolute; `sqlite://` is in-memory, and every new DBAPI connection gets its own empty database.

## 9. Upgrading from 1.3/1.4

1. Confirm the installed version and keep the lockfile change in the same commit.
2. Run the tests with warnings visible (`python -W always::DeprecationWarning -m pytest`) and fix
   the loud failures: `engine.execute`/`engine.scalar` (AttributeError), `select([...])`
   (ArgumentError), `row["col"]`/`dict(row)` (TypeError), `conn.execute(text, x=1)` (TypeError),
   string loader options (ArgumentError), `MetaData(bind=...)` and `autoload=True` (TypeError),
   `Session(autocommit=True)` (ArgumentError).
3. Then hunt the silent ones, which tests often don't cover:
   - every write that used `engine.execute()` or relied on autocommit: give it `engine.begin()` or
     an explicit `commit()`;
   - every child attached through a backref (`Child(parent=p)`, `child.parent = p`): append to the
     parent's collection or `session.add()` it;
   - any `SAWarning: ... not in session, add operation along ... will not proceed` in the test
     output is lost data.
4. Prove writes landed by reading them back from a **fresh** connection, not the one that wrote.

The full table, with grep patterns, is in [references/upgrade-from-1x.md](references/upgrade-from-1x.md).

## 10. Review checklist

- [ ] Every write runs inside `engine.begin()`, `sessionmaker.begin()` or ends with `commit()`.
- [ ] `IntegrityError` handling calls `session.rollback()` before the session is reused.
- [ ] No child object relies on a backref to reach the session.
- [ ] Loops over query results don't touch unloaded relationships; loader options cover every level.
- [ ] `joinedload` on collections is followed by `.unique()`.
- [ ] Async: `expire_on_commit=False`, no lazy loads, server-computed UPDATE columns refreshed,
      events on `sync_engine`, `sqlalchemy[asyncio]` in dependencies.
- [ ] SQLite: foreign keys pragma, timezone handling.
- [ ] Results handed to JSON or other libraries are real dicts/objects, not `Row`/`RowMapping`.

## References

- [Upgrading from 1.x: before and after, loud and silent](references/upgrade-from-1x.md)
- [Loading strategies, statement counting and query budgets](references/loading-and-n-plus-one.md)
- [asyncio patterns](references/asyncio.md)
- [Sources checked](references/sources.md)

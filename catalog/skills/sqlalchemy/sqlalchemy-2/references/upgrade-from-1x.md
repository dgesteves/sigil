# Upgrading from SQLAlchemy 1.3/1.4 to 2.x

Every row was run on SQLAlchemy 2.1.6 (Python 3.14). The 1.4 behaviour was checked on 1.4.54
(Python 3.12). "Loud" means the old code raises on 2.x. "Silent" means it runs and does something
different. Fix the loud ones by running the tests; find the silent ones by reading.

## Contents

1. [Silent changes](#1-silent-changes)
2. [Loud changes: engines, connections, results](#2-loud-changes-engines-connections-results)
3. [Loud changes: ORM](#3-loud-changes-orm)
4. [Legacy but still working](#4-legacy-but-still-working)
5. [Changes inside 2.x that matter for upgrades](#5-changes-inside-2x-that-matter-for-upgrades)
6. [Search patterns](#6-search-patterns)
7. [Proving the port](#7-proving-the-port)

## 1. Silent changes

**Library-level autocommit is gone.** On 1.4, `engine.execute(insert)` committed, and so did
`conn.execute(text("UPDATE ..."))` on a plain `engine.connect()` (autocommit detection by regex).
On 2.x a `Connection` only commits when told to:

```python
# 1.4
engine.execute(loans.insert().values(book_id=7, member_id=3))

# 2.x, the port that loses the row: the block exits, the transaction rolls back, no warning
with engine.connect() as conn:
    conn.execute(loans.insert().values(book_id=7, member_id=3))

# 2.x, correct
with engine.begin() as conn:
    conn.execute(loans.insert().values(book_id=7, member_id=3))
```

A port that reads its own write back **on the same connection** looks fine in a test. Read back from
a new connection.

Related: on 1.4 several `engine.execute()` calls in one function were separate autocommitted
transactions. A 2.x port inside one `engine.begin()` block is atomic, which is almost always what the
code meant. If the old partial-commit behaviour mattered (rare), use one `begin()` per step.

**`cascade_backrefs` is gone.** On 1.4, assigning a many-to-one to a parent that was in the session
(`Book(author=author)`, `book.author = author`) also put the child in the session through the
backref. On 2.x the child is not added; at flush SQLAlchemy emits

```
SAWarning: Object of type <Book> not in session, add operation along 'Author.books' will not proceed
```

and nothing is inserted. It happens whether the parent is persistent or merely pending
(`session.add(author)` earlier in the same function). Fixes, all equivalent:

```python
author.books.append(Book(title="Draft"))       # cascade along the parent's collection
session.add(Book(title="Draft", author=author))  # explicit
Author(name="Ann", books=[Book(title="Draft")])  # children given to the parent before session.add(parent)
```

`relationship(cascade_backrefs=True)` raises `ArgumentError: The 'cascade_backrefs' parameter
passed to relationship() may only be set to False`.

A function that returns the new child's id (`return book.id`) returns `None` in this case, because
the child was never flushed. That is often the only visible symptom.

**`session.execute(select(Model)).all()` returns rows.** Where 1.x `session.query(Model).all()`
returned objects, the 2.x `execute` form returns `Row` tuples. Mostly loud (`AttributeError` on the
row), but silent when the result is only counted, truth-tested or passed through.

## 2. Loud changes: engines, connections, results

| 1.x | 2.x | Error on 2.x |
| --- | --- | --- |
| `engine.execute(stmt)` | `with engine.begin() as conn: conn.execute(stmt)` | `AttributeError: 'Engine' object has no attribute 'execute'` |
| `engine.scalar(stmt)` | `conn.execute(stmt).scalar()` or `session.scalar(stmt)` | `AttributeError` |
| `conn.execute("SELECT 1")` | `conn.execute(text("SELECT 1"))` | `ObjectNotExecutableError` |
| `conn.execute(text(sql), id=5)` | `conn.execute(text(sql), {"id": 5})` | `TypeError: ... unexpected keyword argument` |
| `select([t.c.a, t.c.b])` | `select(t.c.a, t.c.b)` | `ArgumentError: Column expression, FROM clause, or other columns clause element expected` |
| `select([t]).where(...)` | `select(t).where(...)` | same |
| `row["name"]` | `row.name` or `row._mapping["name"]` | `TypeError: tuple indices must be integers or slices, not str` |
| `dict(row)` | `row._asdict()` or `dict(row._mapping)` | `TypeError` |
| `row.keys()`, `row.items()` | `row._mapping.keys()`, `row._mapping.items()` | `AttributeError` |
| `MetaData(bind=engine)` | `MetaData()`, pass the engine to `create_all(engine)` | `TypeError` |
| `Table("t", md, autoload=True)` | `Table("t", md, autoload_with=engine)` | `TypeError` |
| `select(...).apply_labels()` | `.set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)` | `AttributeError` |

Results: `result.fetchall()`, `.first()`, `.scalar()` still exist. New and preferred:
`.scalars()`, `.scalar_one()`, `.scalar_one_or_none()`, `.one()`, `.one_or_none()`, `.mappings()`.
`.mappings()` yields `RowMapping`, which is a read-only `Mapping`, not a `dict`: wrap it with
`dict(...)` before handing it to `json.dumps` or code that checks `isinstance(x, dict)`.

## 3. Loud changes: ORM

| 1.x | 2.x | Error on 2.x |
| --- | --- | --- |
| `joinedload("lines")`, `selectinload("a.b")` | `joinedload(Parent.lines)`, chained `selectinload(A.b).selectinload(B.c)` | `ArgumentError: Strings are not accepted for attribute names in loader options` |
| `Session(autocommit=True)`, `sessionmaker(autocommit=True)` | `with Session() as s, s.begin():` | `ArgumentError: autocommit=True is no longer supported` |
| `session.execute(select(X).options(joinedload(X.children))).scalars().all()` | add `.unique()` | `InvalidRequestError: The unique() method must be invoked on this Result` |
| `relationship(cascade_backrefs=True)` | append to the collection or `session.add` | `ArgumentError` |
| `from sqlalchemy.ext.asyncio import ...` without greenlet (2.1) | depend on `sqlalchemy[asyncio]` | `ImportError` |

## 4. Legacy but still working

These run on 2.1.6, some with warnings. Port them for clarity, but they are not where upgrade bugs
come from.

- `session.query(Model).filter(...)/.filter_by(...)/.all()/.one()/.first()`: the legacy `Query`
  API is fully supported. `Query.get(pk)` emits `LegacyAPIWarning`; use `session.get(Model, pk)`.
- `from sqlalchemy.ext.declarative import declarative_base`: `MovedIn20Warning`; use
  `sqlalchemy.orm.declarative_base` or `class Base(DeclarativeBase)`.
- `Column(...)` attributes without `Mapped[...]` annotations still map.
- `relationship("X", backref="y")` still creates both sides (only the cascade behaviour changed).
- `select(...).alias("name")` returns a `Subquery`; `.subquery("name")` is the explicit spelling.
- `metadata.create_all(bind=engine)` and `sessionmaker(bind=engine)` (the keyword still exists).

## 5. Changes inside 2.x that matter for upgrades

From the 2.1 migration notes, checked on 2.1.6:

- Python 3.11+ (2.1). greenlet only through the `asyncio` extra.
- Autoflush runs before every execution, Core and `text()` included (2.0 only flushed for ORM
  statements). Code that relied on a pending object being invisible to a raw SQL query in the same
  session now sees it.
- `MappedAsDataclass`: `mapped_column(default=...)` is served by the descriptor and is not put in
  `__dict__`; `relationship(default=...)` accepts only `None`; `default` and `insert_default` are
  mutually exclusive. Creating an object with only a foreign key value (`Child(parent_id=5)`) now
  inserts that value instead of `NULL`.
- `filter_by()` searches all FROM entities and raises `AmbiguousColumnError` for names present in
  more than one.
- The default PostgreSQL driver for `postgresql://` URLs is psycopg 3.

## 6. Search patterns

```sh
rg -n "engine\.(execute|scalar)\(|\.execute\(\s*['\"]|select\(\[|row\[['\"]|dict\(row|\.keys\(\)|autocommit|bind=engine|autoload=True" .
rg -n "(joinedload|selectinload|subqueryload|lazyload)\(['\"]" .
rg -n "\.get\(\w+\)|query\(\w+\)\.get" .
# children attached through a many-to-one: list the relationships, then search each
# many-to-one name as a constructor keyword and as an assignment
rg -n "relationship\(" --type py
rg -n "\bauthor=|\.author = " --type py    # repeat per many-to-one name
```

For each hit, check that the child also reaches the session through `session.add()` or the
parent's collection. The searches narrow the reading; they don't replace it.

## 7. Proving the port

- Run the suite with `-W always` and read the warnings: `SAWarning ... not in session` is lost data,
  `LegacyAPIWarning`/`MovedIn20Warning` are cosmetic.
- For every function that writes, test that the write is visible from a fresh connection (or plain
  `sqlite3` for SQLite) after the function returns.
- Compare old and new on the same seeded database: run the 1.4 code in a throwaway virtualenv
  (`sqlalchemy==1.4.54` installs on Python 3.12) and diff the return values and the resulting rows.

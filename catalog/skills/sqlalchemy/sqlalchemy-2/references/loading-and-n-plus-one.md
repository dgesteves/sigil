# Loading strategies, statement counting and query budgets

Measured on SQLAlchemy 2.1.6 with SQLite. Counts are SELECT statements sent to the database.

## Strategies

| Option | How it loads | Extra SELECTs | Use for | Watch out |
| --- | --- | --- | --- | --- |
| `lazy="select"` (default) | on first attribute access | 1 per parent | rarely-touched relationships | N+1 in loops; impossible in async |
| `joinedload(A.b)` | LEFT OUTER JOIN in the same SELECT | 0 | many-to-one, one-to-one | on collections: parent rows multiply, `.unique()` required |
| `selectinload(A.bs)` | `SELECT ... WHERE a_id IN (...)` after the parent query | 1 per relationship level | collections, async | a many-to-one costs a query where `joinedload` costs none |
| `subqueryload(A.bs)` | re-runs the parent query as a subquery | 1 per level | legacy | superseded by `selectinload` in almost every case |
| `raiseload(A.b)` / `raiseload("*")` | refuses to load | n/a | tests, async code | raises `InvalidRequestError ... lazy='raise'` |
| `lazy="raise_on_sql"` on the relationship | refuses only when SQL is needed | n/a | async models | identity-map hits still work |
| `noload` | never loads, attribute is empty | 0 | almost never | silently wrong data |

Options compose per query and per path:

```python
stmt = (
    select(Author)
    .where(Author.country == "PT")
    .order_by(Author.name)
    .options(
        selectinload(Author.books)            # 1 query for all books of these authors
        .selectinload(Book.reviews)           # 1 query for all reviews of those books
        .joinedload(Review.reviewer),         # reviewers ride along in the reviews query
        joinedload(Author.agent),             # many-to-one in the main query
    )
)
authors = session.scalars(stmt).all()          # 3 SELECTs in total, whatever the row counts
```

A typical budget for "parents + two levels of children + many-to-ones" is one SELECT for the
parents (with joined many-to-ones) plus one per collection level. If the function also looks up
a parent row first (a `WHERE code = ?` lookup that raises when missing), that is one more. Keep such
lookups when their error behaviour is part of the contract.

## Choosing between joined and selectin for collections

- `selectinload` keeps one row per parent and is easier to reason about with `LIMIT`/`OFFSET`.
  Prefer it.
- `joinedload` on a collection is one round trip but multiplies rows (parents x children x
  grandchildren). It needs `session.scalars(stmt).unique().all()`; forgetting `unique()` raises.
- Both preserve parents that have no children. A hand-written `.join(Author.books)` used for
  filtering does not; use `.outerjoin` or an `EXISTS` (`.where(Author.books.any(...))`) when parents
  without children must stay.
- Ordering: `relationship(order_by=...)` is applied by every strategy. Ordering that the code does in
  Python (`sorted(author.books, key=...)`) is unaffected by the strategy.

## Counting statements

```python
from contextlib import contextmanager
from sqlalchemy import event

@contextmanager
def count_selects(engine):
    statements: list[str] = []

    def before(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before)

def test_catalogue_query_budget(engine, seeded_library):
    with Session(engine) as session, count_selects(engine) as statements:
        build_catalogue(session, country="PT")
    assert len(statements) <= 3, "\n---\n".join(statements)
```

- Count on a fresh session: objects already in the identity map hide lazy loads of many-to-ones.
- For an `AsyncEngine`, listen on `engine.sync_engine`.
- Seed enough rows (dozens of parents, several children each, some with none) that N+1 is obvious
  and empty collections are exercised.

## Turning missed eager loads into errors

```python
stmt = select(Author).options(selectinload(Author.books), raiseload("*"))
```

`raiseload("*")` applies to every relationship not otherwise configured on that query. In tests it
turns "it works but issues 300 queries" into a failure that names the attribute.

## Refreshing what is already loaded

A SELECT returns the instance already in the identity map and does not overwrite attributes that
were loaded (it fills in unloaded or expired ones). To force fresh values, for example after a Core
`update()` or an upsert in the same session:

```python
stmt = select(Book).where(Book.id == book_id).execution_options(populate_existing=True)
book = session.scalars(stmt).one()
# or
session.refresh(book)            # all column attributes, plus eagerly configured relationships
session.refresh(book, ["reviews"])  # named attributes, relationships included
```

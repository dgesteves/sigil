# asyncio patterns

Run on SQLAlchemy 2.1.6 with aiosqlite 0.22.1 and greenlet 3.5.6.

## Setup

```toml
# pyproject.toml: 2.1 does not pull in greenlet on its own
dependencies = ["sqlalchemy[asyncio]==2.1.6", "aiosqlite==0.22.1"]
```

```python
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

class Base(AsyncAttrs, DeclarativeBase):
    pass

def make_engine(url: str) -> AsyncEngine:
    engine = create_async_engine(url)

    @event.listens_for(engine.sync_engine, "connect")     # not on `engine`: NotImplementedError
    def _pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine

async def create_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

SessionFactory = async_sessionmaker(make_engine("sqlite+aiosqlite:///library.db"), expire_on_commit=False)
```

Dispose engines you create in tests (`await engine.dispose()`) before the event loop closes;
otherwise aiosqlite reports `ResourceWarning: <aiosqlite.core.Connection ...> was deleted before
being closed` at exit.

## Why lazy loading cannot work

The sync ORM API runs inside a greenlet that SQLAlchemy uses to bridge to the async driver. Plain
attribute access (`book.reviews`) is outside it, so when it needs SQL it raises:

```
sqlalchemy.exc.StatementError: (sqlalchemy.exc.MissingGreenlet) greenlet_spawn has not been called;
can't call await_() here. Was IO attempted in an unexpected place?
```

The wrapper is `StatementError` (with `.orig` a `MissingGreenlet`) when an attribute load triggers
it, so `except MissingGreenlet` does not catch it. Don't catch it at all: load the data.

Ways to end up there, each reproduced on 2.1.6:

| Situation | Why it lazy-loads |
| --- | --- |
| reading any attribute after `await session.commit()` with the default sessionmaker | `expire_on_commit=True` expired everything |
| `book.reviews` on a book fetched without options | relationships default to `lazy="select"` |
| `book.reviews` on a book you just created and committed | a new object's relationships are unloaded, not empty |
| `book.updated_at` after an UPDATE when the column has `onupdate=func.now()` (or any SQL expression) | the flush expires server-computed columns, even with `expire_on_commit=False` |
| a synchronous serializer touching any of the above | same rules, inside or outside `async with session` |
| Pydantic `Model.model_validate(obj)` with `from_attributes=True` | same; Pydantic reports it as `ValidationError: Error extracting attribute: StatementError ...` |

After the session is closed the same reads raise `DetachedInstanceError` instead.

## Returning objects that callers can read

```python
LIBRARY_GRAPH = (
    selectinload(Book.reviews).joinedload(Review.reviewer),
    joinedload(Book.author),
)

async def get_book(session: AsyncSession, book_id: int) -> Book | None:
    stmt = (
        select(Book)
        .where(Book.id == book_id)
        .options(*LIBRARY_GRAPH)
        .execution_options(populate_existing=True)   # refresh an instance already in the session
    )
    return (await session.scalars(stmt)).one_or_none()

async def rename_book(session: AsyncSession, book_id: int, title: str) -> Book:
    book = await session.get(Book, book_id)
    if book is None:
        raise LookupError(book_id)
    book.title = title
    await session.commit()              # updated_at is now expired (onupdate)
    return await get_book(session, book_id)

async def add_review(session: AsyncSession, book_id: int, reviewer_id: int, body: str) -> Review:
    review = Review(book_id=book_id, reviewer_id=reviewer_id, body=body)
    session.add(review)
    await session.commit()
    await session.refresh(review, ["reviewer"])   # load the relationship callers read
    return review
```

Alternatives that also work:

- Configure the relationships with `lazy="selectin"` on the model and call `await
  session.refresh(obj)` after each commit (refresh reloads columns and eager relationships). This
  changes loading for every query on that model, so prefer per-query options in shared models.
- `__mapper_args__ = {"eager_defaults": True}` on the model makes UPDATE fetch `onupdate` columns
  through `RETURNING` (2.1.6 emits `UPDATE ... RETURNING updated_at`). It does not load
  relationships.
- `await book.awaitable_attrs.reviews` (needs `AsyncAttrs`) when the caller itself is async and
  only sometimes needs the relationship.

## Session lifetime

- One `AsyncSession` per request or task. It must not be used by concurrent tasks
  (`asyncio.gather` over the same session interleaves its state).
- `async with SessionFactory() as session:` closes the session; it does not commit. Commit
  explicitly or use `async with SessionFactory.begin() as session:`.
- `session.add()` is synchronous; `await session.delete(obj)` is not.

## Testing async code without depending on plugin configuration

```python
import asyncio

def test_rename_book(tmp_path):
    async def scenario():
        engine = make_engine(f"sqlite+aiosqlite:///{tmp_path / 'lib.db'}")
        try:
            await create_schema(engine)
            factory = async_sessionmaker(engine, expire_on_commit=False)
            ...
        finally:
            await engine.dispose()
    asyncio.run(scenario())
```

With pytest-asyncio 1.x, mark async tests (`pytestmark = pytest.mark.asyncio`) or set
`asyncio_mode = "auto"`, use `@pytest_asyncio.fixture` for async fixtures, and set
`asyncio_default_fixture_loop_scope` to silence its deprecation warning.

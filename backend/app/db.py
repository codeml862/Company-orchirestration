"""Database engine and session management (SQLAlchemy 2.0; PostgreSQL via psycopg 3, or SQLite locally)."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import URL, Engine, create_engine, event, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker[Session] | None = None


def configure(database_url: str | None = None) -> None:
    """(Re)configure the engine. Tests call this to point at the test database."""
    global _engine, _SessionLocal
    url = make_url(database_url or get_settings().database_url)
    if _engine is not None:
        _engine.dispose()
    if url.get_backend_name() == "sqlite":
        _engine = _sqlite_engine(url)
    else:
        _engine = create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)


def _sqlite_engine(url: URL) -> Engine:
    """Single-machine development database.

    SQLite has no row locks (FOR UPDATE / SKIP LOCKED are dropped), so every transaction takes the
    write lock up front with BEGIN IMMEDIATE: task claims and lease updates then run one at a time
    instead of racing, and a request waits (up to `timeout` seconds) rather than failing on a stale
    read. Keep transactions short and never nest sessions that write: the second one would wait on
    the first until the timeout.
    """
    ensure_sqlite_dir(url)
    engine = create_engine(url, connect_args={"timeout": 30})

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        dbapi_connection.isolation_level = None  # stop pysqlite's implicit BEGIN; _on_begin emits it
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


def ensure_sqlite_dir(url: URL) -> None:
    """SQLite creates the database file but not its folder."""
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)


def get_engine():
    if _engine is None:
        configure()
    return _engine


def session_factory() -> sessionmaker[Session]:
    if _SessionLocal is None:
        configure()
    assert _SessionLocal is not None
    return _SessionLocal


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for workers and scripts: commit on success, rollback on error."""
    session = session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency. Endpoints commit explicitly."""
    session = session_factory()()
    try:
        yield session
    finally:
        session.close()

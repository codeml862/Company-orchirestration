"""Database engine and session management (SQLAlchemy 2.0, psycopg 3)."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker[Session] | None = None


def configure(database_url: str | None = None) -> None:
    """(Re)configure the engine. Tests call this to point at the test database."""
    global _engine, _SessionLocal
    url = database_url or get_settings().database_url
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)


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

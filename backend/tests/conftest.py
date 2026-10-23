import os
import tempfile

os.environ.setdefault("AICO_DATABASE_URL", "postgresql+psycopg://aico:aico@localhost:5432/aico_test")
os.environ["AICO_ENV"] = "test"
os.environ["AICO_SANDBOX_BACKEND"] = "subprocess"
os.environ["AICO_STORAGE_DIR"] = tempfile.mkdtemp(prefix="aico-test-storage-")
os.environ["AICO_JWT_SECRET"] = "test-secret-test-secret-test-secret"
os.environ["AICO_LLM_PROVIDERS"] = "[]"

import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import db as app_db  # noqa: E402
from app.agents.catalog import sync_catalog  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import Base, Client, Project  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    app_db.configure(os.environ["AICO_DATABASE_URL"])
    from alembic import command
    from alembic.config import Config

    engine = app_db.get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.environ["AICO_DATABASE_URL"])
    command.upgrade(cfg, "head")
    yield engine


@pytest.fixture(autouse=True)
def clean(database):
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with database.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    with app_db.session_scope() as session:
        sync_catalog(session)
    yield


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def make_project():
    def _make(title="Calculator", request="Build me a tested calculator module and research note.", **kwargs):
        with app_db.session_scope() as session:
            client = Client(name="Acme", contact_email="ops@acme.test", allow_external_llm=True)
            session.add(client)
            session.flush()
            project = Project(client_id=client.id, title=title, request=request, **kwargs)
            session.add(project)
            session.flush()
            return project.id, client.id

    return _make

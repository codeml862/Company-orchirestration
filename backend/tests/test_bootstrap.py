"""backend/.env owns the first admin's login: the API applies edits to it at startup."""

from sqlalchemy import select

from app.bootstrap import sync_bootstrap_admin
from app.config import get_settings
from app.db import session_scope
from app.models import User, UserRole
from app.security import hash_password, verify_password


def _sync(email, password):
    settings = get_settings().model_copy(update={"bootstrap_admin_email": email, "bootstrap_admin_password": password})
    with session_scope() as db:
        return sync_bootstrap_admin(db, settings)


def _admins():
    with session_scope() as db:
        return list(db.scalars(select(User).where(User.role == UserRole.ADMIN)))


def test_first_start_creates_the_admin_then_follows_env_edits():
    assert _sync("root@example.com", "first-password-123") == ["created"]
    assert _sync("root@example.com", "first-password-123") == []  # nothing to do

    changes = _sync("Owner@Example.com", "second-password-456")
    assert changes == ["email root@example.com -> owner@example.com", "password"]
    [admin] = _admins()
    assert admin.email == "owner@example.com" and verify_password("second-password-456", admin.password_hash)


def test_email_of_a_non_admin_account_is_never_taken_over():
    _sync("root@example.com", "first-password-123")
    with session_scope() as db:
        password_hash = hash_password("x" * 12)
        db.add(User(email="person@example.com", full_name="P", role=UserRole.OPERATOR, password_hash=password_hash))
    assert _sync("person@example.com", "another-password-1") == []
    with session_scope() as db:
        person = db.scalar(select(User).where(User.email == "person@example.com"))
        assert person.role == UserRole.OPERATOR and verify_password("x" * 12, person.password_hash)

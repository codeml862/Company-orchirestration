"""The first admin account, owned by backend/.env (AICO_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD).

The API applies these at startup and `python -m app.cli bootstrap` applies them on demand, so
editing them in backend/.env and restarting the API changes the admin's login. Because .env owns
this account, a password changed for it in the app is reset to the .env value on the next restart;
every other account is managed only in the app.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.config import Settings
from app.models import User, UserRole
from app.security import hash_password, verify_password

log = logging.getLogger("aico.bootstrap")

DEFAULT_PASSWORD = "admin-change-me"


class BootstrapError(Exception):
    pass


def sync_bootstrap_admin(db: Session, settings: Settings) -> list[str]:
    """Make the first admin's login match .env: create it, or update its email and password. Returns the changes."""
    email = settings.bootstrap_admin_email.strip().lower()
    password = settings.bootstrap_admin_password
    if settings.env == "production" and password == DEFAULT_PASSWORD:
        raise BootstrapError("refusing the default admin password in production; set AICO_BOOTSTRAP_ADMIN_PASSWORD")

    admin = db.scalar(select(User).where(User.email == email))
    if admin is not None and admin.role != UserRole.ADMIN:
        log.warning("AICO_BOOTSTRAP_ADMIN_EMAIL %s belongs to a %s account; leaving it alone", email, admin.role)
        return []
    if admin is None:
        # The original (oldest) admin is the one .env owns.
        admin = db.scalar(select(User).where(User.role == UserRole.ADMIN).order_by(User.created_at).limit(1))
    if admin is None:
        db.add(User(email=email, full_name="Administrator", role=UserRole.ADMIN, password_hash=hash_password(password)))
        return ["created"]

    changes = []
    if admin.email != email:
        changes.append(f"email {admin.email} -> {email}")
        admin.email = email
    if not verify_password(password, admin.password_hash):
        admin.password_hash = hash_password(password)
        changes.append("password")
    if changes:
        audit.record(
            db,
            action="user.updated",
            entity_type="user",
            entity_id=admin.id,
            message=f"Admin login updated from backend/.env: {', '.join(changes)}",
            details={"fields": ["email" if c.startswith("email") else c for c in changes]},
        )
    return changes

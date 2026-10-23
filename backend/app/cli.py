"""Operational commands.

python -m app.cli sync-catalog                 # load/refresh departments and agents
python -m app.cli create-user EMAIL ROLE [--client-id ID] [--name NAME]
    # password is read from AICO_NEW_USER_PASSWORD, or prompted for
python -m app.cli bootstrap                    # sync catalog + create the first admin if none exists
"""

import argparse
import getpass
import os
import sys
import uuid

from sqlalchemy import select

from app.agents.catalog import sync_catalog
from app.config import get_settings
from app.db import session_scope
from app.models import User, UserRole
from app.security import hash_password


def _create_user(email: str, role: str, password: str, name: str, client_id: str | None) -> None:
    with session_scope() as db:
        if db.scalar(select(User).where(User.email == email.lower())):
            print(f"user {email} already exists")
            return
        db.add(
            User(
                email=email.lower(),
                full_name=name,
                role=role,
                password_hash=hash_password(password),
                client_id=uuid.UUID(client_id) if client_id else None,
            )
        )
    print(f"created {role} {email}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sync-catalog")
    sub.add_parser("bootstrap")
    create = sub.add_parser("create-user")
    create.add_argument("email")
    create.add_argument("role", choices=[r.value for r in UserRole])
    create.add_argument("--name", default="")
    create.add_argument("--client-id")
    args = parser.parse_args(argv)

    if args.command in ("sync-catalog", "bootstrap"):
        with session_scope() as db:
            print("catalog:", sync_catalog(db))
    if args.command == "bootstrap":
        settings = get_settings()
        with session_scope() as db:
            has_admin = db.scalar(select(User).where(User.role == UserRole.ADMIN))
        if not has_admin:
            if settings.env == "production" and settings.bootstrap_admin_password == "admin-change-me":
                print("refusing to create the default admin password in production; set AICO_BOOTSTRAP_ADMIN_PASSWORD")
                return 1
            _create_user(
                settings.bootstrap_admin_email, UserRole.ADMIN, settings.bootstrap_admin_password, "Administrator", None
            )
    if args.command == "create-user":
        password = os.environ.get("AICO_NEW_USER_PASSWORD") or getpass.getpass("Password: ")
        if len(password) < 10:
            print("password must be at least 10 characters")
            return 1
        _create_user(args.email, args.role, password, args.name or args.email, args.client_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())

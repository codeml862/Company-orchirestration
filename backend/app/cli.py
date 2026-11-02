"""Operational commands.

python -m app.cli sync-catalog                 # load/refresh departments and agents
python -m app.cli create-user EMAIL ROLE [--client-id ID] [--name NAME]
    # password is read from AICO_NEW_USER_PASSWORD, or prompted for
python -m app.cli bootstrap                    # sync catalog + create the first admin if none exists
python -m app.cli autopilot                    # decide pending approvals once (workers do it continuously)
python -m app.cli export-workspace [PROJECT_ID]  # rewrite readable project folders (data/workspaces)
"""

import argparse
import getpass
import os
import sys
import uuid

from sqlalchemy import select

from app.agents.catalog import sync_catalog
from app.bootstrap import BootstrapError, sync_bootstrap_admin
from app.config import get_settings
from app.db import session_scope
from app.governance import autopilot
from app.governance.retention import purge_expired
from app.models import Project, User, UserRole
from app.security import hash_password
from app.workspace import export_workspace


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
    sub.add_parser("purge-expired")
    sub.add_parser("autopilot")
    export = sub.add_parser("export-workspace")
    export.add_argument("project_id", nargs="?", help="default: every project")
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
        try:
            with session_scope() as db:
                changes = sync_bootstrap_admin(db, get_settings())
        except BootstrapError as exc:
            print(exc)
            return 1
        print("admin:", ", ".join(changes) or "up to date")
    if args.command == "purge-expired":
        with session_scope() as db:
            print(f"deleted {purge_expired(db)} expired project(s)")
    if args.command == "autopilot":
        with session_scope() as db:
            print("autopilot:", autopilot.sweep(db))
    if args.command == "export-workspace":
        with session_scope() as db:
            ids = [uuid.UUID(args.project_id)] if args.project_id else db.scalars(select(Project.id)).all()
            for project_id in ids:
                print("exported:", export_workspace(db, project_id) or f"{project_id} not found")
    if args.command == "create-user":
        password = os.environ.get("AICO_NEW_USER_PASSWORD") or getpass.getpass("Password: ")
        if len(password) < 10:
            print("password must be at least 10 characters")
            return 1
        _create_user(args.email, args.role, password, args.name or args.email, args.client_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())

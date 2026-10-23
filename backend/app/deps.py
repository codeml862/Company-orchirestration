"""FastAPI dependencies: authentication, role checks and tenant isolation."""

import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Project, User, UserRole
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)

STAFF_ROLES = (UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.OPERATOR)
SUPERVISOR_ROLES = (UserRole.ADMIN, UserRole.SUPERVISOR)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return user_from_token(credentials.credentials, db)


def user_from_token(token: str, db: Session) -> User:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found or inactive")
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
        return user

    return checker


require_staff = require_roles(*STAFF_ROLES)
require_supervisor = require_roles(*SUPERVISOR_ROLES)
require_admin = require_roles(UserRole.ADMIN)


def is_staff(user: User) -> bool:
    return user.role in STAFF_ROLES


def get_project_for_user(db: Session, project_id: uuid.UUID, user: User) -> Project:
    """Load a project, enforcing tenant isolation: clients only ever see their own projects."""
    project = db.get(Project, project_id)
    if project is None or (not is_staff(user) and project.client_id != user.client_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    return project

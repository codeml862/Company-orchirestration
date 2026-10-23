"""Live operations feed.

Streams the audit log as Server-Sent Events. The cursor is the audit log id, so a client
that reconnects (EventSource sends Last-Event-ID) resumes exactly where it stopped and never
misses an event. Works across any number of API replicas because Postgres is the source.
"""

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db, session_factory
from app.deps import current_user, get_project_for_user, is_staff, user_from_token
from app.models import AuditLog, Project, User
from app.schemas import AuditOut

router = APIRouter(prefix="/api", tags=["events"])

POLL_SECONDS = 1.0
KEEPALIVE_SECONDS = 15.0


def _query(user: User, after_id: int, project_id: uuid.UUID | None, limit: int):
    stmt = select(AuditLog).where(AuditLog.id > after_id)
    if project_id:
        stmt = stmt.where(AuditLog.project_id == project_id)
    if not is_staff(user):
        own_projects = select(Project.id).where(Project.client_id == user.client_id)
        stmt = stmt.where(AuditLog.project_id.in_(own_projects), AuditLog.action.like("project.%"))
    return stmt.order_by(AuditLog.id).limit(limit)


@router.get("/events", response_model=list[AuditOut])
def list_events(
    after_id: int = 0,
    project_id: uuid.UUID | None = None,
    severity: str | None = None,
    limit: int = Query(default=100, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if project_id:
        get_project_for_user(db, project_id, user)
    stmt = _query(user, after_id, project_id, limit)
    if severity:
        stmt = stmt.where(AuditLog.severity == severity)
    if after_id == 0:  # initial load: most recent events, oldest first
        latest = list(db.scalars(stmt.order_by(None).order_by(AuditLog.id.desc())))
        return list(reversed(latest))
    return db.scalars(stmt).all()


@router.get("/events/stream")
async def stream(
    request: Request,
    token: str = Query(..., description="Access token (EventSource cannot send headers)"),
    project_id: uuid.UUID | None = None,
    after_id: int = 0,
    last_event_id: str | None = Header(default=None),
):
    def authenticate() -> tuple[User, int]:
        with session_factory()() as db:
            user = user_from_token(token, db)
            if project_id:
                get_project_for_user(db, project_id, user)
            cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else after_id
            if cursor == 0:
                cursor = db.scalar(select(AuditLog.id).order_by(AuditLog.id.desc()).limit(1)) or 0
            db.expunge(user)
            return user, cursor

    user, cursor = await run_in_threadpool(authenticate)

    def fetch(after: int) -> list[dict]:
        with session_factory()() as db:
            rows = db.scalars(_query(user, after, project_id, 200)).all()
            return [AuditOut.model_validate(r).model_dump(mode="json") for r in rows]

    async def events():
        nonlocal cursor
        idle = 0.0
        yield "retry: 3000\n\n"
        while not await request.is_disconnected():
            rows = await run_in_threadpool(fetch, cursor)
            for row in rows:
                cursor = row["id"]
                yield f"id: {row['id']}\nevent: audit\ndata: {json.dumps(row)}\n\n"
            if rows:
                idle = 0.0
            else:
                idle += POLL_SECONDS
                if idle >= KEEPALIVE_SECONDS:
                    idle = 0.0
                    yield ": keepalive\n\n"
                await asyncio.sleep(POLL_SECONDS)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

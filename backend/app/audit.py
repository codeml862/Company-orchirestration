"""Audit trail and live event publishing.

Every state change is written to `audit_logs` inside the caller's transaction, so the
audit trail can never disagree with the data. After commit, events are also published to
Redis so dashboards update live; if Redis is down, clients fall back to polling the table.
"""

import json
import logging
import uuid
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AuditLog

log = logging.getLogger(__name__)

EVENTS_CHANNEL = "aico:events"
_PENDING_KEY = "aico_pending_events"

_redis = None


def _redis_client():
    global _redis
    if _redis is None:
        import redis

        _redis = redis.Redis.from_url(get_settings().redis_url, socket_timeout=2, socket_connect_timeout=2)
    return _redis


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    actor_type: str = "system",
    actor_id: Any = None,
    project_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    message: str = "",
    severity: str = "info",
    details: dict | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_type=actor_type,
        actor_id=str(actor_id) if actor_id is not None else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        project_id=project_id,
        client_id=client_id,
        severity=severity,
        message=message,
        details=details or {},
    )
    db.add(entry)
    db.info.setdefault(_PENDING_KEY, []).append(entry)
    return entry


def serialize(entry: AuditLog) -> dict:
    return {
        "id": entry.id,
        "actor_type": entry.actor_type,
        "actor_id": entry.actor_id,
        "action": entry.action,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "project_id": str(entry.project_id) if entry.project_id else None,
        "client_id": str(entry.client_id) if entry.client_id else None,
        "severity": entry.severity,
        "message": entry.message,
        "details": entry.details,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


@event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    try:
        client = _redis_client()
        for entry in pending:
            client.publish(EVENTS_CHANNEL, json.dumps(serialize(entry), default=str))
    except Exception as exc:  # live push is best-effort; the audit table is the source of truth
        log.debug("event publish skipped: %s", exc)


@event.listens_for(Session, "after_rollback")
def _discard_after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)

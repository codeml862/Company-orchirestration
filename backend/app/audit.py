"""Append-only audit trail.

Every state change is written to `audit_logs` inside the caller's transaction, so the audit
trail can never disagree with the data. The live operations timeline streams this table
(see app/api/events.py), so whatever the dashboard shows is exactly what was recorded.
"""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


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
    return entry

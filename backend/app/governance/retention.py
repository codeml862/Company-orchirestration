"""Data retention and deletion.

Each client has `data_retention_days`. Finished projects older than that are deleted with all
their tasks, executions, messages, approvals, files and project-level audit entries. A
client-level audit entry records that the deletion happened (but not the deleted content).
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.models import Artifact, Client, Project, ProjectStatus, utcnow
from app.storage import get_storage

FINISHED = (ProjectStatus.COMPLETED, ProjectStatus.CANCELLED, ProjectStatus.FAILED)


class RetentionError(Exception):
    pass


def delete_project(db: Session, project: Project, *, actor_type: str, actor_id=None, reason: str) -> None:
    if project.status not in FINISHED:
        raise RetentionError(f"only finished projects can be deleted (project is {project.status}); cancel it first")
    storage = get_storage()
    for key in db.scalars(select(Artifact.storage_key).where(Artifact.project_id == project.id)):
        storage.delete(key)
    project_id, client_id, title = project.id, project.client_id, project.title
    db.delete(project)  # the database cascades to every row that belongs to the project
    db.flush()
    audit.record(
        db,
        action="project.deleted",
        entity_type="project",
        entity_id=project_id,
        actor_type=actor_type,
        actor_id=actor_id,
        client_id=client_id,
        severity="warning",
        message=f"Project deleted: {title} ({reason})",
        details={"reason": reason},
    )


def purge_expired(db: Session) -> int:
    now = utcnow()
    expired = []
    for project, retention_days in db.execute(
        select(Project, Client.data_retention_days)
        .join(Client, Client.id == Project.client_id)
        .where(Project.status.in_(FINISHED), Project.completed_at.is_not(None))
    ):
        if project.completed_at < now - timedelta(days=retention_days):
            expired.append(project)
    for project in expired:
        delete_project(db, project, actor_type="system", reason="retention period expired")
    return len(expired)

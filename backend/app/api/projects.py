import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import current_user, get_project_for_user, is_staff, require_staff
from app.governance.controls import ControlError, cancel_project, pause_project, resume_project
from app.models import (
    AgentMessage,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    Artifact,
    ArtifactKind,
    AuditLog,
    Client,
    Department,
    Project,
    ProjectStatus,
    Task,
    TaskDependency,
    TaskKind,
    TaskStatus,
    User,
)
from app.orchestration.engine import EngineError, submit_project
from app.schemas import (
    ArtifactOut,
    AuditOut,
    FeedbackIn,
    MessageOut,
    ProjectCreate,
    ProjectSummary,
    TaskOut,
)
from app.storage import read_artifact, save_artifact

router = APIRouter(prefix="/api", tags=["projects"])

CLIENT_TIMELINE_ACTIONS = ("project.%", "approval.%", "task.approved")
ALLOWED_UPLOAD_TYPES = (
    "text/",
    "application/json",
    "application/pdf",
    "application/csv",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "image/png",
    "image/jpeg",
)


def _summary(db: Session, project: Project) -> ProjectSummary:
    counts = dict(
        db.execute(select(Task.status, func.count()).where(Task.project_id == project.id).group_by(Task.status)).all()
    )
    pending = db.execute(
        select(Approval.kind, func.count())
        .where(Approval.project_id == project.id, Approval.status == ApprovalStatus.PENDING)
        .group_by(Approval.kind)
    ).all()
    client = db.get(Client, project.client_id)
    return ProjectSummary.model_validate(
        {
            **{c: getattr(project, c) for c in ProjectSummary.model_fields if hasattr(project, c)},
            "client_name": client.name if client else "",
            "task_counts": counts,
            "pending_approvals": sum(n for _, n in pending),
            "needs_client_input": any(kind == ApprovalKind.CLARIFICATION for kind, _ in pending),
        }
    )


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(
    status: str | None = None,
    client_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    stmt = select(Project).order_by(Project.created_at.desc())
    if not is_staff(user):
        stmt = stmt.where(Project.client_id == user.client_id)
    elif client_id:
        stmt = stmt.where(Project.client_id == client_id)
    if status:
        stmt = stmt.where(Project.status == status)
    return [_summary(db, p) for p in db.scalars(stmt.limit(500))]


@router.post("/projects", response_model=ProjectSummary, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if is_staff(user):
        if body.client_id is None or db.get(Client, body.client_id) is None:
            raise HTTPException(422, "staff must specify an existing client_id")
        client_id = body.client_id
    else:
        client_id = user.client_id
    project = Project(
        client_id=client_id,
        title=body.title,
        request=body.request,
        requested_deliverables=body.requested_deliverables,
        priority=body.priority,
        budget_usd=body.budget_usd,
        budget_tokens=body.budget_tokens,
        deadline=body.deadline,
        created_by_id=user.id,
    )
    db.add(project)
    db.flush()
    audit.record(
        db,
        action="project.created",
        entity_type="project",
        entity_id=project.id,
        actor_type="user",
        actor_id=user.id,
        project_id=project.id,
        client_id=client_id,
        message=f"Project created: {project.title}",
    )
    if body.submit:
        try:
            submit_project(db, project, actor_user_id=user.id)
        except EngineError as exc:
            raise HTTPException(409, str(exc)) from exc
    db.commit()
    return _summary(db, project)


@router.get("/projects/{project_id}", response_model=ProjectSummary)
def get_project(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _summary(db, get_project_for_user(db, project_id, user))


@router.post("/projects/{project_id}/submit", response_model=ProjectSummary)
def submit(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = get_project_for_user(db, project_id, user)
    if db.scalar(select(func.count()).select_from(Task).where(Task.project_id == project.id)):
        raise HTTPException(409, "project was already submitted")
    try:
        submit_project(db, project, actor_user_id=user.id)
    except EngineError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.commit()
    return _summary(db, project)


def _control(db: Session, project_id: uuid.UUID, user: User, action) -> ProjectSummary:
    project = get_project_for_user(db, project_id, user)
    try:
        action(db, project, user.id)
    except ControlError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.commit()
    return _summary(db, project)


@router.post("/projects/{project_id}/pause", response_model=ProjectSummary)
def pause(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    return _control(db, project_id, user, pause_project)


@router.post("/projects/{project_id}/resume", response_model=ProjectSummary)
def resume(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    return _control(db, project_id, user, resume_project)


@router.post("/projects/{project_id}/cancel", response_model=ProjectSummary)
def cancel(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    return _control(db, project_id, user, cancel_project)


@router.post("/projects/{project_id}/feedback", response_model=ProjectSummary)
def feedback(
    project_id: uuid.UUID, body: FeedbackIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    project = get_project_for_user(db, project_id, user)
    if is_staff(user):
        raise HTTPException(403, "satisfaction feedback comes from the client")
    if project.status != ProjectStatus.COMPLETED:
        raise HTTPException(409, "feedback can be given once the project is completed")
    project.satisfaction_score = body.score
    project.satisfaction_comment = body.comment
    audit.record(
        db,
        action="project.feedback",
        entity_type="project",
        entity_id=project.id,
        actor_type="user",
        actor_id=user.id,
        project_id=project.id,
        client_id=project.client_id,
        message=f"Client satisfaction: {body.score}/5",
    )
    db.commit()
    return _summary(db, project)


@router.get("/projects/{project_id}/tasks")
def project_tasks(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = get_project_for_user(db, project_id, user)
    tasks = list(db.scalars(select(Task).where(Task.project_id == project.id).order_by(Task.created_at)))
    if not is_staff(user):
        departments = {d.id: d.name for d in db.scalars(select(Department))}
        return [
            {
                "id": str(t.id),
                "title": t.title,
                "kind": t.kind,
                "status": t.status,
                "department": departments.get(t.department_id),
                "started_at": t.started_at,
                "completed_at": t.completed_at,
            }
            for t in tasks
            if t.kind in (TaskKind.ANALYZE, TaskKind.PLAN, TaskKind.EXECUTE, TaskKind.FINAL_REPORT)
        ]
    edges = db.execute(
        select(TaskDependency.task_id, TaskDependency.depends_on_id).where(
            TaskDependency.task_id.in_([t.id for t in tasks])
        )
    ).all()
    depends: dict[uuid.UUID, list[uuid.UUID]] = {}
    for task_id, dep_id in edges:
        depends.setdefault(task_id, []).append(dep_id)
    return [TaskOut.model_validate(t).model_copy(update={"depends_on": depends.get(t.id, [])}) for t in tasks]


@router.get("/projects/{project_id}/timeline", response_model=list[AuditOut])
def timeline(
    project_id: uuid.UUID,
    after_id: int = 0,
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    project = get_project_for_user(db, project_id, user)
    stmt = select(AuditLog).where(AuditLog.project_id == project.id, AuditLog.id > after_id)
    if not is_staff(user):
        stmt = stmt.where(or_(*[AuditLog.action.like(a) for a in CLIENT_TIMELINE_ACTIONS]))
    return db.scalars(stmt.order_by(AuditLog.id).limit(limit)).all()


@router.get("/projects/{project_id}/messages", response_model=list[MessageOut])
def messages(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    project = get_project_for_user(db, project_id, user)
    return db.scalars(
        select(AgentMessage).where(AgentMessage.project_id == project.id).order_by(AgentMessage.created_at)
    ).all()


def _client_visible(db: Session, project: Project):
    """Clients see their own uploads, and the deliverables once the project is completed."""
    conditions = [Artifact.kind == ArtifactKind.INPUT]
    if project.status == ProjectStatus.COMPLETED:
        approved_execute = select(Task.id).where(
            Task.project_id == project.id, Task.kind == TaskKind.EXECUTE, Task.status == TaskStatus.APPROVED
        )
        conditions += [Artifact.kind == ArtifactKind.DELIVERABLE, Artifact.task_id.in_(approved_execute)]
    return select(Artifact).where(Artifact.project_id == project.id, or_(*conditions))


@router.get("/projects/{project_id}/artifacts", response_model=list[ArtifactOut])
def artifacts(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = get_project_for_user(db, project_id, user)
    stmt = select(Artifact).where(Artifact.project_id == project.id) if is_staff(user) else _client_visible(db, project)
    return db.scalars(stmt.order_by(Artifact.created_at)).all()


@router.post("/projects/{project_id}/files", response_model=ArtifactOut, status_code=201)
async def upload(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    project = get_project_for_user(db, project_id, user)
    if project.status in (ProjectStatus.COMPLETED, ProjectStatus.CANCELLED):
        raise HTTPException(409, f"project is {project.status}")
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip()
    if not content_type.startswith(ALLOWED_UPLOAD_TYPES):
        raise HTTPException(415, f"file type {content_type} is not accepted")
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, "file too large")
    artifact = save_artifact(
        db,
        project_id=project.id,
        kind=ArtifactKind.INPUT,
        name=file.filename or "upload",
        data=data,
        content_type=content_type,
    )
    audit.record(
        db,
        action="project.file_uploaded",
        entity_type="artifact",
        entity_id=artifact.id,
        actor_type="user",
        actor_id=user.id,
        project_id=project.id,
        client_id=project.client_id,
        message=f"File uploaded: {artifact.name}",
    )
    db.commit()
    return artifact


@router.get("/artifacts/{artifact_id}/download")
def download(artifact_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    artifact = db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(404, "file not found")
    project = get_project_for_user(db, artifact.project_id, user)
    if not is_staff(user) and db.scalar(_client_visible(db, project).where(Artifact.id == artifact.id)) is None:
        raise HTTPException(404, "file not found")
    safe_name = artifact.name.replace('"', "").replace("\n", "")
    return Response(
        content=read_artifact(artifact),
        # Always served as a download so user-supplied HTML/SVG can never run in the app's origin.
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
            "X-Original-Content-Type": artifact.content_type,
        },
    )

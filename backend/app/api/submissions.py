"""Final submissions: each project's final report, delivered work, and who sent what to whom."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user, get_project_for_user, is_staff
from app.models import (
    Agent,
    AgentMessage,
    Approval,
    ApprovalKind,
    ApprovalStatus,
    Artifact,
    ArtifactKind,
    Client,
    Project,
    ProjectStatus,
    Task,
    TaskKind,
    TaskStatus,
    User,
)
from app.workspace import artifact_paths

router = APIRouter(prefix="/api", tags=["submissions"])


class Submission(BaseModel):
    """Where the final delivery stands: submitted to the client, waiting for release, or not ready yet."""

    state: str  # submitted | awaiting_release | returned | not_ready
    submitted_at: datetime | None = None
    released_by: str | None = None
    note: str | None = None


class SubmissionSummary(BaseModel):
    project_id: uuid.UUID
    title: str
    client_name: str
    status: str
    objective_met: bool | None
    executive_summary: str | None
    files: int
    tokens_used: int
    spent_usd: str
    created_at: datetime
    submission: Submission


class SubmittedFile(BaseModel):
    id: uuid.UUID
    name: str
    path: str  # where it sits in the project's folder structure
    kind: str
    size_bytes: int
    created_at: datetime
    author: str | None
    task_title: str | None


class Handoff(BaseModel):
    """One step of the work: an agent (or the client) sending an assignment, result or review to another."""

    at: datetime
    type: str  # assignment | result | review | escalation | submission
    sender: str
    sender_department: str | None
    recipient: str
    recipient_department: str | None
    what: str
    summary: str | None
    status: str | None
    files: list[str] = []


class SubmissionDetail(SubmissionSummary):
    request: str
    objective: str | None
    completed_at: datetime | None
    final_report: dict | None
    deliverables: list[SubmittedFile]
    handoffs: list[Handoff]


def _submission(db: Session, project: Project) -> Submission:
    approval = db.scalars(
        select(Approval)
        .where(Approval.project_id == project.id, Approval.kind == ApprovalKind.FINAL_DELIVERY)
        .order_by(Approval.created_at.desc())
    ).first()
    if project.status == ProjectStatus.COMPLETED:
        released_by = None
        if approval and approval.status == ApprovalStatus.APPROVED:
            user = db.get(User, approval.decided_by_id) if approval.decided_by_id else None
            released_by = user.full_name if user else "Autopilot"
        return Submission(
            state="submitted",
            submitted_at=project.completed_at or (approval.decided_at if approval else None),
            released_by=released_by,
            note=approval.decision_note if approval else None,
        )
    if approval and approval.status == ApprovalStatus.PENDING:
        return Submission(state="awaiting_release", note="The final report is ready and waiting for release.")
    if approval and approval.status == ApprovalStatus.REJECTED:
        return Submission(state="returned", note=approval.decision_note or "Sent back to the CEO agent for revision.")
    return Submission(state="not_ready")


def _visible_files(db: Session, project: Project, staff: bool) -> list[Artifact]:
    """Delivered work: the final report and the work products QA approved (clients see them once submitted)."""
    approved = select(Task.id).where(
        Task.project_id == project.id, Task.kind == TaskKind.EXECUTE, Task.status == TaskStatus.APPROVED
    )
    stmt = select(Artifact).where(
        Artifact.project_id == project.id,
        (Artifact.kind == ArtifactKind.DELIVERABLE)
        | ((Artifact.kind == ArtifactKind.WORK) & Artifact.task_id.in_(approved)),
    )
    if not staff and project.status != ProjectStatus.COMPLETED:
        return []
    return list(db.scalars(stmt.order_by(Artifact.kind.desc(), Artifact.created_at)))


def _summary(db: Session, project: Project, staff: bool) -> SubmissionSummary:
    client = db.get(Client, project.client_id)
    report = project.final_report or {}
    return SubmissionSummary(
        project_id=project.id,
        title=project.title,
        client_name=client.name if client else "",
        status=project.status,
        objective_met=report.get("objective_met"),
        executive_summary=report.get("executive_summary"),
        files=len(_visible_files(db, project, staff)),
        tokens_used=project.tokens_used,
        spent_usd=str(project.spent_usd),
        created_at=project.created_at,
        submission=_submission(db, project),
    )


@router.get("/submissions", response_model=list[SubmissionSummary])
def list_submissions(db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(Project).where(Project.final_report.is_not(None))
    if not is_staff(user):
        stmt = stmt.where(Project.client_id == user.client_id, Project.status == ProjectStatus.COMPLETED)
    projects = db.scalars(stmt.order_by(Project.updated_at.desc())).all()
    return [_summary(db, p, is_staff(user)) for p in projects]


@router.get("/submissions/{project_id}", response_model=SubmissionDetail)
def get_submission(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    project = get_project_for_user(db, project_id, user)
    staff = is_staff(user)
    agents = {a.id: a for a in db.scalars(select(Agent))}
    tasks = {t.id: t for t in db.scalars(select(Task).where(Task.project_id == project.id))}
    files = _visible_files(db, project, staff)
    # Same paths as the readable project folder (data/workspaces), so both show one structure.
    paths = artifact_paths(
        list(db.scalars(select(Artifact).where(Artifact.project_id == project.id).order_by(Artifact.created_at)))
    )
    client = db.get(Client, project.client_id)
    client_name = client.name if client else "Client"

    def who(agent_id, nobody: str = client_name) -> tuple[str, str | None]:
        """An agent's name and department; `nobody` names the party when there is no agent."""
        agent = agents.get(agent_id)
        if agent is None:
            return nobody, None
        return agent.name, agent.department.name if agent.department else None

    files_by_task: dict[uuid.UUID, list[str]] = {}
    for f in files:
        if f.task_id:
            files_by_task.setdefault(f.task_id, []).append(paths.get(f.id, f.name))

    handoffs: list[Handoff] = []
    if staff:  # clients see what was delivered, not the internal back-and-forth
        for m in db.scalars(
            select(AgentMessage).where(AgentMessage.project_id == project.id).order_by(AgentMessage.created_at)
        ):
            sender, sender_dept = who(m.sender_agent_id)
            # The client starts the work; results with no agent above them go to the platform, not the client.
            recipient, recipient_dept = who(m.recipient_agent_id, "Orchestria")
            task = tasks.get(m.task_id) if m.task_id else None
            payload = m.payload or {}
            handoffs.append(
                Handoff(
                    at=m.created_at,
                    type=m.message_type,
                    sender=sender,
                    sender_department=sender_dept,
                    recipient=recipient,
                    recipient_department=recipient_dept,
                    what=(task.title if task else None) or payload.get("title") or m.objective[:200],
                    summary=payload.get("summary") or payload.get("feedback"),
                    status=payload.get("status") or payload.get("verdict"),
                    files=files_by_task.get(m.task_id, []) if m.message_type == "result" and m.task_id else [],
                )
            )
    submission = _submission(db, project)
    if submission.state == "submitted":
        final = next((t for t in tasks.values() if t.kind == TaskKind.FINAL_REPORT), None)
        sender, sender_dept = who(final.assigned_agent_id) if final else ("CEO Agent", None)
        handoffs.append(
            Handoff(
                at=submission.submitted_at or project.updated_at,
                type="submission",
                sender=sender,
                sender_department=sender_dept,
                recipient=client_name,
                recipient_department=None,
                what="Final submission",
                summary=f"Final report and {len(files)} file(s) delivered"
                + (f", released by {submission.released_by}" if submission.released_by else ""),
                status="submitted",
                files=[paths.get(f.id, f.name) for f in files],
            )
        )

    authors = {f.id: who(f.agent_id)[0] if f.agent_id else None for f in files}
    summary = _summary(db, project, staff)
    return SubmissionDetail(
        **summary.model_dump(),
        request=project.request,
        objective=project.objective,
        completed_at=project.completed_at,
        final_report=project.final_report,
        deliverables=[
            SubmittedFile(
                id=f.id,
                name=f.name,
                path=paths.get(f.id, f.name),
                kind=f.kind,
                size_bytes=f.size_bytes,
                created_at=f.created_at,
                author=authors[f.id],
                task_title=tasks[f.task_id].title if f.task_id in tasks else None,
            )
            for f in files
        ],
        handoffs=handoffs,
    )

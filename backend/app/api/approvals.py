import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import SUPERVISOR_ROLES, current_user, get_project_for_user, is_staff
from app.governance.approvals import ApprovalError, decide
from app.models import Approval, ApprovalKind, Project, User
from app.schemas import ApprovalOut, DecisionIn

router = APIRouter(prefix="/api", tags=["approvals"])


def _can_decide(user: User, approval: Approval) -> bool:
    if user.role in SUPERVISOR_ROLES:
        return True
    # Operators and the project's client may answer clarification questions, nothing else.
    return approval.kind == ApprovalKind.CLARIFICATION


@router.get("/approvals", response_model=list[ApprovalOut])
def list_approvals(
    status: str | None = "pending",
    project_id: uuid.UUID | None = None,
    kind: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    stmt = select(Approval).order_by(Approval.created_at.desc())
    if status:
        stmt = stmt.where(Approval.status == status)
    if project_id:
        get_project_for_user(db, project_id, user)
        stmt = stmt.where(Approval.project_id == project_id)
    if kind:
        stmt = stmt.where(Approval.kind == kind)
    if not is_staff(user):
        stmt = stmt.where(
            Approval.kind == ApprovalKind.CLARIFICATION,
            Approval.project_id.in_(select(Project.id).where(Project.client_id == user.client_id)),
        )
    return db.scalars(stmt.limit(500)).all()


@router.post("/approvals/{approval_id}/decide", response_model=ApprovalOut)
def decide_approval(
    approval_id: uuid.UUID, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    approval = db.get(Approval, approval_id, with_for_update=True)
    if approval is None:
        raise HTTPException(404, "approval not found")
    get_project_for_user(db, approval.project_id, user)
    if not _can_decide(user, approval):
        raise HTTPException(403, "only a supervisor can make this decision")
    try:
        decide(db, approval, user_id=user.id, approve=body.approve, note=body.note)
    except ApprovalError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.commit()
    return approval

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_staff
from app.governance.controls import ControlError, cancel_task, reassign_task, retry_task
from app.models import Agent, AgentMessage, Department, Execution, Review, Task, TaskDependency, User
from app.schemas import ExecutionOut, MessageOut, ReassignIn, ReviewOut, TaskDetail, TaskOut

router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    status: list[str] | None = Query(default=None),
    project_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    department: str | None = None,
    kind: str | None = None,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    stmt = select(Task).order_by(Task.updated_at.desc())
    if status:
        stmt = stmt.where(Task.status.in_(status))
    if project_id:
        stmt = stmt.where(Task.project_id == project_id)
    if agent_id:
        stmt = stmt.where(Task.assigned_agent_id == agent_id)
    if kind:
        stmt = stmt.where(Task.kind == kind)
    if department:
        stmt = stmt.join(Department, Department.id == Task.department_id).where(Department.key == department)
    return db.scalars(stmt.limit(limit)).all()


def _get_task(db: Session, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "task not found")
    return task


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def get_task(task_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_staff)):
    task = _get_task(db, task_id)
    depends_on = list(db.scalars(select(TaskDependency.depends_on_id).where(TaskDependency.task_id == task.id)))
    executions = db.scalars(select(Execution).where(Execution.task_id == task.id).order_by(Execution.started_at)).all()
    reviews = db.scalars(select(Review).where(Review.task_id == task.id).order_by(Review.created_at)).all()
    messages = db.scalars(
        select(AgentMessage).where(AgentMessage.task_id == task.id).order_by(AgentMessage.created_at)
    ).all()
    return TaskDetail(
        **TaskOut.model_validate(task).model_dump(exclude={"depends_on"}),
        depends_on=depends_on,
        executions=[ExecutionOut.model_validate(e) for e in executions],
        reviews=[ReviewOut.model_validate(r) for r in reviews],
        messages=[MessageOut.model_validate(m) for m in messages],
    )


def _apply(db: Session, action) -> None:
    try:
        action()
    except ControlError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.commit()


@router.post("/tasks/{task_id}/retry", response_model=TaskOut)
def retry(task_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    task = _get_task(db, task_id)
    _apply(db, lambda: retry_task(db, task, user.id))
    return task


@router.post("/tasks/{task_id}/cancel", response_model=TaskOut)
def cancel(task_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    task = _get_task(db, task_id)
    _apply(db, lambda: cancel_task(db, task, user.id))
    return task


@router.post("/tasks/{task_id}/reassign", response_model=TaskOut)
def reassign(task_id: uuid.UUID, body: ReassignIn, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    task = _get_task(db, task_id)
    agent = db.get(Agent, body.agent_id)
    if agent is None:
        raise HTTPException(404, "agent not found")
    _apply(db, lambda: reassign_task(db, task, agent, user.id))
    return task

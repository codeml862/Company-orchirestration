"""Agent communication protocol: the structured task envelope.

Every assignment is sent to an agent as one envelope with the fields the specification
requires (project, task, sender, recipient, objective, context, inputs, output schema,
dependencies, deadline, priority, status, validation requirements). The context is built on
a need-to-know basis: an agent only receives what its task needs.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.schemas import OUTPUT_SCHEMAS
from app.models import (
    Agent,
    AgentMessage,
    AgentRole,
    Artifact,
    Department,
    Execution,
    ExecutionStatus,
    Project,
    Review,
    Task,
    TaskDependency,
    TaskKind,
    TaskStatus,
)
from app.storage import is_text, read_artifact

PROTOCOL_VERSION = "aico.task.v1"
MAX_DELIVERABLE_CHARS = 8000
MAX_CONTEXT_RESULTS = 30

VALIDATION_REQUIREMENTS: dict[str, list[str]] = {
    TaskKind.ANALYZE: [
        "Output must match required_output_schema.",
        "departments must be keys from context.available_departments.",
    ],
    TaskKind.PLAN: [
        "Output must match required_output_schema.",
        "Package refs must be unique; depends_on must reference existing refs without cycles.",
        "Departments must be keys from context.available_departments (not 'executive').",
    ],
    TaskKind.ALLOCATE: [
        "Output must match required_output_schema.",
        "agent_key must be a member of context.team; refs unique; depends_on acyclic.",
    ],
    TaskKind.EXECUTE: [
        "Output must match required_output_schema.",
        "Every evidence tool_call_id must refer to a tool call actually made in this attempt.",
        "self_assessment must cover every acceptance criterion.",
        "The output will be independently reviewed by Quality Assurance.",
    ],
    TaskKind.REVIEW: [
        "Output must match required_output_schema.",
        "verdict 'approved' requires every criterion to be met; 'rejected' requires feedback.",
    ],
    TaskKind.CONSOLIDATE: ["Output must match required_output_schema."],
    TaskKind.FINAL_REPORT: ["Output must match required_output_schema."],
}


def _untrusted(content: str) -> dict:
    return {"untrusted": True, "content": content}


def _department_keys(db: Session) -> list[dict]:
    return [
        {"key": d.key, "name": d.name, "description": d.description}
        for d in db.scalars(select(Department).order_by(Department.sort_order))
    ]


def assignable_team(db: Session, coordinator: Agent) -> list[Agent]:
    """Agents a coordinator may assign to: active direct reports that execute work or coordinate a team.

    Members of a sub-coordinator's team are reached by delegating to that sub-coordinator.
    """
    team = []
    for member in db.scalars(select(Agent).where(Agent.reports_to_id == coordinator.id, Agent.is_active)):
        kinds = set(member.task_kinds or [])
        if TaskKind.EXECUTE in kinds or (
            member.role_type in (AgentRole.SUB_COORDINATOR, AgentRole.COORDINATOR, AgentRole.DIRECTOR)
            and TaskKind.ALLOCATE in kinds
        ):
            team.append(member)
    return team


def reviewers(db: Session) -> list[Agent]:
    return [a for a in db.scalars(select(Agent).where(Agent.is_active)) if TaskKind.REVIEW in (a.task_kinds or [])]


def _artifact_content(artifact: Artifact) -> str:
    if not is_text(artifact.content_type):
        return f"[binary file {artifact.name}, {artifact.size_bytes} bytes]"
    text = read_artifact(artifact).decode("utf-8", errors="replace")
    if len(text) > MAX_DELIVERABLE_CHARS:
        return text[:MAX_DELIVERABLE_CHARS] + f"\n... [truncated, {len(text)} chars total]"
    return text


def task_output_for_context(db: Session, task: Task, include_content: bool = True) -> dict:
    """What downstream agents see of an approved task: summary, deliverables, report."""
    agent = db.get(Agent, task.assigned_agent_id) if task.assigned_agent_id else None
    result = task.result or {}
    entry = {
        "task_id": str(task.id),
        "title": task.title,
        "agent": agent.name if agent else None,
        "summary": result.get("summary") or result.get("executive_summary"),
    }
    if task.kind == TaskKind.CONSOLIDATE:
        entry["report"] = result.get("report")
        entry["status"] = result.get("status")
        entry["open_issues"] = result.get("open_issues", [])
    if task.kind == TaskKind.EXECUTE:
        artifacts = db.scalars(select(Artifact).where(Artifact.task_id == task.id).order_by(Artifact.created_at))
        entry["deliverables"] = [
            {
                "name": a.name,
                "file_id": str(a.id),
                **({"content": _untrusted(_artifact_content(a))} if include_content else {}),
            }
            for a in artifacts
        ]
    return entry


def dependency_tasks(db: Session, task: Task) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .join(TaskDependency, TaskDependency.depends_on_id == Task.id)
            .where(TaskDependency.task_id == task.id)
            .order_by(Task.created_at)
        )
    )


def _approved_results_under(db: Session, consolidate: Task) -> list[dict]:
    """Approved outputs that a CONSOLIDATE task closes (its dependencies, minus the allocation itself)."""
    results = []
    for dep in dependency_tasks(db, consolidate):
        if dep.kind == TaskKind.ALLOCATE or dep.status != TaskStatus.APPROVED:
            continue
        entry = task_output_for_context(db, dep)
        reviews = db.scalars(select(Review).where(Review.task_id == dep.id).order_by(Review.created_at)).all()
        if reviews:
            entry["qa"] = {"attempts": len(reviews), "final_score": reviews[-1].score}
        results.append(entry)
    not_approved = [
        {"title": d.title, "status": d.status}
        for d in dependency_tasks(db, consolidate)
        if d.kind != TaskKind.ALLOCATE and d.status != TaskStatus.APPROVED
    ]
    if not_approved:
        results.append({"not_completed": not_approved})
    return results[:MAX_CONTEXT_RESULTS]


def build_envelope(db: Session, task: Task) -> dict:
    project = db.get(Project, task.project_id)
    assert project is not None
    recipient = db.get(Agent, task.assigned_agent_id) if task.assigned_agent_id else None
    sender = db.get(Agent, task.created_by_agent_id) if task.created_by_agent_id else None
    context: dict = {
        "project_title": project.title,
        "project_objective": project.objective,
        "expected_outcomes": project.expected_outcomes,
    }
    kind = TaskKind(task.kind)

    if kind in (TaskKind.ANALYZE, TaskKind.PLAN):
        context["client_request"] = _untrusted(project.request)
        context["requested_deliverables"] = project.requested_deliverables
        context["budget_usd"] = str(project.budget_usd) if project.budget_usd is not None else None
        context["deadline"] = project.deadline.isoformat() if project.deadline else None
        context["available_departments"] = [d for d in _department_keys(db) if d["key"] != "executive"]
        files = db.scalars(select(Artifact).where(Artifact.project_id == project.id, Artifact.kind == "input"))
        context["client_files"] = [{"name": a.name, "content_type": a.content_type} for a in files]
    if kind == TaskKind.PLAN:
        analysis = next((d for d in dependency_tasks(db, task) if d.kind == TaskKind.ANALYZE), None)
        context["ceo_analysis"] = analysis.result if analysis else None

    if kind == TaskKind.ALLOCATE and recipient is not None:
        context["work_package"] = task.input_data.get("work_package")
        context["team"] = [
            {
                "agent_key": a.key,
                "name": a.name,
                "role": a.role_type,
                "description": a.description,
                "tools": a.allowed_tools,
            }
            for a in assignable_team(db, recipient)
        ]
        context["reviewers"] = [
            {"agent_key": a.key, "name": a.name, "description": a.description} for a in reviewers(db)
        ]
        context["upstream_results"] = [
            task_output_for_context(db, d, include_content=False)
            for d in dependency_tasks(db, task)
            if d.status == TaskStatus.APPROVED
        ]

    if kind == TaskKind.EXECUTE:
        context["work_package"] = task.input_data.get("work_package_title")
        context["upstream_results"] = task.input_data.get("upstream_results", [])
        context["dependency_outputs"] = [
            task_output_for_context(db, d) for d in dependency_tasks(db, task) if d.status == TaskStatus.APPROVED
        ]
        context["previous_feedback"] = task.feedback
        context["note"] = "Use project_files.list to see client files and approved work you can read."

    if kind == TaskKind.REVIEW:
        target = db.get(Task, task.target_task_id)
        assert target is not None
        author = db.get(Agent, target.assigned_agent_id) if target.assigned_agent_id else None
        result = dict(target.result or {})
        result.pop("evidence", None)
        context["work_under_review"] = {
            "task_id": str(target.id),
            "title": target.title,
            "objective": target.objective,
            "acceptance_criteria": target.acceptance_criteria,
            "author": author.name if author else None,
            "attempt": target.attempt_count,
            "output": result,
            "deliverables": task_output_for_context(db, target)["deliverables"],
        }
        context["author_claimed_evidence"] = (target.result or {}).get("evidence", [])
        context["platform_verified_evidence"] = [e for e in target.evidence if e.get("verified_by") == "platform"]
        context["previous_reviews"] = [
            {"attempt": r.attempt, "verdict": r.verdict, "feedback": r.feedback}
            for r in db.scalars(select(Review).where(Review.task_id == target.id).order_by(Review.created_at))
        ]

    if kind == TaskKind.CONSOLIDATE:
        allocation = db.get(Task, task.target_task_id) if task.target_task_id else None
        context["work_package"] = allocation.input_data.get("work_package") if allocation else None
        context["allocation_summary"] = (allocation.result or {}).get("summary") if allocation else None
        context["approved_results"] = _approved_results_under(db, task)

    if kind == TaskKind.FINAL_REPORT:
        context["client_request"] = _untrusted(project.request)
        context["requested_deliverables"] = project.requested_deliverables
        context["department_reports"] = [
            task_output_for_context(db, d) for d in dependency_tasks(db, task) if d.kind == TaskKind.CONSOLIDATE
        ]
        context["delivered_files"] = [
            {"name": a.name, "from_task": str(a.task_id)}
            for a in db.scalars(
                select(Artifact)
                .join(Task, Task.id == Artifact.task_id)
                .where(Artifact.project_id == project.id, Task.status == TaskStatus.APPROVED, Task.kind == "execute")
            )
        ]
        context["metrics"] = project_metrics(db, project.id)
        context["supervisor_feedback"] = task.input_data.get("supervisor_feedback")

    if task.input_data.get("clarifications"):
        context["clarifications"] = task.input_data["clarifications"]

    return {
        "protocol": PROTOCOL_VERSION,
        "project_id": str(project.id),
        "task_id": str(task.id),
        "sender_agent": sender.key if sender else "system",
        "recipient_agent": recipient.key if recipient else None,
        "kind": task.kind,
        "title": task.title,
        "objective": task.objective,
        "context": context,
        "acceptance_criteria": task.acceptance_criteria,
        "required_output_schema": OUTPUT_SCHEMAS[kind],
        "dependencies": [
            {"task_id": str(d.id), "title": d.title, "status": d.status} for d in dependency_tasks(db, task)
        ],
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "priority": task.priority,
        "status": task.status,
        "attempt": task.attempt_count,
        "max_attempts": task.max_attempts,
        "validation_requirements": VALIDATION_REQUIREMENTS[kind],
    }


def project_metrics(db: Session, project_id: uuid.UUID) -> dict:
    tasks = db.scalars(select(Task).where(Task.project_id == project_id)).all()
    executions = db.scalars(select(Execution).where(Execution.project_id == project_id)).all()
    return {
        "tasks_total": len(tasks),
        "tasks_approved": sum(t.status == TaskStatus.APPROVED for t in tasks),
        "tasks_failed": sum(t.status == TaskStatus.FAILED for t in tasks),
        "executions": len(executions),
        "failed_executions": sum(e.status == ExecutionStatus.FAILED for e in executions),
        "tokens": sum(e.prompt_tokens + e.completion_tokens for e in executions),
        "cost_usd": float(sum(e.cost_usd for e in executions)),
    }


def record_message(
    db: Session,
    *,
    task: Task,
    message_type: str,
    sender: Agent | None,
    recipient: Agent | None,
    objective: str,
    payload: dict,
) -> AgentMessage:
    message = AgentMessage(
        project_id=task.project_id,
        task_id=task.id,
        sender_agent_id=sender.id if sender else None,
        recipient_agent_id=recipient.id if recipient else None,
        message_type=message_type,
        objective=objective[:2000],
        payload=payload,
    )
    db.add(message)
    return message

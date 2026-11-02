"""Readable project folders: every project's files in their folder structure, plus PROJECT_LOG.md.

Object storage keeps files under opaque keys; this writes a copy people can open and run:

    data/workspaces/<title>-<id>/
        src/..., README.md, ...   agent work products, at the relative paths the agents named
        inputs/...                client uploads
        FINAL_REPORT.md           the CEO's final deliverable
        PROJECT_LOG.md            what happened, from the CEO's analysis to the final report

The folder is regenerated from the database (the source of truth) after every task the worker
finishes, so edits made inside it are overwritten.
"""

import logging
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Agent,
    Approval,
    Artifact,
    ArtifactKind,
    AuditLog,
    Client,
    Department,
    Execution,
    Project,
    Task,
    TaskKind,
)
from app.storage import read_artifact, safe_relpath

log = logging.getLogger(__name__)

KIND_LABELS = {
    TaskKind.ANALYZE: "CEO analysis",
    TaskKind.PLAN: "Planning",
    TaskKind.ALLOCATE: "Allocation",
    TaskKind.EXECUTE: "Execution",
    TaskKind.REVIEW: "QA review",
    TaskKind.CONSOLIDATE: "Department report",
    TaskKind.FINAL_REPORT: "Final report",
}


def workspace_path(project: Project) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", project.title.lower()).strip("-")[:50] or "project"
    return Path(get_settings().workspace_dir).resolve() / f"{slug}-{str(project.id)[:8]}"


def export_workspace(db: Session, project_id: uuid.UUID) -> Path | None:
    """Rewrite the project's folder from the database. Returns its path, or None if the project is gone."""
    project = db.get(Project, project_id)
    if project is None:
        return None
    root = workspace_path(project)
    base = Path(get_settings().workspace_dir).resolve()
    if root.exists() and base in root.parents:
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)

    tasks = db.scalars(select(Task).where(Task.project_id == project.id).order_by(Task.created_at)).all()
    # In the order they ran; tasks that have not started yet come last.
    tasks = sorted(tasks, key=lambda t: (t.started_at is None, t.started_at or t.created_at))
    artifacts = db.scalars(
        select(Artifact).where(Artifact.project_id == project.id).order_by(Artifact.created_at)
    ).all()
    written = _write_files(root, artifacts)
    log_md = _render_log(db, project, tasks, artifacts, written)
    (root / "PROJECT_LOG.md").write_text(log_md, encoding="utf-8")
    return root


def refresh_after_commit(db: Session, project_id: uuid.UUID) -> None:
    """Refresh the project's folder once `db` commits (decisions made outside the worker's task loop)."""
    pending = db.info.setdefault("workspace_refresh", set())
    if not pending:
        event.listen(db, "after_commit", _refresh_pending, once=True)
    pending.add(project_id)


def _refresh_pending(session: Session) -> None:
    for project_id in session.info.pop("workspace_refresh", set()):
        refresh_workspace(project_id)


def refresh_workspace(project_id: uuid.UUID) -> None:
    """Best effort: a failed export must never fail the task that triggered it."""
    from app.db import session_scope

    try:
        with session_scope() as db:
            export_workspace(db, project_id)
    except Exception:
        log.exception("could not export workspace for project %s", project_id)


# --------------------------------------------------------------------------- files


def artifact_paths(artifacts: list[Artifact]) -> dict[uuid.UUID, str]:
    """Each artifact's relative path in the project folder (posix). Pass every artifact, oldest first."""
    paths: dict[uuid.UUID, str] = {}
    taken: set[str] = {"PROJECT_LOG.md"}
    for artifact in artifacts:
        if artifact.kind == ArtifactKind.DELIVERABLE:
            rel = "FINAL_REPORT.md"
        elif artifact.kind == ArtifactKind.INPUT:
            rel = f"inputs/{safe_relpath(artifact.name)}"
        else:
            rel = safe_relpath(artifact.name)
        rel = _unique(rel, taken)
        taken.add(rel)
        paths[artifact.id] = rel
    return paths


def _write_files(root: Path, artifacts: list[Artifact]) -> dict[uuid.UUID, str]:
    """Write each artifact at its relative path. Returns artifact id -> path written (posix, relative)."""
    written: dict[uuid.UUID, str] = {}
    paths = artifact_paths(artifacts)
    for artifact in artifacts:
        rel = paths[artifact.id]
        target = (root / rel).resolve()
        if root not in target.parents:
            continue
        try:
            data = read_artifact(artifact)
        except OSError:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written[artifact.id] = rel
    return written


def _unique(rel: str, taken: set[str]) -> str:
    if rel not in taken:
        return rel
    path = PurePosixPath(rel)
    n = 2
    while (candidate := str(path.with_name(f"{path.stem}-{n}{path.suffix}"))) in taken:
        n += 1
    return candidate


def _tree(paths: list[str]) -> str:
    tree: dict = {}
    for p in sorted(paths):
        node = tree
        for part in p.split("/"):
            node = node.setdefault(part, {})
    lines = ["."]

    def walk(node: dict, prefix: str) -> None:
        items = sorted(node.items(), key=lambda kv: (not kv[1], kv[0].lower()))
        for i, (name, child) in enumerate(items):
            last = i == len(items) - 1
            lines.append(f"{prefix}{'└── ' if last else '├── '}{name}{'/' if child else ''}")
            walk(child, prefix + ("    " if last else "│   "))

    walk(tree, "")
    return "\n".join(lines)


# --------------------------------------------------------------------------- PROJECT_LOG.md


def _ts(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S UTC") if value else "-"


def _bullets(items, indent: str = "") -> list[str]:
    out = []
    for item in items or []:
        if isinstance(item, dict):
            out.append(f"{indent}- " + "; ".join(f"**{k}**: {v}" for k, v in item.items()))
        else:
            out.append(f"{indent}- {item}")
    return out


def _quote(text: str) -> list[str]:
    return [f"> {line}" if line else ">" for line in (text or "").strip().splitlines()]


def _render_log(
    db: Session, project: Project, tasks: list[Task], artifacts: list[Artifact], written: dict[uuid.UUID, str]
) -> str:
    agents = {a.id: a for a in db.scalars(select(Agent)).all()}
    departments = {d.id: d for d in db.scalars(select(Department)).all()}
    client = db.get(Client, project.client_id)
    executions = db.scalars(
        select(Execution).where(Execution.project_id == project.id).order_by(Execution.started_at)
    ).all()
    approvals = db.scalars(
        select(Approval).where(Approval.project_id == project.id).order_by(Approval.created_at)
    ).all()
    events = db.scalars(select(AuditLog).where(AuditLog.project_id == project.id).order_by(AuditLog.id)).all()
    files_by_task: dict[uuid.UUID | None, list[str]] = {}
    for a in artifacts:
        if a.id in written:
            files_by_task.setdefault(a.task_id, []).append(written[a.id])
    models_by_task: dict[uuid.UUID, set[str]] = {}
    for e in executions:
        if e.model:
            models_by_task.setdefault(e.task_id, set()).add(f"{e.provider}/{e.model}")

    def agent_name(agent_id) -> str:
        return agents[agent_id].name if agent_id in agents else "-"

    by_kind = {k: [t for t in tasks if t.kind == k] for k in TaskKind}
    out: list[str] = [
        f"# {project.title}",
        "",
        "_Project log generated by Orchestria from the database; this folder is rewritten as work progresses._",
        "",
        "| | |",
        "|---|---|",
        f"| Project ID | `{project.id}` |",
        f"| Client | {client.name if client else '-'} |",
        f"| Status | **{project.status}** |",
        f"| Created | {_ts(project.created_at)} |",
        f"| Started | {_ts(project.started_at)} |",
        f"| Completed | {_ts(project.completed_at)} |",
        f"| Tokens used | {project.tokens_used:,} |",
        f"| Cost | ${project.spent_usd or 0:.4f} |",
        f"| Models | {', '.join(sorted({m for ms in models_by_task.values() for m in ms})) or '-'} |",
        "",
        "## 1. Client request",
        "",
        *_quote(project.request),
        "",
    ]
    if project.requested_deliverables:
        out += ["**Requested deliverables:**", "", *_bullets(project.requested_deliverables), ""]

    out += ["## 2. CEO analysis", ""]
    analysis = next((t.result for t in by_kind[TaskKind.ANALYZE] if t.result), None)
    if analysis:
        out += [f"**Objective:** {analysis.get('objective', '-')}", ""]
        for key, label in [
            ("expected_outcomes", "Expected outcomes"),
            ("departments", "Departments involved"),
            ("deliverables", "Deliverables"),
            ("risks", "Risks"),
            ("assumptions", "Assumptions"),
        ]:
            if analysis.get(key):
                out += [f"**{label}:**", "", *_bullets(analysis[key]), ""]
    else:
        out += ["_Not done yet._", ""]

    out += ["## 3. Plan", ""]
    plan = next((t.result for t in by_kind[TaskKind.PLAN] if t.result), None)
    if plan:
        out += [plan.get("summary", ""), ""]
        for wp in plan.get("work_packages", []):
            deps = ", ".join(wp.get("depends_on") or []) or "none"
            out += [
                f"### {wp.get('ref')}: {wp.get('title')} ({wp.get('department')})",
                "",
                wp.get("objective", ""),
                "",
                f"Depends on: {deps}",
                "",
                "Acceptance criteria:",
                "",
                *_bullets(wp.get("acceptance_criteria")),
                "",
            ]
    else:
        out += ["_Not done yet._", ""]

    out += ["## 4. Work, step by step", ""]
    for i, t in enumerate(tasks, 1):
        dept = departments.get(t.department_id)
        out += [
            f"### 4.{i} {KIND_LABELS.get(TaskKind(t.kind), t.kind)}: {t.title}",
            "",
            f"- **Agent:** {agent_name(t.assigned_agent_id)}"
            + (f" ({dept.name})" if dept else "")
            + (f", assigned by {agent_name(t.created_by_agent_id)}" if t.created_by_agent_id else ""),
            f"- **Status:** {t.status} (attempts {t.attempt_count}/{t.max_attempts})",
            f"- **Time:** {_ts(t.started_at)} → {_ts(t.completed_at)}",
            f"- **Tokens:** {t.tokens_used:,} · **Model:** {', '.join(sorted(models_by_task.get(t.id, []))) or '-'}",
        ]
        result = t.result or {}
        if result.get("summary"):
            out += [f"- **Summary:** {result['summary']}"]
        if t.kind == TaskKind.REVIEW and result.get("verdict"):
            out += [f"- **Verdict:** {result['verdict']} (score {result.get('score')})"]
            if result.get("feedback"):
                out += [f"- **Feedback:** {result['feedback']}"]
        if t.kind == TaskKind.ALLOCATE and result.get("assignments"):
            out += ["- **Assignments:**"]
            out += [f"  - {a.get('title')} → `{a.get('agent_key')}`" for a in result["assignments"]]
        if files_by_task.get(t.id):
            out += ["- **Files:** " + ", ".join(f"`{p}`" for p in files_by_task[t.id])]
        for fb in t.feedback or []:
            out += [f"- **Rejected (attempt {fb.get('attempt')}) by {fb.get('reviewer')}:** {fb.get('feedback')}"]
            out += _bullets(fb.get("required_fixes"), indent="  ")
        if t.last_error:
            out += [f"- **Last error:** {t.last_error[:500]}"]
        out += [""]

    out += ["## 5. Human decisions", ""]
    if approvals:
        for a in approvals:
            out += [f"### {a.title}", "", f"- **Type:** {a.kind} · **Status:** {a.status}"]
            for q in (a.details or {}).get("questions", []):
                out += [f"- **Question:** {q}"]
            if a.decision_note:
                out += [f"- **Answer:** {a.decision_note.strip()}"]
            out += [f"- **Asked:** {_ts(a.created_at)} · **Decided:** {_ts(a.decided_at)}", ""]
    else:
        out += ["_None._", ""]

    out += ["## 6. Final report", ""]
    report = project.final_report
    if report:
        out += [
            report.get("executive_summary", ""),
            "",
            f"**Objective met:** {'yes' if report.get('objective_met') else 'no'}",
            "",
        ]
        for o in report.get("outcomes", []):
            out += [f"- {o.get('outcome')}: **{o.get('status')}**. {o.get('evidence', '')}"]
        if report.get("next_steps"):
            out += ["", "**Next steps:**", "", *_bullets(report["next_steps"])]
        out += ["", "Full deliverable: `FINAL_REPORT.md`", ""]
    else:
        out += ["_Not done yet._", ""]

    out += ["## 7. File structure", "", "```", _tree(["PROJECT_LOG.md", *written.values()]), "```", ""]

    out += ["## 8. Timeline", "", "| Time | Event | Details |", "|---|---|---|"]
    for e in events:
        message = (e.message or "").replace("|", "\\|").replace("\n", " ")[:300]
        out += [f"| {_ts(e.created_at)} | `{e.action}` | {message} |"]
    out += [""]
    return "\n".join(out)

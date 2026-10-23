"""Generic agent runner.

Executes any agent from its configuration: builds the prompt, runs the LLM/tool loop with
permission-checked tools, enforces timeouts and budgets, validates structured output
(schema + task-specific checks, with bounded repair attempts) and records every step,
token and cost on the execution row as it happens.
"""

import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

import jsonschema
from sqlalchemy import update

from app.agents.prompts import build_system_prompt, fence_untrusted
from app.agents.schemas import CLARIFICATION, OUTPUT_SCHEMAS
from app.config import Settings
from app.db import session_scope
from app.models import Agent, Execution, Project, Task
from app.providers.base import CompletionRequest, NoProviderAvailable, ProviderError
from app.providers.router import ModelRouter
from app.tools.registry import ToolContext, ToolError, describe_tools, execute_tool

MAX_TRANSCRIPT_TEXT = 4000
MAX_TOOL_RESULT_CHARS = 16000


@dataclass
class AgentConfig:
    """Snapshot of an agent's configuration, usable outside a database session."""

    id: uuid.UUID
    key: str
    name: str
    department: str
    role_type: str
    description: str
    responsibilities: list[str]
    instructions: str
    output_requirements: str
    allowed_tools: list[str]
    model_tier: str
    model_override: str | None
    temperature: float
    timeout_seconds: int
    max_tokens_per_task: int
    max_cost_usd_per_task: Decimal
    quality_criteria: list[str]
    escalation_rules: list[str]

    @classmethod
    def from_agent(cls, agent: Agent, department_name: str) -> "AgentConfig":
        return cls(
            id=agent.id,
            key=agent.key,
            name=agent.name,
            department=department_name,
            role_type=agent.role_type,
            description=agent.description,
            responsibilities=list(agent.responsibilities or []),
            instructions=agent.system_instructions,
            output_requirements=agent.output_requirements,
            allowed_tools=list(agent.allowed_tools or []),
            model_tier=agent.model_tier,
            model_override=agent.model_override,
            temperature=agent.temperature,
            timeout_seconds=agent.timeout_seconds,
            max_tokens_per_task=agent.max_tokens_per_task,
            max_cost_usd_per_task=Decimal(agent.max_cost_usd_per_task),
            quality_criteria=list(agent.quality_criteria or []),
            escalation_rules=list(agent.escalation_rules or []),
        )

    def prompt_fields(self) -> dict:
        return {
            "name": self.name,
            "role_type": self.role_type,
            "department": self.department,
            "description": self.description,
            "responsibilities": self.responsibilities,
            "instructions": self.instructions,
            "output_requirements": self.output_requirements,
            "quality_criteria": self.quality_criteria,
            "escalation_rules": self.escalation_rules,
        }


@dataclass
class RunOutcome:
    status: Literal["completed", "clarification", "budget_exceeded", "failed", "aborted"]
    output: dict | None = None
    questions: list[str] = field(default_factory=list)
    error: str | None = None
    tool_records: list[dict] = field(default_factory=list)
    budget_details: dict = field(default_factory=dict)


class Aborted(Exception):
    """The run must stop for reasons outside the agent's control (lease lost, project paused)."""


SemanticCheck = Callable[[dict, list[dict]], list[str]]


def parse_json_object(text: str) -> dict:
    """Parse the model's reply, tolerating code fences and surrounding prose."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        stripped = stripped[stripped.find("\n") + 1 :] if "\n" in stripped else stripped
    start = stripped.find("{")
    if start < 0:
        raise ValueError("no JSON object found")
    obj, _ = json.JSONDecoder().raw_decode(stripped[start:])
    if not isinstance(obj, dict):
        raise ValueError("top-level JSON value must be an object")
    return obj


def _schema_errors(instance, schema) -> list[str]:
    validator = jsonschema.Draft202012Validator(schema)
    errors = []
    for error in sorted(validator.iter_errors(instance), key=lambda e: list(e.path))[:10]:
        location = "/".join(str(p) for p in error.path) or "(root)"
        errors.append(f"{location}: {error.message[:300]}")
    return errors


def _clip(value, limit: int = MAX_TRANSCRIPT_TEXT):
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[:limit] + f"... [{len(text)} chars]"


class AgentRunner:
    def __init__(self, router: ModelRouter, settings: Settings):
        self.router = router
        self.settings = settings

    def run(
        self,
        *,
        agent: AgentConfig,
        kind: str,
        envelope: dict,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
        execution_id: uuid.UUID,
        allow_external: bool,
        semantic_check: SemanticCheck,
        heartbeat: Callable[[], None],
        budget_multiplier: int = 1,
    ) -> RunOutcome:
        tools = describe_tools(agent.allowed_tools)
        system_prompt = build_system_prompt(agent.prompt_fields(), kind, tools, self.settings.max_plan_tasks)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Task envelope:\n" + json.dumps(envelope, default=str)},
        ]
        self._append_transcript(execution_id, {"type": "request", "system_prompt": _clip(system_prompt, 12000)})

        started = time.monotonic()
        tokens = 0
        cost = Decimal("0")
        repairs = 0
        tool_calls = 0
        tool_records: list[dict] = []
        max_tokens = agent.max_tokens_per_task * budget_multiplier
        max_cost = agent.max_cost_usd_per_task * budget_multiplier
        max_steps = self.settings.max_tool_iterations + self.settings.max_structured_output_repairs + 2

        for step in range(1, max_steps + 1):
            heartbeat()
            if time.monotonic() - started > agent.timeout_seconds:
                return RunOutcome(
                    "failed", error=f"timed out after {agent.timeout_seconds}s", tool_records=tool_records
                )
            if tokens >= max_tokens or cost >= max_cost:
                return RunOutcome(
                    "budget_exceeded",
                    error="agent per-task budget exhausted",
                    tool_records=tool_records,
                    budget_details={
                        "scope": "task",
                        "tokens": tokens,
                        "cost_usd": str(cost),
                        "max_tokens": max_tokens,
                        "max_cost_usd": str(max_cost),
                    },
                )
            project_budget = self._project_budget_exceeded(project_id)
            if project_budget:
                return RunOutcome(
                    "budget_exceeded",
                    error="project budget exhausted",
                    tool_records=tool_records,
                    budget_details=project_budget,
                )

            try:
                result = self.router.complete(
                    CompletionRequest(messages=messages, temperature=agent.temperature, max_tokens=8192),
                    tier=agent.model_tier,
                    model_override=agent.model_override,
                    allow_external=allow_external,
                )
            except NoProviderAvailable as exc:
                return RunOutcome("aborted", error=f"LLM unavailable: {exc}", tool_records=tool_records)
            except ProviderError as exc:
                return RunOutcome("failed", error=f"LLM error: {exc}", tool_records=tool_records)

            step_tokens = result.prompt_tokens + result.completion_tokens
            tokens += step_tokens
            cost += Decimal(str(result.cost_usd))
            self._record_llm_call(execution_id, task_id, project_id, result, step)
            messages.append({"role": "assistant", "content": result.content})

            try:
                reply = parse_json_object(result.content)
            except ValueError as exc:
                repairs += 1
                if repairs > self.settings.max_structured_output_repairs:
                    return RunOutcome("failed", error=f"invalid JSON reply: {exc}", tool_records=tool_records)
                messages.append(
                    {
                        "role": "user",
                        "content": f"Your reply was not a valid JSON object ({exc}). "
                        "Reply with exactly one JSON object following the response protocol.",
                    }
                )
                continue

            reply_type = reply.get("type")
            if reply_type == "tool_call":
                tool_calls += 1
                call_id = f"call_{tool_calls}"
                if tool_calls > self.settings.max_tool_iterations:
                    messages.append(
                        {"role": "user", "content": "Tool call limit reached. Reply now with your final output."}
                    )
                    continue
                record = self._run_tool(agent, task_id, project_id, execution_id, call_id, reply)
                tool_records.append(record)
                messages.append(
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "tool_call_id": call_id,
                                "tool": record["tool"],
                                "ok": record["ok"],
                                "result": fence_untrusted(
                                    f"tool:{record['tool']}", _clip(record["full_result"], MAX_TOOL_RESULT_CHARS)
                                ),
                            }
                        ),
                    }
                )
                continue

            if reply_type == "clarification":
                errors = _schema_errors(reply, CLARIFICATION)
                if not errors:
                    return RunOutcome("clarification", questions=reply["questions"], tool_records=tool_records)
            elif reply_type == "final":
                output = reply.get("output")
                errors = (
                    _schema_errors(output, OUTPUT_SCHEMAS[kind])
                    if isinstance(output, dict)
                    else ["output must be a JSON object"]
                )
                if not errors:
                    errors = semantic_check(output, tool_records)
                if not errors:
                    return RunOutcome("completed", output=output, tool_records=tool_records)
            else:
                errors = ['"type" must be "tool_call", "clarification" or "final"']

            repairs += 1
            self._append_transcript(execution_id, {"type": "validation_failed", "step": step, "errors": errors})
            if repairs > self.settings.max_structured_output_repairs:
                return RunOutcome(
                    "failed", error="output failed validation: " + "; ".join(errors), tool_records=tool_records
                )
            messages.append(
                {
                    "role": "user",
                    "content": "Your reply was rejected by validation:\n- "
                    + "\n- ".join(errors)
                    + "\nFix these problems and reply again.",
                }
            )

        return RunOutcome("failed", error="step limit reached without final output", tool_records=tool_records)

    # -- helpers ---------------------------------------------------------------------------

    def _run_tool(self, agent: AgentConfig, task_id, project_id, execution_id, call_id: str, reply: dict) -> dict:
        name = str(reply.get("tool", ""))
        arguments = reply.get("arguments") or {}
        started = time.monotonic()
        try:
            if not isinstance(arguments, dict):
                raise ToolError("arguments must be a JSON object")
            with session_scope() as db:
                ctx = ToolContext(
                    db=db,
                    settings=self.settings,
                    project=db.get(Project, project_id),
                    task=db.get(Task, task_id),
                    agent=db.get(Agent, agent.id),
                )
                result = execute_tool(ctx, name, arguments)
            ok = True
        except ToolError as exc:
            result, ok = {"error": str(exc)}, False
        except Exception as exc:  # a broken tool must not crash the worker
            result, ok = {"error": f"tool failed: {type(exc).__name__}: {exc}"}, False
        record = {
            "tool_call_id": call_id,
            "tool": name,
            "arguments": arguments
            if len(json.dumps(arguments, default=str)) <= 2000
            else {"truncated": _clip(arguments, 2000)},
            "ok": ok,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "full_result": result,
        }
        self._append_transcript(
            execution_id,
            {
                "type": "tool",
                "tool_call_id": call_id,
                "tool": name,
                "ok": ok,
                "arguments": _clip(arguments),
                "result": _clip(result),
            },
            tool_call=True,
        )
        return record

    def _record_llm_call(self, execution_id, task_id, project_id, result, step: int) -> None:
        tokens = result.prompt_tokens + result.completion_tokens
        cost = Decimal(str(result.cost_usd))
        with session_scope() as db:
            execution = db.get(Execution, execution_id, with_for_update=True)
            execution.provider = result.provider
            execution.model = result.model
            execution.llm_calls += 1
            execution.prompt_tokens += result.prompt_tokens
            execution.completion_tokens += result.completion_tokens
            execution.cost_usd += cost
            execution.transcript = [
                *execution.transcript,
                {
                    "type": "llm",
                    "step": step,
                    "provider": result.provider,
                    "model": result.model,
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                    "latency_ms": result.latency_ms,
                    "response": _clip(result.content),
                },
            ]
            db.execute(
                update(Task)
                .where(Task.id == task_id)
                .values(tokens_used=Task.tokens_used + tokens, cost_usd=Task.cost_usd + cost)
            )
            db.execute(
                update(Project)
                .where(Project.id == project_id)
                .values(tokens_used=Project.tokens_used + tokens, spent_usd=Project.spent_usd + cost)
            )

    def _append_transcript(self, execution_id, entry: dict, tool_call: bool = False) -> None:
        with session_scope() as db:
            execution = db.get(Execution, execution_id, with_for_update=True)
            execution.transcript = [*execution.transcript, entry]
            if tool_call:
                execution.tool_calls += 1

    def _project_budget_exceeded(self, project_id) -> dict | None:
        with session_scope() as db:
            project = db.get(Project, project_id)
            if project.budget_usd is not None and project.spent_usd >= project.budget_usd:
                return {"scope": "project", "spent_usd": str(project.spent_usd), "budget_usd": str(project.budget_usd)}
            if project.budget_tokens is not None and project.tokens_used >= project.budget_tokens:
                return {"scope": "project", "tokens_used": project.tokens_used, "budget_tokens": project.budget_tokens}
        return None

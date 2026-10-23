"""Test doubles. Lives under tests/ so it can never be configured in a real deployment.

ScriptedCompany plays every agent deterministically: it reads the task envelope the engine
sends (exactly what a real model receives) and answers through the same response protocol,
including real tool calls. That exercises the whole engine - prompts, protocol, tools,
validation, QA loop, approvals and persistence - without network access or API costs.
"""

import json
from collections import defaultdict
from collections.abc import Callable

from app.providers.base import CompletionRequest, CompletionResult


class ScriptedProvider:
    def __init__(self, responder: Callable[[list[dict], str], str], name: str = "scripted", external: bool = True):
        self.name = name
        self.external = external
        self.responder = responder
        self.calls: list[dict] = []

    def supports(self, tier: str, model_override: str | None) -> bool:
        return True

    def complete(self, request: CompletionRequest, *, tier: str, model_override: str | None) -> CompletionResult:
        content = self.responder(request.messages, tier)
        self.calls.append({"tier": tier, "messages": request.messages, "reply": content})
        prompt_tokens = sum(len(m["content"]) for m in request.messages) // 4
        completion_tokens = len(content) // 4
        return CompletionResult(
            content=content,
            provider=self.name,
            model=f"scripted-{tier}",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=1,
            cost_usd=(prompt_tokens * 0.5 + completion_tokens * 1.5) / 1_000_000,
        )


def envelope_of(messages: list[dict]) -> dict:
    first_user = next(m for m in messages if m["role"] == "user")
    return json.loads(first_user["content"].split("\n", 1)[1])


def last_tool_result(messages: list[dict]) -> dict | None:
    for m in reversed(messages):
        if m["role"] == "user" and m["content"].startswith('{"tool_call_id"'):
            return json.loads(m["content"])
    return None


def final(output: dict) -> str:
    return json.dumps({"type": "final", "output": output})


TEST_CODE = """
def add(a, b):
    return a + b

assert add(2, 3) == 5
assert add(-1, 1) == 0
print("2 passed")
"""


class ScriptedCompany:
    """A deterministic stand-in for the model behind every agent.

    Knobs let tests inject QA rejections, clarifications, approval flags and bad output.
    """

    def __init__(self):
        self.reject_attempts: dict[str, int] = {}  # task title -> number of attempts QA rejects
        self.clarify_kinds: set[str] = set()
        self.approval_assignment: str | None = None  # agent_key whose assignment needs approval
        self.invalid_first: set[str] = set()  # kinds whose first reply is invalid JSON
        self.always_fail: set[str] = set()  # task titles whose execution output is always invalid
        self.seen = defaultdict(int)

    def __call__(self, messages: list[dict], tier: str) -> str:
        env = envelope_of(messages)
        kind = env["kind"]
        key = (env["task_id"], env["attempt"])
        self.seen[key] += 1
        if kind in self.invalid_first and self.seen[key] == 1:
            return "Sure! Here is my answer: not json"
        if env["title"] in self.always_fail:
            return final({"summary": "incomplete"})
        return getattr(self, f"_{kind}")(env, messages)

    # -- one method per task kind ------------------------------------------------------------

    def _analyze(self, env, messages):
        if "analyze" in self.clarify_kinds and not env["context"].get("clarifications"):
            return json.dumps({"type": "clarification", "questions": ["Which Python version must be supported?"]})
        return final(
            {
                "summary": "Client needs a small calculator library and a short market note.",
                "objective": "Deliver a tested Python calculator module and a one-page research note.",
                "expected_outcomes": ["Tested calculator module", "Research note on calculator libraries"],
                "departments": ["technology", "research"],
                "deliverables": ["calculator.py", "research-note.md"],
                "risks": ["Scope creep"],
            }
        )

    def _plan(self, env, messages):
        return final(
            {
                "summary": "Research first, then build.",
                "work_packages": [
                    {
                        "ref": "research",
                        "department": "research",
                        "title": "Calculator library research",
                        "objective": "Summarize existing calculator libraries.",
                        "acceptance_criteria": ["Lists at least two options"],
                    },
                    {
                        "ref": "build",
                        "department": "technology",
                        "title": "Build calculator module",
                        "objective": "Implement add() with tests.",
                        "acceptance_criteria": ["add() works", "tests pass in sandbox"],
                        "depends_on": ["research"],
                    },
                ],
            }
        )

    def _allocate(self, env, messages):
        team = {m["agent_key"]: m for m in env["context"]["team"]}
        if "software_dev_subcoordinator" in team:  # technology coordinator delegates to a sub-team
            assignments = [
                {
                    "ref": "dev",
                    "agent_key": "software_dev_subcoordinator",
                    "title": "Develop calculator",
                    "objective": "Implement and test add().",
                    "acceptance_criteria": ["add() works", "tests pass in sandbox"],
                }
            ]
        elif "backend_coding" in team:
            assignments = [
                {
                    "ref": "code",
                    "agent_key": "backend_coding",
                    "title": "Implement add()",
                    "objective": "Write calculator.py with add() and run its tests.",
                    "acceptance_criteria": ["add() works", "tests pass in sandbox"],
                }
            ]
        else:
            first = next(k for k, m in team.items() if m["role"] == "specialist")
            assignments = [
                {
                    "ref": "gather",
                    "agent_key": "web_research" if "web_research" in team else first,
                    "title": "Gather facts",
                    "objective": "Collect facts about calculator libraries.",
                    "acceptance_criteria": ["Lists at least two options"],
                },
                {
                    "ref": "write",
                    "agent_key": "report_generation" if "report_generation" in team else first,
                    "title": "Write research note",
                    "objective": "Write a one-page note.",
                    "acceptance_criteria": ["Note is one page"],
                    "depends_on": ["gather"],
                },
            ]
        for a in assignments:
            if a["agent_key"] == self.approval_assignment:
                a["requires_human_approval"] = True
                a["approval_kind"] = "external_action"
                a["approval_reason"] = "Contacts an external party"
        return final({"summary": f"Allocated {len(assignments)} assignment(s).", "assignments": assignments})

    def _execute(self, env, messages):
        criteria = env["acceptance_criteria"]
        assessment = [{"criterion": c, "met": True, "explanation": "done"} for c in criteria]
        system = messages[0]["content"]
        if "sandbox.run_python" in system and "Implement" in env["title"]:
            result = last_tool_result(messages)
            if result is None:
                return json.dumps({"type": "tool_call", "tool": "sandbox.run_python", "arguments": {"code": TEST_CODE}})
            return final(
                {
                    "summary": "Implemented add() and ran its tests.",
                    "deliverables": [{"name": "calculator.py", "content": "def add(a, b):\n    return a + b\n"}],
                    "evidence": [
                        {"type": "tool_result", "description": "tests ran in sandbox", "tool_call_id": "call_1"}
                    ],
                    "self_assessment": assessment,
                }
            )
        return final(
            {
                "summary": f"Completed: {env['title']}",
                "deliverables": [{"name": f"{env['title'].lower().replace(' ', '-')}.md", "content": "# Notes\n..."}],
                "evidence": [{"type": "observation", "description": "drafted from provided context"}],
                "self_assessment": assessment,
                "proposed_external_actions": [],
            }
        )

    def _review(self, env, messages):
        work = env["context"]["work_under_review"]
        rejections = self.reject_attempts.get(work["title"], 0)
        criteria = [{"criterion": c, "met": True, "explanation": "verified"} for c in work["acceptance_criteria"]]
        if work["attempt"] <= rejections:
            criteria[0]["met"] = False
            return final(
                {
                    "verdict": "rejected",
                    "score": 0.3,
                    "criteria_results": criteria,
                    "feedback": "Missing edge cases.",
                    "required_fixes": ["Handle negative numbers"],
                }
            )
        return final({"verdict": "approved", "score": 0.9, "criteria_results": criteria, "feedback": "Looks good."})

    def _consolidate(self, env, messages):
        results = env["context"]["approved_results"]
        return final(
            {
                "summary": f"{len(results)} result(s) approved.",
                "report": json.dumps(results)[:500],
                "status": "complete",
            }
        )

    def _final_report(self, env, messages):
        reports = env["context"]["department_reports"]
        return final(
            {
                "executive_summary": f"Delivered with {len(reports)} department report(s).",
                "objective_met": True,
                "outcomes": [{"outcome": "Tested calculator module", "status": "met", "evidence": "QA approved"}],
                "final_deliverable_markdown": "# Final report\n\nDelivered calculator.py and research note.",
            }
        )

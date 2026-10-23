"""Required structured output for each task kind (JSON Schema).

Agent output is validated against these before the engine acts on it. Invalid output is
sent back to the model with the validation errors (bounded repairs), then fails the attempt.
"""

from app.models import ApprovalKind, TaskKind

_str = {"type": "string", "minLength": 1}
_str_list = {"type": "array", "items": _str}

_approval_kinds = [
    ApprovalKind.EXTERNAL_ACTION,
    ApprovalKind.SPEND,
    ApprovalKind.HIRING_DECISION,
    ApprovalKind.PRODUCTION_CHANGE,
    ApprovalKind.IRREVERSIBLE,
]

ANALYZE = {
    "type": "object",
    "required": ["summary", "objective", "expected_outcomes", "departments", "risks"],
    "properties": {
        "summary": _str,
        "objective": _str,
        "expected_outcomes": {"type": "array", "items": _str, "minItems": 1, "maxItems": 12},
        "departments": {"type": "array", "items": _str, "minItems": 1},
        "deliverables": _str_list,
        "risks": _str_list,
        "assumptions": _str_list,
    },
}

PLAN = {
    "type": "object",
    "required": ["summary", "work_packages"],
    "properties": {
        "summary": _str,
        "work_packages": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["ref", "department", "title", "objective", "acceptance_criteria"],
                "properties": {
                    "ref": {"type": "string", "pattern": "^[A-Za-z0-9_.-]{1,40}$"},
                    "department": _str,
                    "title": _str,
                    "objective": _str,
                    "acceptance_criteria": {"type": "array", "items": _str, "minItems": 1},
                    "depends_on": _str_list,
                    "requires_human_approval": {"type": "boolean"},
                    "approval_reason": {"type": "string"},
                },
            },
        },
    },
}

ALLOCATE = {
    "type": "object",
    "required": ["summary", "assignments"],
    "properties": {
        "summary": _str,
        "assignments": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["ref", "agent_key", "title", "objective", "acceptance_criteria"],
                "properties": {
                    "ref": {"type": "string", "pattern": "^[A-Za-z0-9_.-]{1,40}$"},
                    "agent_key": _str,
                    "title": _str,
                    "objective": _str,
                    "acceptance_criteria": {"type": "array", "items": _str, "minItems": 1},
                    "depends_on": _str_list,
                    "reviewer_key": {"type": "string"},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 5},
                    "requires_human_approval": {"type": "boolean"},
                    "approval_kind": {"type": "string", "enum": _approval_kinds},
                    "approval_reason": {"type": "string"},
                },
            },
        },
    },
}

EXECUTE = {
    "type": "object",
    "required": ["summary", "deliverables", "evidence", "self_assessment"],
    "properties": {
        "summary": _str,
        "deliverables": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name", "content"],
                "properties": {
                    "name": {"type": "string", "pattern": "^[^/\\\\]{1,120}$"},
                    "content_type": {"type": "string"},
                    "content": {"type": "string"},
                },
            },
        },
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["type", "description"],
                "properties": {
                    "type": {"type": "string", "enum": ["tool_result", "source", "calculation", "observation"]},
                    "description": _str,
                    "tool_call_id": {"type": "string"},
                    "reference": {"type": "string"},
                },
            },
        },
        "self_assessment": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["criterion", "met", "explanation"],
                "properties": {"criterion": _str, "met": {"type": "boolean"}, "explanation": {"type": "string"}},
            },
        },
        "proposed_external_actions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["kind", "description"],
                "properties": {
                    "kind": {"type": "string", "enum": _approval_kinds},
                    "description": _str,
                    "payload": {"type": "object"},
                },
            },
        },
        "issues": _str_list,
    },
}

REVIEW = {
    "type": "object",
    "required": ["verdict", "score", "criteria_results", "feedback"],
    "properties": {
        "verdict": {"type": "string", "enum": ["approved", "rejected"]},
        "score": {"type": "number", "minimum": 0, "maximum": 1},
        "criteria_results": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["criterion", "met", "explanation"],
                "properties": {"criterion": _str, "met": {"type": "boolean"}, "explanation": {"type": "string"}},
            },
        },
        "feedback": {"type": "string"},
        "required_fixes": _str_list,
    },
}

CONSOLIDATE = {
    "type": "object",
    "required": ["summary", "report", "status"],
    "properties": {
        "summary": _str,
        "report": _str,
        "status": {"type": "string", "enum": ["complete", "partial"]},
        "open_issues": _str_list,
    },
}

FINAL_REPORT = {
    "type": "object",
    "required": ["executive_summary", "objective_met", "outcomes", "final_deliverable_markdown"],
    "properties": {
        "executive_summary": _str,
        "objective_met": {"type": "boolean"},
        "outcomes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["outcome", "status", "evidence"],
                "properties": {
                    "outcome": _str,
                    "status": {"type": "string", "enum": ["met", "partially_met", "not_met"]},
                    "evidence": {"type": "string"},
                },
            },
        },
        "risks": _str_list,
        "next_steps": _str_list,
        "final_deliverable_markdown": _str,
    },
}

CLARIFICATION = {
    "type": "object",
    "required": ["questions"],
    "properties": {"questions": {"type": "array", "items": _str, "minItems": 1, "maxItems": 5}},
}

OUTPUT_SCHEMAS: dict[str, dict] = {
    TaskKind.ANALYZE: ANALYZE,
    TaskKind.PLAN: PLAN,
    TaskKind.ALLOCATE: ALLOCATE,
    TaskKind.EXECUTE: EXECUTE,
    TaskKind.REVIEW: REVIEW,
    TaskKind.CONSOLIDATE: CONSOLIDATE,
    TaskKind.FINAL_REPORT: FINAL_REPORT,
}

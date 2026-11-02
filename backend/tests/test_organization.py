"""Growing the company from the app: catalog departments, custom departments, agents, company agents."""

# The api/staff fixtures are shared with test_api.py; pytest finds them through this import.
# ruff: noqa: F811

from sqlalchemy import select

from app.agents.catalog import sync_catalog
from app.config import get_settings
from app.db import session_scope
from app.models import Agent, Department, Project
from app.orchestration.protocol import assignable_team, reviewers
from tests.test_api import _client_account, api, staff  # noqa: F401  (fixtures)


def test_admin_switches_on_a_catalog_department(api, staff):
    settings = get_settings()
    original = settings.enabled_departments
    settings.enabled_departments = "executive,operations,technology"
    try:
        with session_scope() as db:
            sync_catalog(db)
        catalog = api.get("/api/departments/catalog", headers=staff["admin"]).json()
        marketing = next(d for d in catalog if d["key"] == "marketing")
        assert marketing["agent_count"] > 0 and marketing["head"]
        assert api.get("/api/departments/catalog", headers=staff["operator"]).status_code == 403

        enabled = api.post("/api/departments/enable", json={"key": "marketing"}, headers=staff["admin"])
        assert enabled.status_code == 201 and enabled.json()["added_in_app"] is True
        assert api.post("/api/departments/enable", json={"key": "marketing"}, headers=staff["admin"]).status_code == 409
        assert api.post("/api/departments/enable", json={"key": "nope"}, headers=staff["admin"]).status_code == 404

        # A later catalog sync keeps it, even though AICO_ENABLED_DEPARTMENTS does not list it.
        with session_scope() as db:
            sync_catalog(db)
            dept = db.scalar(select(Department).where(Department.key == "marketing"))
            team = db.scalars(select(Agent).where(Agent.department_id == dept.id, Agent.is_active)).all()
            assert len(team) == marketing["agent_count"]
    finally:
        settings.enabled_departments = original


def test_custom_department_with_its_own_team(api, staff):
    admin = staff["admin"]
    created = api.post("/api/departments", json={"key": "legal", "name": "Legal"}, headers=admin)
    assert created.status_code == 201
    assert api.post("/api/departments", json={"key": "legal", "name": "Legal"}, headers=admin).status_code == 409
    catalog_key = api.post("/api/departments", json={"key": "marketing", "name": "Marketing"}, headers=admin)
    assert catalog_key.status_code == 409

    head = api.post(
        "/api/agents",
        json={
            "name": "Legal Coordinator",
            "department_key": "legal",
            "role_type": "coordinator",
            "reports_to_key": "ceo",
        },
        headers=admin,
    )
    assert head.status_code == 201, head.text
    assert head.json()["key"] == "legal_coordinator"
    assert head.json()["task_kinds"] == ["allocate", "consolidate"]  # the role's defaults

    specialist = {"name": "Contract Reviewer", "department_key": "legal", "role_type": "specialist"}
    ok = api.post("/api/agents", json={**specialist, "reports_to_key": "legal_coordinator"}, headers=admin)
    assert ok.status_code == 201 and ok.json()["task_kinds"] == ["execute"]
    for manager, reason in [("ceo", "not to the CEO"), (ok.json()["key"], "cannot manage")]:
        bad = api.post("/api/agents", json={**specialist, "name": "X Agent", "reports_to_key": manager}, headers=admin)
        assert bad.status_code == 422 and reason in bad.text
    other_dept = api.post("/api/agents", json={**specialist, "reports_to_key": "technology_coordinator"}, headers=admin)
    assert other_dept.status_code == 422 and "same department" in other_dept.text
    as_operator = staff["operator"]
    denied = api.post("/api/agents", json={**specialist, "reports_to_key": "legal_coordinator"}, headers=as_operator)
    assert denied.status_code == 403
    # With a head in place the department can receive work.
    overview = api.get("/api/company/agents", headers=admin).json()
    assert "legal" in {d["key"] for d in overview["departments"]}


def test_company_agents_are_private_to_their_company(api, staff):
    acme, acme_auth = _client_account(api, staff, "Acme", "owner@acme-corp.io")
    globex, globex_auth = _client_account(api, staff, "Globex", "owner@globex-corp.io")
    body = {
        "name": "Acme Brand Writer",
        "department_key": "technology",
        "description": "Writes copy in Acme's house style.",
        "system_instructions": "Always follow the Acme brand voice guide attached to the project.",
        "allowed_tools": ["project_files.read"],
    }
    created = api.post("/api/company/agents", json=body, headers=acme_auth)
    assert created.status_code == 201, created.text
    agent = created.json()
    assert agent["client_id"] == acme["id"]
    assert agent["role_type"] == "specialist" and agent["task_kinds"] == ["execute"]

    assert [a["id"] for a in api.get("/api/company/agents", headers=acme_auth).json()["agents"]] == [agent["id"]]
    assert api.get("/api/company/agents", headers=globex_auth).json()["agents"] == []
    url = f"/api/company/agents/{agent['id']}"
    assert api.patch(url, json={"is_active": False}, headers=globex_auth).status_code == 404
    assert api.patch(url, json={"model_tier": "fast"}, headers=acme_auth).json()["model_tier"] == "fast"
    executive = api.post("/api/company/agents", json={**body, "department_key": "executive"}, headers=acme_auth)
    assert executive.status_code == 422
    no_client = api.post("/api/company/agents", json=body, headers=staff["operator"])
    assert no_client.status_code == 422  # staff must say which client the agent belongs to
    assert api.get("/api/agents", headers=acme_auth).status_code == 403  # the company roster stays staff-only

    # The engine only ever offers the agent on Acme's own projects, and never as a QA reviewer.
    with session_scope() as db:
        mine = Project(client_id=acme["id"], title="Acme site", request="Build the Acme site please.")
        theirs = Project(client_id=globex["id"], title="Globex site", request="Build the Globex site please.")
        db.add_all([mine, theirs])
        db.flush()
        head = db.scalar(select(Agent).where(Agent.key == "technology_coordinator"))
        assert agent["key"] in {a.key for a in assignable_team(db, head, mine.id)}
        assert agent["key"] not in {a.key for a in assignable_team(db, head, theirs.id)}
        assert agent["key"] not in {a.key for a in reviewers(db)}

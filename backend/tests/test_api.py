"""API tests: authentication, role-based access, tenant isolation and the client journey."""

import pytest
from fastapi.testclient import TestClient

from app.db import session_scope
from app.main import create_app
from app.models import User, UserRole
from app.providers.router import ModelRouter
from app.security import hash_password
from app.worker import Worker
from tests.fakes import ScriptedCompany, ScriptedProvider
from tests.test_workflow import run_until_idle

PASSWORD = "correct-horse-battery"


@pytest.fixture
def api():
    return TestClient(create_app())


def _user(email, role, client_id=None):
    with session_scope() as db:
        db.add(
            User(email=email, full_name=email, role=role, client_id=client_id, password_hash=hash_password(PASSWORD))
        )


def _login(api, email):
    response = api.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def staff(api):
    _user("admin@test.io", UserRole.ADMIN)
    _user("supervisor@test.io", UserRole.SUPERVISOR)
    _user("operator@test.io", UserRole.OPERATOR)
    return {
        "admin": _login(api, "admin@test.io"),
        "supervisor": _login(api, "supervisor@test.io"),
        "operator": _login(api, "operator@test.io"),
    }


def _client_account(api, staff, name, email):
    client = api.post("/api/clients", json={"name": name, "allow_external_llm": True}, headers=staff["admin"]).json()
    _user(email, UserRole.CLIENT, client_id=client["id"])
    return client, _login(api, email)


def test_login_rejects_bad_credentials(api, staff):
    assert api.post("/api/auth/login", json={"email": "admin@test.io", "password": "wrong-password"}).status_code == 401
    assert api.get("/api/agents").status_code == 401
    assert api.get("/api/agents", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_org_chart_and_agent_management(api, staff):
    agents = api.get("/api/agents", headers=staff["operator"]).json()
    assert len(agents) == 67
    assert all(a["stats"]["status"] == "idle" for a in agents)

    chart = api.get("/api/org-chart", headers=staff["operator"]).json()
    [ceo] = chart["roots"]
    assert ceo["key"] == "ceo"
    child_keys = {c["key"] for c in ceo["children"]}
    assert {"operations_director", "technology_coordinator", "hr_coordinator", "research_coordinator"} <= child_keys

    seo = next(a for a in agents if a["key"] == "seo")
    updated = api.patch(
        f"/api/agents/{seo['id']}",
        json={"system_instructions": "Focus on technical SEO.", "max_retries": 4, "allowed_tools": ["web.fetch"]},
        headers=staff["operator"],
    ).json()
    assert updated["customized"] is True and updated["version"] == 2 and updated["max_retries"] == 4
    bad = api.patch(f"/api/agents/{seo['id']}", json={"allowed_tools": ["shell.exec"]}, headers=staff["operator"])
    assert bad.status_code == 422

    ceo_agent = next(a for a in agents if a["key"] == "ceo")
    assert (
        api.patch(f"/api/agents/{ceo_agent['id']}", json={"is_active": False}, headers=staff["admin"]).status_code
        == 422
    )

    created = api.post(
        "/api/agents",
        json={
            "key": "localization",
            "name": "Localization Agent",
            "department_key": "marketing",
            "role_type": "specialist",
            "reports_to_key": "marketing_coordinator",
            "description": "Translates marketing content.",
        },
        headers=staff["admin"],
    )
    assert created.status_code == 201
    assert api.post("/api/agents", json={}, headers=staff["operator"]).status_code in (403, 422)


def test_clients_are_isolated_and_cannot_use_staff_endpoints(api, staff):
    _, acme = _client_account(api, staff, "Acme", "acme@client.io")
    _, globex = _client_account(api, staff, "Globex", "globex@client.io")
    project = api.post(
        "/api/projects",
        json={"title": "Acme website", "request": "Build a landing page for our product.", "submit": False},
        headers=acme,
    ).json()

    assert api.get(f"/api/projects/{project['id']}", headers=globex).status_code == 404
    assert api.get("/api/projects", headers=globex).json() == []
    assert api.get("/api/agents", headers=acme).status_code == 403
    assert api.get("/api/dashboard/executive", headers=acme).status_code == 403
    assert api.get(f"/api/projects/{project['id']}/messages", headers=acme).status_code == 403


def test_client_journey_end_to_end(api, staff, settings):
    _, acme = _client_account(api, staff, "Acme", "acme@client.io")
    created = api.post(
        "/api/projects",
        json={
            "title": "Calculator",
            "request": "Build me a tested calculator module and research note.",
            "requested_deliverables": ["calculator.py"],
        },
        headers=acme,
    )
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["status"] == "in_progress"

    upload = api.post(
        f"/api/projects/{project['id']}/files",
        files={"file": ("requirements.txt", b"must support negative numbers", "text/plain")},
        headers=acme,
    )
    assert upload.status_code == 201
    assert (
        api.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("x.exe", b"MZ", "application/x-msdownload")},
            headers=acme,
        ).status_code
        == 415
    )

    run_until_idle(Worker(ModelRouter([ScriptedProvider(ScriptedCompany())]), settings, name="api-test"))

    # Deliverables are hidden from the client until a supervisor releases them.
    names = {a["name"] for a in api.get(f"/api/projects/{project['id']}/artifacts", headers=acme).json()}
    assert names == {"requirements.txt"}
    assert api.get("/api/approvals", headers=acme).json() == []

    approvals = api.get("/api/approvals", params={"project_id": project["id"]}, headers=staff["supervisor"]).json()
    [delivery] = [a for a in approvals if a["kind"] == "final_delivery"]
    forbidden = api.post(f"/api/approvals/{delivery['id']}/decide", json={"approve": True}, headers=staff["operator"])
    assert forbidden.status_code == 403
    decided = api.post(
        f"/api/approvals/{delivery['id']}/decide",
        json={"approve": True, "note": "Ship it"},
        headers=staff["supervisor"],
    )
    assert decided.status_code == 200 and decided.json()["status"] == "approved"

    summary = api.get(f"/api/projects/{project['id']}", headers=acme).json()
    assert summary["status"] == "completed"
    artifacts = api.get(f"/api/projects/{project['id']}/artifacts", headers=acme).json()
    by_name = {a["name"]: a for a in artifacts}
    assert {"final-report.md", "calculator.py"} <= set(by_name)
    download = api.get(f"/api/artifacts/{by_name['calculator.py']['id']}/download", headers=acme)
    assert download.status_code == 200 and b"def add" in download.content
    assert download.headers["content-disposition"].startswith("attachment")

    client_tasks = api.get(f"/api/projects/{project['id']}/tasks", headers=acme).json()
    assert client_tasks and "result" not in client_tasks[0]
    staff_tasks = api.get(f"/api/projects/{project['id']}/tasks", headers=staff["operator"]).json()
    assert any(t["depends_on"] for t in staff_tasks)

    feedback = api.post(f"/api/projects/{project['id']}/feedback", json={"score": 5, "comment": "Great"}, headers=acme)
    assert feedback.status_code == 200

    dashboard = api.get("/api/dashboard/executive", headers=staff["operator"]).json()
    assert dashboard["projects"]["by_status"]["completed"] == 1
    assert dashboard["tasks"]["completed"] > 5
    assert dashboard["client_satisfaction"]["average"] == 5.0
    assert dashboard["quality"]["first_pass_acceptance_rate"] == 1.0
    assert dashboard["quality"]["token_consumption"] > 0

    tech = api.get("/api/dashboard/departments/technology", headers=staff["operator"]).json()
    assert tech["metrics"]["tasks_completed"] >= 1
    assert any(r["project_title"] == "Calculator" for r in tech["reports"])

    coding_task = next(t for t in staff_tasks if t["title"] == "Implement add()")
    detail = api.get(f"/api/tasks/{coding_task['id']}", headers=staff["operator"]).json()
    assert detail["executions"][0]["transcript"][0]["type"] == "request"
    assert detail["reviews"][0]["verdict"] == "approved"

    events = api.get("/api/events", params={"project_id": project["id"]}, headers=staff["operator"]).json()
    assert any(e["action"] == "task.approved" for e in events)


def test_client_answers_clarification(api, staff, settings):
    _, acme = _client_account(api, staff, "Acme", "acme@client.io")
    project = api.post(
        "/api/projects", json={"title": "Calculator", "request": "Build me a calculator please."}, headers=acme
    ).json()
    company = ScriptedCompany()
    company.clarify_kinds = {"analyze"}
    worker = Worker(ModelRouter([ScriptedProvider(company)]), settings, name="api-test")
    run_until_idle(worker)

    summary = api.get(f"/api/projects/{project['id']}", headers=acme).json()
    assert summary["needs_client_input"] is True
    [question] = api.get("/api/approvals", headers=acme).json()
    answer = api.post(f"/api/approvals/{question['id']}/decide", json={"approve": True, "note": "3.12"}, headers=acme)
    assert answer.status_code == 200
    run_until_idle(worker)
    assert api.get(f"/api/projects/{project['id']}", headers=acme).json()["status"] == "awaiting_approval"


def test_project_controls(api, staff):
    client, _ = _client_account(api, staff, "Acme", "acme@client.io")
    project = api.post(
        "/api/projects",
        json={"title": "Report", "request": "Write a market report on EV chargers.", "client_id": client["id"]},
        headers=staff["operator"],
    ).json()
    assert api.post(f"/api/projects/{project['id']}/pause", headers=staff["operator"]).json()["status"] == "paused"
    assert api.post(f"/api/projects/{project['id']}/pause", headers=staff["operator"]).status_code == 409
    assert (
        api.post(f"/api/projects/{project['id']}/resume", headers=staff["operator"]).json()["status"] == "in_progress"
    )
    cancelled = api.post(f"/api/projects/{project['id']}/cancel", headers=staff["supervisor"]).json()
    assert cancelled["status"] == "cancelled"
    tasks = api.get(f"/api/projects/{project['id']}/tasks", headers=staff["operator"]).json()
    assert all(t["status"] == "cancelled" for t in tasks)


def test_health(api):
    body = api.get("/api/health").json()
    assert body["status"] == "ok" and body["llm_providers_configured"] == 0

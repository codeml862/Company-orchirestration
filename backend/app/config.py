"""Application settings, loaded from environment variables (see .env.example)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AICO_", extra="ignore")

    env: str = "development"
    # Local development uses a SQLite file; docker-compose and production set a PostgreSQL URL.
    database_url: str = "sqlite:///./data/aico.db"

    # Auth
    jwt_secret: str = Field(default="change-me-in-production", min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 12
    # OAuth client ID for "Sign in with Google" (Google Identity Services). Empty disables it.
    # Google sign-in only signs in existing users whose email matches; it never creates accounts.
    google_client_id: str = ""
    # Self-service "Create account": registers a new client company and its first client user.
    allow_signup: bool = True

    # Bootstrap admin, created by `python -m app.cli bootstrap` when no admin exists.
    bootstrap_admin_email: str = "admin@orchestria.local"
    bootstrap_admin_password: str = "admin-change-me"

    # Departments to load from the catalog, comma-separated keys (empty: all). Start small and add
    # departments later; `python -m app.cli sync-catalog` applies a change.
    enabled_departments: str = ""

    # Autopilot: decides routine approvals for clients whose autonomy level allows it
    # (app/governance/autopilot.py). Levels: supervised | autonomous | full.
    default_autonomy_level: str = Field(default="autonomous", pattern="^(supervised|autonomous|full)$")
    autopilot_interval_seconds: float = 10.0
    autopilot_clarification_hours: float = 24.0  # wait this long for a client's answer, then assume
    autopilot_max_task_budget_extensions: int = 2
    autopilot_max_project_budget_extensions: int = 2
    autopilot_max_delivery_revisions: int = 2

    # Orchestration engine
    worker_concurrency: int = 4
    worker_poll_seconds: float = 1.0
    task_lease_seconds: int = 600
    max_plan_tasks: int = 40
    max_delegation_depth: int = 3
    max_structured_output_repairs: int = 2
    max_tool_iterations: int = 8

    # LLM providers. JSON list of provider configs, see app/providers/router.py.
    # Left empty until API keys are configured; the worker then refuses to claim LLM tasks.
    llm_providers: str = "[]"
    llm_default_model_tier: str = "standard"

    # Storage for uploaded files and deliverables
    storage_dir: str = "./data/storage"
    max_upload_mb: int = 25
    # Readable copy of each project: its files in their folder structure plus PROJECT_LOG.md
    workspace_dir: str = "./data/workspaces"

    # Sandboxed code execution: "docker" (isolated, recommended) or "subprocess" (dev only)
    sandbox_backend: str = "docker"
    sandbox_image: str = "python:3.12-slim"
    sandbox_timeout_seconds: int = 60
    sandbox_memory_mb: int = 512

    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()

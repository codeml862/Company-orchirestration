"""Application settings, loaded from environment variables (see .env.example)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AICO_", extra="ignore")

    env: str = "development"
    database_url: str = "postgresql+psycopg://aico:aico@localhost:5432/aico"
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_secret: str = Field(default="change-me-in-production", min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 12

    # Bootstrap admin, created by `python -m app.cli bootstrap` when no admin exists.
    bootstrap_admin_email: str = "admin@aico.local"
    bootstrap_admin_password: str = "admin-change-me"

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

    # Sandboxed code execution: "docker" (isolated, recommended) or "subprocess" (dev only)
    sandbox_backend: str = "docker"
    sandbox_image: str = "python:3.12-slim"
    sandbox_timeout_seconds: int = 60
    sandbox_memory_mb: int = 512

    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()

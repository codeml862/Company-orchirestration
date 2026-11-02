"""FastAPI application."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import agents, approvals, auth, dashboard, events, projects, submissions, tasks
from app.bootstrap import sync_bootstrap_admin
from app.config import get_settings
from app.db import session_scope

log = logging.getLogger("aico.api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # backend/.env owns the first admin's login: apply edits to it on every start.
    try:
        with session_scope() as db:
            changes = sync_bootstrap_admin(db, get_settings())
        if changes:
            log.info("admin login updated from backend/.env: %s", ", ".join(changes))
    except Exception:
        log.exception("could not apply the admin login from backend/.env (is the database migrated?)")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.env == "production" and settings.jwt_secret == "change-me-in-production":
        raise RuntimeError("AICO_JWT_SECRET must be set in production")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    app = FastAPI(
        title="Orchestria - Autonomous AI Agent Outsourcing Company",
        version="0.1.0",
        description="API for the AI agent workforce platform: projects, agents, tasks, approvals and live operations.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    for module in (auth, agents, projects, submissions, tasks, approvals, dashboard, events):
        app.include_router(module.router)

    @app.get("/", include_in_schema=False)
    def root():
        """The API has no page of its own: say it is running and where to go."""
        return {"name": "Orchestria API", "status": "running", "docs": "/docs", "health": "/api/health"}

    return app


app = create_app()

"""FastAPI application."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import agents, approvals, auth, dashboard, events, projects, tasks
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.env == "production" and settings.jwt_secret == "change-me-in-production":
        raise RuntimeError("AICO_JWT_SECRET must be set in production")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    app = FastAPI(
        title="AICO - Autonomous AI Agent Outsourcing Company",
        version="0.1.0",
        description="API for the AI agent workforce platform: projects, agents, tasks, approvals and live operations.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
    )
    for module in (auth, agents, projects, tasks, approvals, dashboard, events):
        app.include_router(module.router)
    return app


app = create_app()

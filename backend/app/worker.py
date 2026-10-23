"""Background worker: claims READY tasks from the registry and runs them.

Run one or more worker processes (`python -m app.worker`); each runs N threads. Workers
coordinate only through Postgres (SKIP LOCKED claims + leases), so they scale horizontally.
"""

import logging
import os
import signal
import socket
import threading
import time

from app.agents.runner import AgentRunner
from app.config import Settings, get_settings
from app.db import session_scope
from app.orchestration import registry
from app.orchestration.engine import process_task
from app.providers.router import ModelRouter, build_router_from_settings

log = logging.getLogger("aico.worker")

LLM_BACKOFF_SECONDS = 30
REAP_INTERVAL_SECONDS = 15


class Worker:
    def __init__(self, router: ModelRouter, settings: Settings, name: str | None = None):
        self.router = router
        self.settings = settings
        self.runner = AgentRunner(router, settings)
        self.name = name or f"{socket.gethostname()}:{os.getpid()}"
        self.stop_event = threading.Event()
        self._last_reap = 0.0
        self._reap_lock = threading.Lock()

    def reap(self) -> int:
        with self._reap_lock:
            if time.monotonic() - self._last_reap < REAP_INTERVAL_SECONDS:
                return 0
            self._last_reap = time.monotonic()
        with session_scope() as db:
            count = registry.reap_expired_leases(db)
        if count:
            log.warning("recovered %d task(s) with expired leases", count)
        return count

    def run_once(self, thread_name: str) -> str | None:
        """Claim and run one task. Returns its status, or None if nothing was claimable."""
        worker_id = f"{self.name}/{thread_name}"
        with session_scope() as db:
            task = registry.claim_next(db, worker_id, self.settings.task_lease_seconds)
            task_id = task.id if task else None
        if task_id is None:
            return None
        status = process_task(task_id, worker_id, self.runner, self.settings)
        log.info("task %s -> %s", task_id, status)
        return status

    def _loop(self, thread_name: str) -> None:
        while not self.stop_event.is_set():
            try:
                self.reap()
                if not self.router.configured:
                    log.error("no LLM provider configured (AICO_LLM_PROVIDERS); not claiming tasks")
                    self.stop_event.wait(LLM_BACKOFF_SECONDS)
                    continue
                status = self.run_once(thread_name)
                if status is None:
                    self.stop_event.wait(self.settings.worker_poll_seconds)
                elif status == "llm_unavailable":
                    self.stop_event.wait(LLM_BACKOFF_SECONDS)
            except Exception:
                log.exception("worker loop error")
                self.stop_event.wait(5)

    def run_forever(self, concurrency: int) -> None:
        threads = [
            threading.Thread(target=self._loop, args=(f"t{i}",), name=f"worker-{i}", daemon=True)
            for i in range(concurrency)
        ]
        for t in threads:
            t.start()
        log.info("worker %s started with %d thread(s)", self.name, concurrency)
        while any(t.is_alive() for t in threads):
            for t in threads:
                t.join(timeout=1)

    def stop(self, *_args) -> None:
        log.info("stopping worker %s", self.name)
        self.stop_event.set()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    worker = Worker(build_router_from_settings(), settings)
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run_forever(settings.worker_concurrency)


if __name__ == "__main__":
    main()

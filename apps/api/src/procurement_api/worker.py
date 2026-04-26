from __future__ import annotations

from celery import Celery

from procurement_core.config import get_settings

from procurement_api.db import SessionLocal
from procurement_api.services import analyze_process


settings = get_settings()
celery_app = Celery("procurement_api", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_always_eager=settings.celery_task_always_eager)


@celery_app.task(name="procurement_api.analyze_process")
def analyze_process_task(process_id: str) -> dict[str, int | str]:
    session = SessionLocal()
    try:
        return analyze_process(session, process_id)
    finally:
        session.close()


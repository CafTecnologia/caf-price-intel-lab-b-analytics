from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from procurement_core.models.enums import ReviewStatus
from procurement_core.models.orm import ValidationIssue


class ReviewQueueService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def pending_for_process(self, process_id: str) -> list[ValidationIssue]:
        return (
            self.session.execute(
                select(ValidationIssue)
                .where(ValidationIssue.process_id == process_id, ValidationIssue.status == ReviewStatus.PENDING)
                .order_by(ValidationIssue.severity.desc(), ValidationIssue.created_at.asc())
            )
            .scalars()
            .all()
        )

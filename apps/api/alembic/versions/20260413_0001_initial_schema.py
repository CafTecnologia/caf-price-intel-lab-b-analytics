"""initial schema

Revision ID: 20260413_0001
Revises:
Create Date: 2026-04-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260413_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    from procurement_core.db.base import Base
    from procurement_core.models import orm  # noqa: F401

    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    from procurement_core.db.base import Base
    from procurement_core.models import orm  # noqa: F401

    Base.metadata.drop_all(bind=bind)


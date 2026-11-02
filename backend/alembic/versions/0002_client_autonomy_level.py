"""client autonomy level

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-28 23:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing clients keep today's behavior (humans decide); new ones get AICO_DEFAULT_AUTONOMY_LEVEL.
    op.add_column(
        "clients",
        sa.Column("autonomy_level", sa.String(length=16), nullable=False, server_default="supervised"),
    )


def downgrade() -> None:
    op.drop_column("clients", "autonomy_level")

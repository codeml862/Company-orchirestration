"""departments added in the app, agents owned by a client company

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-29 00:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("added_in_app", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Batch mode: SQLite cannot add a foreign key in place, so the table is rebuilt there;
    # PostgreSQL gets plain ALTER TABLE statements.
    with op.batch_alter_table("agents") as batch:
        batch.add_column(sa.Column("client_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_agents_client_id_clients", "clients", ["client_id"], ["id"], ondelete="CASCADE")
        batch.create_index("ix_agents_client_id", ["client_id"])


def downgrade() -> None:
    with op.batch_alter_table("agents") as batch:
        batch.drop_index("ix_agents_client_id")
        batch.drop_constraint("fk_agents_client_id_clients", type_="foreignkey")
        batch.drop_column("client_id")
    op.drop_column("departments", "added_in_app")

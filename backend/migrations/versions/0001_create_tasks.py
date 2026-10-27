"""Create the academic tasks table.

Revision ID: 0001_create_tasks
Revises:
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_create_tasks"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=False),
        sa.Column("task_type", sa.String(length=32), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False),
        sa.Column("priority", sa.String(length=16), server_default="normal", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="todo", nullable=False),
        sa.Column("scheduled_start_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tasks_due_status", "tasks", ["due_date", "status"])
    op.create_index("ix_tasks_scheduled_start", "tasks", ["scheduled_start_at"])


def downgrade() -> None:
    op.drop_index("ix_tasks_scheduled_start", table_name="tasks")
    op.drop_index("ix_tasks_due_status", table_name="tasks")
    op.drop_table("tasks")

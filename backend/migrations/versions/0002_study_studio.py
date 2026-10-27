"""Add retrieval chunks and persisted revision plans.

Revision ID: 0002_study_studio
Revises: 0001_create_tasks
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_study_studio"
down_revision = "0001_create_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "note_chunks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("note_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
    )
    op.create_index("ix_note_chunks_document_id", "note_chunks", ["document_id"])
    op.create_table(
        "revision_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("minutes_per_day", sa.Integer(), nullable=False),
        sa.Column("document_ids_json", sa.Text(), server_default="[]", nullable=False),
        sa.Column("sessions_json", sa.Text(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("revision_plans")
    op.drop_index("ix_note_chunks_document_id", table_name="note_chunks")
    op.drop_table("note_chunks")

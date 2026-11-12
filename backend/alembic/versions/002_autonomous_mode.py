"""Add autonomous generation mode

Revision ID: 002
Revises: 001
Create Date: 2026-11-11

Adds:
- generation_mode enum ('manual', 'autonomous')
- plan_status enum values ('autonomous_validated', 'autonomous_failed_validation')
- plan columns: generation_mode, autonomous_attempt_count, autonomous_model_name, autonomous_model_version, autonomous_validation_passed
- plan_generation_attempts table
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create generation_mode enum
    op.execute("""
        CREATE TYPE generation_mode AS ENUM ('manual', 'autonomous')
    """)
    
    # Add new values to plan_status enum
    op.execute("""
        ALTER TYPE plan_status ADD VALUE IF NOT EXISTS 'autonomous_validated'
    """)
    op.execute("""
        ALTER TYPE plan_status ADD VALUE IF NOT EXISTS 'autonomous_failed_validation'
    """)
    
    # Add generation_mode column to plans (default 'manual' for existing rows)
    op.add_column('plans', sa.Column(
        'generation_mode',
        postgresql.ENUM('manual', 'autonomous', name='generation_mode', create_type=False),
        nullable=False,
        server_default='manual',
    ))
    
    # Add autonomous mode tracking columns to plans
    op.add_column('plans', sa.Column('autonomous_attempt_count', sa.Integer(), nullable=True))
    op.add_column('plans', sa.Column('autonomous_model_name', sa.String(), nullable=True))
    op.add_column('plans', sa.Column('autonomous_model_version', sa.String(), nullable=True))
    op.add_column('plans', sa.Column('autonomous_validation_passed', sa.Boolean(), nullable=True))
    
    # Create plan_generation_attempts table
    op.create_table(
        'plan_generation_attempts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('attempt_number', sa.Integer(), nullable=False),
        sa.Column('input_context', postgresql.JSONB(), nullable=False),
        sa.Column('generated_layout', postgresql.JSONB(), nullable=False),
        sa.Column('validation_passed', sa.Boolean(), nullable=False),
        sa.Column('violations', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('error_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('warning_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('prompt_tokens', sa.Integer(), nullable=True),
        sa.Column('completion_tokens', sa.Integer(), nullable=True),
        sa.Column('total_tokens', sa.Integer(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('model_name', sa.String(), nullable=False),
        sa.Column('model_version', sa.String(), nullable=True),
        sa.Column('api_error', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('malformed_json', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('plan_gen_attempts_plan_idx', 'plan_generation_attempts', ['plan_id', 'attempt_number'])


def downgrade() -> None:
    op.drop_index('plan_gen_attempts_plan_idx', table_name='plan_generation_attempts')
    op.drop_table('plan_generation_attempts')
    
    op.drop_column('plans', 'autonomous_validation_passed')
    op.drop_column('plans', 'autonomous_model_version')
    op.drop_column('plans', 'autonomous_model_name')
    op.drop_column('plans', 'autonomous_attempt_count')
    op.drop_column('plans', 'generation_mode')
    
    op.execute('DROP TYPE IF EXISTS generation_mode')

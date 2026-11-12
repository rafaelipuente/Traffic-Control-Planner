"""Initial schema

Revision ID: 001
Revises: 
Create Date: 2026-11-08

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create extensions
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "citext"')
    
    # Create enum types
    op.execute("""
        CREATE TYPE org_role AS ENUM (
            'owner', 'admin', 'planner', 'tcs_approver', 'engineer_approver', 'viewer'
        )
    """)
    op.execute("""
        CREATE TYPE credential_kind AS ENUM ('tcs', 'pe', 'flagger', 'other')
    """)
    op.execute("""
        CREATE TYPE job_status AS ENUM (
            'intake', 'awaiting_confirmation', 'ready_to_compute', 'closed'
        )
    """)
    op.execute("""
        CREATE TYPE plan_status AS ENUM (
            'draft', 'computed', 'pending_approval', 'approved', 'rejected', 'superseded'
        )
    """)
    op.execute("""
        CREATE TYPE layout_family AS ENUM ('ottch_320_mutcd_ta10')
    """)
    op.execute("""
        CREATE TYPE approver_kind AS ENUM ('tcs', 'pe', 'knowledgeable_official')
    """)
    op.execute("""
        CREATE TYPE approval_decision AS ENUM ('approved', 'rejected')
    """)
    
    # organizations
    op.create_table(
        'organizations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('legal_name', sa.String(), nullable=True),
        sa.Column('phone', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # users
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('email', sa.String(), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('full_name', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # memberships
    op.create_table(
        'memberships',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('role', postgresql.ENUM('owner', 'admin', 'planner', 'tcs_approver', 'engineer_approver', 'viewer', name='org_role', create_type=False), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('organization_id', 'user_id', name='uq_membership_org_user'),
    )
    
    # credentials
    op.create_table(
        'credentials',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('kind', postgresql.ENUM('tcs', 'pe', 'flagger', 'other', name='credential_kind', create_type=False), nullable=False),
        sa.Column('identifier', sa.String(), nullable=False),
        sa.Column('issuing_body', sa.String(), nullable=True),
        sa.Column('expires_on', sa.Date(), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # sessions
    op.create_table(
        'sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('token_hash', sa.String(), nullable=False, unique=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('ip_address', postgresql.INET(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # jobs
    op.create_table(
        'jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('job_number', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='intake'),
        sa.Column('location_label', sa.String(), nullable=True),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('work_zone_geojson', postgresql.JSONB(), nullable=True),
        sa.Column('jurisdiction', sa.String(), nullable=False, server_default='OR'),
        sa.Column('road_authority', sa.String(), nullable=True),
        sa.Column('duration_days', sa.Numeric(6, 2), nullable=False),
        sa.Column('is_night', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('jobs_org_idx', 'jobs', ['organization_id', 'created_at'])
    
    # site_photos
    op.create_table(
        'site_photos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('uploaded_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('object_key', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('byte_size', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.String(), nullable=False),
        sa.Column('caption', sa.String(), nullable=True),
        sa.Column('taken_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # vision_extractions
    op.create_table(
        'vision_extractions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('model_name', sa.String(), nullable=False),
        sa.Column('prompt_version', sa.String(), nullable=False),
        sa.Column('proposed_payload', postgresql.JSONB(), nullable=False),
        sa.Column('confirmed_payload', postgresql.JSONB(), nullable=True),
        sa.Column('confirmed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # plans
    op.create_table(
        'plans',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('status', postgresql.ENUM('draft', 'computed', 'pending_approval', 'approved', 'rejected', 'superseded', name='plan_status', create_type=False), nullable=False, server_default='draft'),
        sa.Column('layout_family', postgresql.ENUM('ottch_320_mutcd_ta10', name='layout_family', create_type=False), nullable=False),
        sa.Column('rules_pack_version', sa.String(), nullable=False),
        sa.Column('required_approver_kind', postgresql.ENUM('tcs', 'pe', 'knowledgeable_official', name='approver_kind', create_type=False), nullable=False),
        sa.Column('disclaimer', sa.String(), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('job_id', 'revision', name='uq_plan_job_revision'),
    )
    op.create_index('plans_job_idx', 'plans', ['job_id', 'revision'])
    
    # plan_computations
    op.create_table(
        'plan_computations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('field_key', sa.String(), nullable=False),
        sa.Column('value_numeric', sa.Numeric(), nullable=True),
        sa.Column('value_text', sa.String(), nullable=True),
        sa.Column('unit', sa.String(), nullable=True),
        sa.Column('formula', sa.String(), nullable=True),
        sa.Column('source_doc', sa.String(), nullable=False),
        sa.Column('source_ref', sa.String(), nullable=False),
        sa.Column('source_url', sa.String(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.UniqueConstraint('plan_id', 'field_key', name='uq_computation_plan_field'),
    )
    
    # plan_devices
    op.create_table(
        'plan_devices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_kind', sa.String(), nullable=False),
        sa.Column('mutcd_code', sa.String(), nullable=True),
        sa.Column('sequence_order', sa.Integer(), nullable=True),
        sa.Column('station_role', sa.String(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('spacing_ft', sa.Numeric(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('source_ref', sa.String(), nullable=False),
        sa.CheckConstraint('quantity >= 0', name='ck_device_quantity_nonneg'),
    )
    
    # plan_documents
    op.create_table(
        'plan_documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('object_key', sa.String(), nullable=False),
        sa.Column('banner', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # approvals
    op.create_table(
        'approvals',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('approver_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('credential_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('credentials.id'), nullable=False),
        sa.Column('decision', postgresql.ENUM('approved', 'rejected', name='approval_decision', create_type=False), nullable=False),
        sa.Column('attestation', sa.String(), nullable=False),
        sa.Column('comments', sa.String(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    
    # audit_events
    op.create_table(
        'audit_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('actor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('before_hash', sa.String(), nullable=True),
        sa.Column('after_hash', sa.String(), nullable=True),
        sa.Column('payload', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('ip_address', postgresql.INET(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('audit_events_entity_idx', 'audit_events', ['entity_type', 'entity_id', 'created_at'])
    
    # rules_tables
    op.create_table(
        'rules_tables',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('pack_version', sa.String(), nullable=False),
        sa.Column('table_id', sa.String(), nullable=False),
        sa.Column('source_doc', sa.String(), nullable=False),
        sa.Column('source_url', sa.String(), nullable=False),
        sa.Column('rows', postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint('pack_version', 'table_id', name='uq_rules_pack_table'),
    )


def downgrade() -> None:
    op.drop_table('rules_tables')
    op.drop_table('audit_events')
    op.drop_table('approvals')
    op.drop_table('plan_documents')
    op.drop_table('plan_devices')
    op.drop_table('plan_computations')
    op.drop_table('plans')
    op.drop_table('vision_extractions')
    op.drop_table('site_photos')
    op.drop_table('jobs')
    op.drop_table('sessions')
    op.drop_table('credentials')
    op.drop_table('memberships')
    op.drop_table('users')
    op.drop_table('organizations')
    
    op.execute('DROP TYPE IF EXISTS approval_decision')
    op.execute('DROP TYPE IF EXISTS approver_kind')
    op.execute('DROP TYPE IF EXISTS layout_family')
    op.execute('DROP TYPE IF EXISTS plan_status')
    op.execute('DROP TYPE IF EXISTS job_status')
    op.execute('DROP TYPE IF EXISTS credential_kind')
    op.execute('DROP TYPE IF EXISTS org_role')

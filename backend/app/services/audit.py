"""Audit logging service."""
from uuid import UUID
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from app.models import AuditEvent
import hashlib
import json


def log_audit_event(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: Optional[UUID] = None,
    organization_id: Optional[UUID] = None,
    actor_id: Optional[UUID] = None,
    payload: Optional[Dict[str, Any]] = None,
    before_state: Optional[Dict[str, Any]] = None,
    after_state: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> AuditEvent:
    """
    Log an audit event (insert-only).
    
    Args:
        db: Database session
        action: Action name (e.g., "user.login", "plan.approve")
        entity_type: Type of entity affected
        entity_id: ID of the entity
        organization_id: Organization context
        actor_id: User who performed the action
        payload: Additional event data
        before_state: State before change (for diffs)
        after_state: State after change (for diffs)
        ip_address: Client IP address
        user_agent: Client user agent
    """
    before_hash = None
    after_hash = None
    
    if before_state:
        before_hash = hashlib.sha256(json.dumps(before_state, sort_keys=True, default=str).encode()).hexdigest()
    
    if after_state:
        after_hash = hashlib.sha256(json.dumps(after_state, sort_keys=True, default=str).encode()).hexdigest()
    
    event = AuditEvent(
        organization_id=organization_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_hash=before_hash,
        after_hash=after_hash,
        payload=payload or {},
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(event)
    db.commit()
    
    return event

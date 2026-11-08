"""Organization API routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Organization, User, Membership, OrgRole
from app.auth.dependencies import get_current_active_user, require_role
from app.schemas.organization import (
    OrganizationCreate,
    OrganizationResponse,
    MembershipCreate,
    MembershipResponse,
)
from app.services.audit import log_audit_event

router = APIRouter()


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    org_data: OrganizationCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Create a new organization. Caller becomes owner."""
    org = Organization(
        name=org_data.name,
        legal_name=org_data.legal_name,
        phone=org_data.phone,
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    
    # Make creator the owner
    membership = Membership(
        organization_id=org.id,
        user_id=current_user.id,
        role=OrgRole.owner,
    )
    db.add(membership)
    db.commit()
    
    log_audit_event(
        db=db,
        organization_id=org.id,
        actor_id=current_user.id,
        action="organization.create",
        entity_type="organization",
        entity_id=org.id,
        payload={"name": org.name},
    )
    
    return org


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get organization details (member access)."""
    # Check membership
    membership = db.query(Membership).filter(
        Membership.organization_id == org_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )
    
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    
    return org


@router.post("/{org_id}/members", response_model=MembershipResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    org_id: UUID,
    member_data: MembershipCreate,
    current_user: User = Depends(require_role(OrgRole.owner, OrgRole.admin)),
    db: Session = Depends(get_db),
):
    """Add a member to the organization (owner/admin only)."""
    # Find user by email
    user = db.query(User).filter(User.email == member_data.email.lower()).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Check if already a member
    existing = db.query(Membership).filter(
        Membership.organization_id == org_id,
        Membership.user_id == user.id,
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member",
        )
    
    membership = Membership(
        organization_id=org_id,
        user_id=user.id,
        role=member_data.role,
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    
    log_audit_event(
        db=db,
        organization_id=org_id,
        actor_id=current_user.id,
        action="membership.create",
        entity_type="membership",
        entity_id=membership.id,
        payload={"user_email": user.email, "role": member_data.role.value},
    )
    
    return membership


@router.patch("/{org_id}/members/{user_id}", response_model=MembershipResponse)
async def update_member_role(
    org_id: UUID,
    user_id: UUID,
    role: OrgRole,
    current_user: User = Depends(require_role(OrgRole.owner, OrgRole.admin)),
    db: Session = Depends(get_db),
):
    """Update a member's role (owner/admin only)."""
    membership = db.query(Membership).filter(
        Membership.organization_id == org_id,
        Membership.user_id == user_id,
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership not found",
        )
    
    old_role = membership.role
    membership.role = role
    db.commit()
    db.refresh(membership)
    
    log_audit_event(
        db=db,
        organization_id=org_id,
        actor_id=current_user.id,
        action="membership.update",
        entity_type="membership",
        entity_id=membership.id,
        payload={"old_role": old_role.value, "new_role": role.value},
    )
    
    return membership

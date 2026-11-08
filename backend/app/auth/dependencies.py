"""FastAPI auth dependencies."""
from typing import Optional, Callable
from uuid import UUID
from fastapi import Depends, HTTPException, status, Request, Cookie
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Membership, OrgRole
from app.auth.jwt import verify_token, hash_token_for_storage
from app.models.session import Session as SessionModel


async def get_current_user(
    request: Request,
    access_token: Optional[str] = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the current user from the access token cookie."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if not access_token:
        raise credentials_exception
    
    token_data = verify_token(access_token)
    if token_data is None or token_data.token_type != "access":
        raise credentials_exception
    
    # Verify session is still valid in database
    token_hash = hash_token_for_storage(access_token)
    session = db.query(SessionModel).filter(
        SessionModel.user_id == token_data.user_id,
        SessionModel.id == token_data.session_id,
    ).first()
    
    if session is None or not session.is_valid:
        raise credentials_exception
    
    user = db.query(User).filter(User.id == token_data.user_id).first()
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the current user is active."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return current_user


def require_role(*roles: OrgRole) -> Callable:
    """
    Dependency factory that checks if user has one of the required roles in an org.
    Use with path parameters like org_id.
    """
    async def check_role(
        org_id: UUID,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ) -> User:
        membership = db.query(Membership).filter(
            Membership.organization_id == org_id,
            Membership.user_id == current_user.id,
        ).first()
        
        if membership is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a member of this organization",
            )
        
        if membership.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {[r.value for r in roles]}",
            )
        
        return current_user
    
    return check_role


def get_user_org_role(user_id: UUID, org_id: UUID, db: Session) -> Optional[OrgRole]:
    """Helper to get a user's role in an organization."""
    membership = db.query(Membership).filter(
        Membership.organization_id == org_id,
        Membership.user_id == user_id,
    ).first()
    return membership.role if membership else None

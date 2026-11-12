"""Authentication API routes."""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.models.session import Session as SessionModel
from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
)
from app.auth.jwt import hash_token_for_storage
from app.auth.dependencies import get_current_active_user
from app.schemas.auth import UserCreate, UserLogin, UserResponse, TokenResponse
from app.config import get_settings
from app.services.audit import log_audit_event

router = APIRouter()
settings = get_settings()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    response: Response,
    db: Session = Depends(get_db),
):
    """Register a new user."""
    # Check if email already exists
    existing = db.query(User).filter(User.email == user_data.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    
    # Create user
    user = User(
        email=user_data.email.lower(),
        password_hash=hash_password(user_data.password),
        full_name=user_data.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Create session and set cookies
    session = _create_session(user, db, response)
    
    # Log audit event
    log_audit_event(
        db=db,
        actor_id=user.id,
        action="user.register",
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email},
    )
    
    return user


@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin,
    response: Response,
    db: Session = Depends(get_db),
):
    """Login and get access token."""
    user = db.query(User).filter(User.email == credentials.email.lower()).first()
    
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    
    # Create session
    session = _create_session(user, db, response)
    access_token = create_access_token(user.id, session.id)
    
    # Log audit event
    log_audit_event(
        db=db,
        actor_id=user.id,
        action="user.login",
        entity_type="session",
        entity_id=session.id,
    )
    
    return TokenResponse(
        access_token=access_token,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post("/logout")
async def logout(
    response: Response,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Logout and revoke session."""
    # Clear cookies
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    
    # Log audit event
    log_audit_event(
        db=db,
        actor_id=current_user.id,
        action="user.logout",
        entity_type="user",
        entity_id=current_user.id,
    )
    
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
):
    """Get current user info."""
    return current_user


def _create_session(user: User, db: Session, response: Response) -> SessionModel:
    """Create a new session and set cookies."""
    session = SessionModel(
        user_id=user.id,
        token_hash="placeholder",  # Will update after generating token
        expires_at=datetime.utcnow() + timedelta(days=settings.jwt_refresh_token_expire_days),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    
    # Generate tokens
    access_token = create_access_token(user.id, session.id)
    refresh_token = create_refresh_token(user.id, session.id)
    
    # Update session with token hash
    session.token_hash = hash_token_for_storage(access_token)
    db.commit()
    
    # Set httpOnly cookies
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=not settings.is_development,
        samesite="lax",
        max_age=settings.jwt_access_token_expire_minutes * 60,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=not settings.is_development,
        samesite="lax",
        max_age=settings.jwt_refresh_token_expire_days * 24 * 60 * 60,
    )
    
    return session

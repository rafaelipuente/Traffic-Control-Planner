"""JWT token creation and verification."""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
import hashlib
from jose import jwt, JWTError
from pydantic import BaseModel
from app.config import get_settings

settings = get_settings()


class TokenData(BaseModel):
    """Data extracted from a verified JWT."""
    user_id: UUID
    session_id: UUID
    token_type: str
    exp: datetime


def create_access_token(user_id: UUID, session_id: UUID) -> str:
    """Create a short-lived access token."""
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: UUID, session_id: UUID) -> str:
    """Create a long-lived refresh token."""
    expire = datetime.utcnow() + timedelta(days=settings.jwt_refresh_token_expire_days)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "type": "refresh",
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> Optional[TokenData]:
    """Verify and decode a JWT. Returns None if invalid."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        return TokenData(
            user_id=UUID(payload["sub"]),
            session_id=UUID(payload["sid"]),
            token_type=payload["type"],
            exp=datetime.fromtimestamp(payload["exp"]),
        )
    except (JWTError, KeyError, ValueError):
        return None


def hash_token_for_storage(token: str) -> str:
    """Hash a token for secure storage in the database."""
    return hashlib.sha256(token.encode()).hexdigest()

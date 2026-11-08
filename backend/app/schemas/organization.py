"""Organization-related schemas."""
from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field, EmailStr
from app.models.membership import OrgRole


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1)
    legal_name: Optional[str] = None
    phone: Optional[str] = None


class OrganizationResponse(BaseModel):
    id: UUID
    name: str
    legal_name: Optional[str]
    phone: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MembershipCreate(BaseModel):
    email: EmailStr
    role: OrgRole


class MembershipResponse(BaseModel):
    id: UUID
    organization_id: UUID
    user_id: UUID
    role: OrgRole
    created_at: datetime

    class Config:
        from_attributes = True

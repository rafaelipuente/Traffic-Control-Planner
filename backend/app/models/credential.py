"""Credential model for TCS/PE certifications."""
import uuid
from datetime import datetime, date
from enum import Enum as PyEnum
from sqlalchemy import Column, String, ForeignKey, DateTime, Date, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class CredentialKind(str, PyEnum):
    tcs = "tcs"
    pe = "pe"
    flagger = "flagger"
    other = "other"


class Credential(Base):
    __tablename__ = "credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    kind = Column(Enum(CredentialKind, name="credential_kind"), nullable=False)
    identifier = Column(String, nullable=False)
    issuing_body = Column(String, nullable=True)
    expires_on = Column(Date, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="credentials")
    organization = relationship("Organization", back_populates="credentials")
    approvals = relationship("Approval", back_populates="credential")

    @property
    def is_expired(self) -> bool:
        if self.expires_on is None:
            return False
        return self.expires_on < date.today()

    @property
    def is_valid(self) -> bool:
        return not self.is_expired

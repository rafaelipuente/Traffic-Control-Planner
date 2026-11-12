"""User model."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan")
    credentials = relationship("Credential", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    jobs_created = relationship("Job", back_populates="created_by_user", foreign_keys="Job.created_by")
    photos_uploaded = relationship("SitePhoto", back_populates="uploaded_by_user")
    vision_confirmations = relationship("VisionExtraction", back_populates="confirmed_by_user", foreign_keys="VisionExtraction.confirmed_by")
    plans_created = relationship("Plan", back_populates="created_by_user")
    approvals = relationship("Approval", back_populates="approver")
    audit_events = relationship("AuditEvent", back_populates="actor")

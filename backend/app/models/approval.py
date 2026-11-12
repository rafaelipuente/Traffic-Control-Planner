"""Approval model for plan sign-offs."""
import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import Column, String, ForeignKey, DateTime, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class ApprovalDecision(str, PyEnum):
    approved = "approved"
    rejected = "rejected"


class Approval(Base):
    __tablename__ = "approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    approver_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    credential_id = Column(UUID(as_uuid=True), ForeignKey("credentials.id"), nullable=False)
    decision = Column(Enum(ApprovalDecision, name="approval_decision"), nullable=False)
    attestation = Column(String, nullable=False)
    comments = Column(String, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    plan = relationship("Plan", back_populates="approvals")
    approver = relationship("User", back_populates="approvals")
    credential = relationship("Credential", back_populates="approvals")

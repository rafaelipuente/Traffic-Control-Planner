"""Plan model for traffic control plans."""
import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Enum, UniqueConstraint, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PlanStatus(str, PyEnum):
    draft = "draft"
    computed = "computed"
    pending_approval = "pending_approval"
    approved = "approved"
    rejected = "rejected"
    superseded = "superseded"
    # New statuses for autonomous mode
    autonomous_validated = "autonomous_validated"
    autonomous_failed_validation = "autonomous_failed_validation"


class GenerationMode(str, PyEnum):
    """Plan generation mode: manual (human-in-loop) or autonomous (AI only)."""
    manual = "manual"
    autonomous = "autonomous"


class LayoutFamily(str, PyEnum):
    ottch_320_mutcd_ta10 = "ottch_320_mutcd_ta10"


class ApproverKind(str, PyEnum):
    tcs = "tcs"
    pe = "pe"
    knowledgeable_official = "knowledgeable_official"


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (
        UniqueConstraint("job_id", "revision", name="uq_plan_job_revision"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    revision = Column(Integer, nullable=False)
    status = Column(Enum(PlanStatus, name="plan_status"), nullable=False, default=PlanStatus.draft)
    layout_family = Column(Enum(LayoutFamily, name="layout_family"), nullable=False)
    rules_pack_version = Column(String, nullable=False)
    required_approver_kind = Column(Enum(ApproverKind, name="approver_kind"), nullable=False)
    disclaimer = Column(String, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    
    # Generation mode (manual or autonomous)
    generation_mode = Column(
        Enum(GenerationMode, name="generation_mode"),
        nullable=False,
        default=GenerationMode.manual,
    )
    
    # Autonomous mode fields
    autonomous_attempt_count = Column(Integer, nullable=True)
    autonomous_model_name = Column(String, nullable=True)
    autonomous_model_version = Column(String, nullable=True)
    autonomous_validation_passed = Column(Boolean, nullable=True)

    # Relationships
    job = relationship("Job", back_populates="plans")
    created_by_user = relationship("User", back_populates="plans_created")
    computations = relationship("PlanComputation", back_populates="plan", cascade="all, delete-orphan")
    devices = relationship("PlanDevice", back_populates="plan", cascade="all, delete-orphan")
    documents = relationship("PlanDocument", back_populates="plan", cascade="all, delete-orphan")
    approvals = relationship("Approval", back_populates="plan", cascade="all, delete-orphan")
    generation_attempts = relationship("PlanGenerationAttempt", back_populates="plan", cascade="all, delete-orphan")

    @property
    def is_approved(self) -> bool:
        return self.status == PlanStatus.approved

    @property
    def requires_pe_stamp(self) -> bool:
        """Check if PE stamp is needed (state highway jurisdiction)."""
        if self.job and self.job.road_authority:
            return "ODOT" in self.job.road_authority.upper() or "state" in self.job.road_authority.lower()
        return False

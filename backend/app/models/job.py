"""Job model for work zone projects."""
import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum as PyEnum
from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, Numeric, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class JobStatus(str, PyEnum):
    intake = "intake"
    awaiting_confirmation = "awaiting_confirmation"
    ready_to_compute = "ready_to_compute"
    closed = "closed"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    job_number = Column(String, nullable=True)
    status = Column(String, nullable=False, default=JobStatus.intake.value)
    location_label = Column(String, nullable=True)
    address = Column(String, nullable=True)
    longitude = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    work_zone_geojson = Column(JSONB, nullable=True)
    jurisdiction = Column(String, nullable=False, default="OR")
    road_authority = Column(String, nullable=True)
    duration_days = Column(Numeric(6, 2), nullable=False)
    is_night = Column(Boolean, nullable=False, default=False)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="jobs")
    created_by_user = relationship("User", back_populates="jobs_created", foreign_keys=[created_by])
    photos = relationship("SitePhoto", back_populates="job", cascade="all, delete-orphan")
    vision_extractions = relationship("VisionExtraction", back_populates="job", cascade="all, delete-orphan")
    plans = relationship("Plan", back_populates="job", cascade="all, delete-orphan")

    @property
    def uses_ottch_short_term(self) -> bool:
        """Check if job qualifies for OTTCH short-term rules (3 days or less)."""
        return self.duration_days is not None and Decimal(str(self.duration_days)) <= Decimal("3")

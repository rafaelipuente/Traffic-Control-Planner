"""VisionExtraction model for Claude vision results."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class VisionExtraction(Base):
    __tablename__ = "vision_extractions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    model_name = Column(String, nullable=False)
    prompt_version = Column(String, nullable=False)
    proposed_payload = Column(JSONB, nullable=False)
    confirmed_payload = Column(JSONB, nullable=True)
    confirmed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    job = relationship("Job", back_populates="vision_extractions")
    confirmed_by_user = relationship("User", back_populates="vision_confirmations", foreign_keys=[confirmed_by])

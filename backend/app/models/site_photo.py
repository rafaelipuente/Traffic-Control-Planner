"""SitePhoto model for uploaded work zone images."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class SitePhoto(Base):
    __tablename__ = "site_photos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    object_key = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    byte_size = Column(Integer, nullable=False)
    sha256 = Column(String, nullable=False)
    caption = Column(String, nullable=True)
    taken_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    job = relationship("Job", back_populates="photos")
    uploaded_by_user = relationship("User", back_populates="photos_uploaded")

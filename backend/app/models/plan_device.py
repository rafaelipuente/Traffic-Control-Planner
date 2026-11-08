"""PlanDevice model for TCP devices (signs, cones, flaggers, etc.)."""
import uuid
from sqlalchemy import Column, String, Integer, ForeignKey, Numeric, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PlanDevice(Base):
    __tablename__ = "plan_devices"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_device_quantity_nonneg"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    device_kind = Column(String, nullable=False)
    mutcd_code = Column(String, nullable=True)
    sequence_order = Column(Integer, nullable=True)
    station_role = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    spacing_ft = Column(Numeric, nullable=True)
    notes = Column(String, nullable=True)
    source_ref = Column(String, nullable=False)

    # Relationships
    plan = relationship("Plan", back_populates="devices")

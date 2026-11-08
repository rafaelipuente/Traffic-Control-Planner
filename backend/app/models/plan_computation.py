"""PlanComputation model for rules engine outputs with citations."""
import uuid
from decimal import Decimal
from sqlalchemy import Column, String, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PlanComputation(Base):
    __tablename__ = "plan_computations"
    __table_args__ = (
        UniqueConstraint("plan_id", "field_key", name="uq_computation_plan_field"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    field_key = Column(String, nullable=False)
    value_numeric = Column(Numeric, nullable=True)
    value_text = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    formula = Column(String, nullable=True)
    source_doc = Column(String, nullable=False)
    source_ref = Column(String, nullable=False)
    source_url = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    # Relationships
    plan = relationship("Plan", back_populates="computations")

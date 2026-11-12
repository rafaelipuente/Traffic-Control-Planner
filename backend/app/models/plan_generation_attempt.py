"""Plan generation attempt model for tracking autonomous generation loops."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Float, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class PlanGenerationAttempt(Base):
    """
    Records each attempt during autonomous plan generation.
    
    Tracks the AI-generated layout, validation results, token usage, and timing.
    Used for audit trail and debugging of the self-correction loop.
    """
    __tablename__ = "plan_generation_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    
    # Attempt sequencing
    attempt_number = Column(Integer, nullable=False)  # 1-indexed
    
    # Input context sent to AI
    input_context = Column(JSONB, nullable=False)  # site facts, photos, previous violations
    
    # AI-generated layout (raw structured output)
    generated_layout = Column(JSONB, nullable=False)
    
    # Validation results
    validation_passed = Column(Boolean, nullable=False)
    violations = Column(JSONB, nullable=False, default=list)  # List of violation objects
    error_count = Column(Integer, nullable=False, default=0)
    warning_count = Column(Integer, nullable=False, default=0)
    
    # Token usage and timing
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    
    # Model information
    model_name = Column(String, nullable=False)
    model_version = Column(String, nullable=True)
    
    # Error handling
    api_error = Column(Boolean, nullable=False, default=False)
    error_message = Column(Text, nullable=True)
    malformed_json = Column(Boolean, nullable=False, default=False)
    
    # Timestamps
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    plan = relationship("Plan", back_populates="generation_attempts")

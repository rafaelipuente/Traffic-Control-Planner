"""RulesTable model for versioned MUTCD/OTTCH table data."""
import uuid
from sqlalchemy import Column, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class RulesTable(Base):
    __tablename__ = "rules_tables"
    __table_args__ = (
        UniqueConstraint("pack_version", "table_id", name="uq_rules_pack_table"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pack_version = Column(String, nullable=False)
    table_id = Column(String, nullable=False)
    source_doc = Column(String, nullable=False)
    source_url = Column(String, nullable=False)
    rows = Column(JSONB, nullable=False)

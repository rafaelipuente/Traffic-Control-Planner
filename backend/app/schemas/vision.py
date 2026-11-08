"""Vision extraction schemas."""
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List
from pydantic import BaseModel


class VisionField(BaseModel):
    """A proposed field from vision extraction."""
    value: Any
    confidence: float
    evidence: Optional[str] = None
    needs_confirm: bool = True


class VisionProposal(BaseModel):
    """Proposed site facts from vision extraction."""
    road_type: Optional[VisionField] = None
    lane_count: Optional[VisionField] = None
    lane_width_ft: Optional[VisionField] = None
    shoulder_present: Optional[VisionField] = None
    posted_speed_mph: Optional[VisionField] = None
    visible_hazards: Optional[List[VisionField]] = None
    intersections_nearby: Optional[VisionField] = None
    suggested_layout_family: Optional[VisionField] = None
    raw_observations: Optional[str] = None


class VisionConfirm(BaseModel):
    """User confirmation of vision extraction."""
    posted_or_statutory_speed_mph: int
    road_context: str
    lane_count: int
    lane_width_ft: float
    work_length_ft: float
    is_night: bool
    sight_distance_ft: Optional[float] = None
    adt: Optional[int] = None


class VisionExtractionResponse(BaseModel):
    id: UUID
    job_id: UUID
    model_name: str
    prompt_version: str
    proposed_payload: Dict[str, Any]
    confirmed_payload: Optional[Dict[str, Any]]
    confirmed_by: Optional[UUID]
    confirmed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True

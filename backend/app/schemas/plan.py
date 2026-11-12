"""Plan-related schemas."""
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from app.models.plan import LayoutFamily, ApproverKind, GenerationMode


class SiteFactsInput(BaseModel):
    """Site facts for plan computation."""
    posted_or_statutory_speed_mph: int
    speed_basis: str = "posted"
    road_context: str = "rural"
    lane_count: int = 2
    opposing_directions: bool = True
    lane_width_ft: Decimal = Decimal("12")
    shoulder_width_ft: Optional[Decimal] = None
    work_length_ft: Decimal
    is_night: bool = False
    sight_distance_ft: Optional[Decimal] = None
    adt: Optional[int] = None


class PlanCreate(BaseModel):
    """Request to create a plan (manual mode with rules engine)."""
    layout_family: LayoutFamily = LayoutFamily.ottch_320_mutcd_ta10
    site_facts: SiteFactsInput
    generation_mode: GenerationMode = GenerationMode.manual


class AutonomousPlanCreate(BaseModel):
    """Request to create a plan in autonomous mode (AI generates everything)."""
    layout_family: LayoutFamily = LayoutFamily.ottch_320_mutcd_ta10
    site_facts: SiteFactsInput
    site_photos_summary: Optional[str] = None  # Optional photo analysis summary


class ComputationResponse(BaseModel):
    """Response with computation results."""
    layout_family: str
    rules_pack_version: str
    sign_sequence: List[Dict[str, Any]]
    spacing_A_ft: Dict[str, Any]
    spacing_B_ft: Dict[str, Any]
    spacing_C_ft: Dict[str, Any]
    taper_type: str
    taper_length_ft: Dict[str, Any]
    downstream_taper_length_ft: Dict[str, Any]
    taper_device_spacing_ft: Dict[str, Any]
    tangent_device_spacing_ft: Dict[str, Any]
    buffer_length_ft: Dict[str, Any]
    mutcd_ssd_ft: Dict[str, Any]
    flagger_count: Dict[str, Any]
    flagger_station_notes: List[str]
    cones_per_taper: Dict[str, Any]
    cones_tangent: Dict[str, Any]
    signs_count: int
    arrow_board_required: bool
    arrow_board_mode: Optional[str]
    refused_reasons: List[str]


class PlanResponse(BaseModel):
    id: UUID
    job_id: UUID
    revision: int
    status: str
    layout_family: str
    rules_pack_version: str
    required_approver_kind: str
    disclaimer: str
    created_by: UUID
    created_at: datetime
    computation: Optional[ComputationResponse] = None
    generation_mode: str = "manual"
    autonomous_attempt_count: Optional[int] = None
    autonomous_model_name: Optional[str] = None
    autonomous_validation_passed: Optional[bool] = None

    class Config:
        from_attributes = True


class GenerationAttemptResponse(BaseModel):
    """Response for a single generation attempt."""
    attempt_number: int
    validation_passed: bool
    error_count: int
    warning_count: int
    violations: List[Dict[str, Any]]
    latency_ms: Optional[int]
    model_name: str


class AutonomousPlanResponse(BaseModel):
    """Response for autonomous plan generation."""
    plan: PlanResponse
    success: bool
    total_attempts: int
    best_attempt_number: Optional[int]
    attempts: List[GenerationAttemptResponse]
    remaining_violations: Optional[List[Dict[str, Any]]] = None


class ApprovalCreate(BaseModel):
    """Request to approve or reject a plan."""
    decision: str  # "approved" or "rejected"
    credential_id: UUID
    attestation: str
    comments: Optional[str] = None

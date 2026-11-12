"""Job-related schemas."""
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional, Any, Dict
from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    title: str = Field(min_length=1)
    job_number: Optional[str] = None
    location_label: Optional[str] = None
    address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    work_zone_geojson: Optional[Dict[str, Any]] = None
    jurisdiction: str = "OR"
    road_authority: Optional[str] = None
    duration_days: Decimal = Field(gt=0, le=365)
    is_night: bool = False
    notes: Optional[str] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    job_number: Optional[str] = None
    location_label: Optional[str] = None
    address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    work_zone_geojson: Optional[Dict[str, Any]] = None
    road_authority: Optional[str] = None
    duration_days: Optional[Decimal] = None
    is_night: Optional[bool] = None
    notes: Optional[str] = None


class JobResponse(BaseModel):
    id: UUID
    organization_id: UUID
    created_by: UUID
    title: str
    job_number: Optional[str]
    status: str
    location_label: Optional[str]
    address: Optional[str]
    longitude: Optional[float]
    latitude: Optional[float]
    work_zone_geojson: Optional[Dict[str, Any]]
    jurisdiction: str
    road_authority: Optional[str]
    duration_days: Decimal
    is_night: bool
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

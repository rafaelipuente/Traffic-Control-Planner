"""Job API routes."""
from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Job, User, Membership, OrgRole, JobStatus
from app.auth.dependencies import get_current_active_user, require_role
from app.schemas.job import JobCreate, JobUpdate, JobResponse
from app.services.audit import log_audit_event

router = APIRouter()


@router.post("/orgs/{org_id}/jobs", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    org_id: UUID,
    job_data: JobCreate,
    current_user: User = Depends(require_role(OrgRole.owner, OrgRole.admin, OrgRole.planner)),
    db: Session = Depends(get_db),
):
    """Create a new job (planner+ role)."""
    job = Job(
        organization_id=org_id,
        created_by=current_user.id,
        title=job_data.title,
        job_number=job_data.job_number,
        location_label=job_data.location_label,
        address=job_data.address,
        longitude=job_data.longitude,
        latitude=job_data.latitude,
        work_zone_geojson=job_data.work_zone_geojson,
        jurisdiction=job_data.jurisdiction,
        road_authority=job_data.road_authority,
        duration_days=job_data.duration_days,
        is_night=job_data.is_night,
        notes=job_data.notes,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    
    log_audit_event(
        db=db,
        organization_id=org_id,
        actor_id=current_user.id,
        action="job.create",
        entity_type="job",
        entity_id=job.id,
        payload={"title": job.title},
    )
    
    return job


@router.get("/orgs/{org_id}/jobs", response_model=List[JobResponse])
async def list_jobs(
    org_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """List jobs in an organization (member access)."""
    # Check membership
    membership = db.query(Membership).filter(
        Membership.organization_id == org_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )
    
    jobs = db.query(Job).filter(Job.organization_id == org_id).order_by(Job.created_at.desc()).all()
    return jobs


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get job details (member access)."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    
    # Check membership
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this organization",
        )
    
    return job


@router.patch("/jobs/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: UUID,
    job_data: JobUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update job details (planner+ role)."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    
    # Check planner role
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership or membership.role not in [OrgRole.owner, OrgRole.admin, OrgRole.planner]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Planner role required",
        )
    
    update_data = job_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(job, field, value)
    
    db.commit()
    db.refresh(job)
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="job.update",
        entity_type="job",
        entity_id=job.id,
        payload=update_data,
    )
    
    return job

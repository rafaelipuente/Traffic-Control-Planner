"""Vision extraction API routes using Claude."""
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import json
from app.database import get_db
from app.models import Job, User, Membership, OrgRole, VisionExtraction, JobStatus
from app.auth.dependencies import get_current_active_user
from app.schemas.vision import VisionProposal, VisionConfirm, VisionExtractionResponse
from app.services.audit import log_audit_event
from app.services.vision_service import VisionService

router = APIRouter()


@router.post("/jobs/{job_id}/vision", response_model=VisionExtractionResponse)
async def run_vision_extraction(
    job_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Run Claude vision on job photos to extract site facts.
    Returns proposed values that MUST be confirmed by user before plan generation.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    
    # Check planner role
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership or membership.role not in [OrgRole.owner, OrgRole.admin, OrgRole.planner]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Planner role required")
    
    # Check for photos
    if not job.photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No photos uploaded for this job",
        )
    
    # Run vision extraction
    vision_service = VisionService()
    try:
        proposal = await vision_service.extract_site_facts(job.photos)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Vision extraction failed: {str(e)}",
        )
    
    # Store extraction
    extraction = VisionExtraction(
        job_id=job.id,
        model_name=vision_service.model_name,
        prompt_version=vision_service.prompt_version,
        proposed_payload=proposal,
    )
    db.add(extraction)
    
    # Update job status
    job.status = JobStatus.awaiting_confirmation.value
    
    db.commit()
    db.refresh(extraction)
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="vision.extract",
        entity_type="vision_extraction",
        entity_id=extraction.id,
    )
    
    return extraction


@router.post("/jobs/{job_id}/vision/{extraction_id}/confirm", response_model=VisionExtractionResponse)
async def confirm_vision_extraction(
    job_id: UUID,
    extraction_id: UUID,
    confirmation: VisionConfirm,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Confirm (or edit) vision extraction results.
    This step is REQUIRED before plan generation.
    """
    extraction = db.query(VisionExtraction).filter(
        VisionExtraction.id == extraction_id,
        VisionExtraction.job_id == job_id,
    ).first()
    
    if not extraction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Extraction not found")
    
    job = db.query(Job).filter(Job.id == job_id).first()
    
    # Check planner role
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership or membership.role not in [OrgRole.owner, OrgRole.admin, OrgRole.planner]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Planner role required")
    
    # Store confirmed payload
    extraction.confirmed_payload = confirmation.model_dump()
    extraction.confirmed_by = current_user.id
    extraction.confirmed_at = datetime.utcnow()
    
    # Update job status
    job.status = JobStatus.ready_to_compute.value
    
    db.commit()
    db.refresh(extraction)
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="vision.confirm",
        entity_type="vision_extraction",
        entity_id=extraction.id,
        payload={"confirmed_fields": list(confirmation.model_dump().keys())},
    )
    
    return extraction


@router.get("/jobs/{job_id}/vision", response_model=list[VisionExtractionResponse])
async def list_vision_extractions(
    job_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """List vision extractions for a job."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    
    # Check membership
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    extractions = db.query(VisionExtraction).filter(
        VisionExtraction.job_id == job_id
    ).order_by(VisionExtraction.created_at.desc()).all()
    
    return extractions

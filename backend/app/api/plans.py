"""Plan API routes."""
import os
from uuid import UUID
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import (
    Job, Plan, PlanStatus, PlanComputation, PlanDevice, User, Membership, OrgRole,
    Approval, ApprovalDecision, Credential, CredentialKind, ApproverKind, GenerationMode,
    PlanGenerationAttempt,
)
from app.auth.dependencies import get_current_active_user, require_role
from app.schemas.plan import (
    PlanCreate, PlanResponse, ComputationResponse, ApprovalCreate,
    AutonomousPlanCreate, AutonomousPlanResponse, GenerationAttemptResponse,
)
from app.rules import RulesEngine, SiteFacts, RoadContext, ControlMethod
from app.services.audit import log_audit_event
from app.rules.validator import SiteContext

router = APIRouter()


@router.post("/jobs/{job_id}/plans", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
async def create_plan(
    job_id: UUID,
    plan_data: PlanCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Create a plan using the rules engine (planner+ role)."""
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
    
    # Build SiteFacts from input
    sf = plan_data.site_facts
    site_facts = SiteFacts(
        posted_or_statutory_speed_mph=sf.posted_or_statutory_speed_mph,
        speed_basis=sf.speed_basis,
        road_context=RoadContext(sf.road_context),
        lane_count=sf.lane_count,
        opposing_directions=sf.opposing_directions,
        lane_width_ft=sf.lane_width_ft,
        shoulder_width_ft=sf.shoulder_width_ft,
        work_length_ft=sf.work_length_ft,
        is_night=sf.is_night,
        sight_distance_ft=sf.sight_distance_ft,
        adt=sf.adt,
        duration_days=job.duration_days,
        uses_ottch_short_term=job.uses_ottch_short_term,
        jurisdiction=job.jurisdiction,
        control_method=ControlMethod.flaggers,
    )
    
    # Run rules engine
    engine = RulesEngine()
    computation = engine.compute(site_facts)
    
    # Check for refusal
    if computation.refused_reasons:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "Plan computation refused",
                "reasons": computation.refused_reasons,
            },
        )
    
    # Determine required approver kind
    if job.road_authority and ("ODOT" in job.road_authority.upper() or "state" in job.road_authority.lower()):
        required_approver = ApproverKind.pe
    else:
        required_approver = ApproverKind.tcs
    
    # Get next revision number
    existing_revisions = db.query(Plan).filter(Plan.job_id == job_id).count()
    
    # Create plan
    plan = Plan(
        job_id=job_id,
        revision=existing_revisions + 1,
        status=PlanStatus.computed,
        layout_family=plan_data.layout_family,
        rules_pack_version=computation.rules_pack_version,
        required_approver_kind=required_approver,
        disclaimer="DRAFT — not approved for use on the roadway",
        created_by=current_user.id,
        generation_mode=GenerationMode.manual,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    
    # Store computations
    _store_computations(db, plan.id, computation)
    
    # Store devices
    _store_devices(db, plan.id, computation)
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="plan.create",
        entity_type="plan",
        entity_id=plan.id,
        payload={"revision": plan.revision, "layout_family": plan.layout_family.value},
    )
    
    return _build_plan_response(plan, computation)


@router.post("/jobs/{job_id}/plans/autonomous", response_model=AutonomousPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_autonomous_plan(
    job_id: UUID,
    plan_data: AutonomousPlanCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Create a plan using autonomous AI generation (no human-in-loop).
    
    This bypasses:
    - Photo confirmation step
    - Approval workflow
    
    The AI generates the entire TCP layout, which is validated against
    MUTCD/OTTCH rules. If validation fails after max attempts, the best
    attempt is kept with status 'autonomous_failed_validation'.
    
    Requires ANTHROPIC_API_KEY environment variable.
    """
    # Verify API key is available
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Autonomous generation unavailable: ANTHROPIC_API_KEY not configured",
        )
    
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
    
    # Build SiteContext for validator
    sf = plan_data.site_facts
    site_context = SiteContext(
        posted_speed_mph=sf.posted_or_statutory_speed_mph,
        road_context=sf.road_context,
        lane_count=sf.lane_count,
        lane_width_ft=sf.lane_width_ft,
        work_length_ft=sf.work_length_ft,
        is_night=sf.is_night,
        sight_distance_ft=int(sf.sight_distance_ft) if sf.sight_distance_ft else None,
        adt=sf.adt,
        uses_ottch_short_term=job.uses_ottch_short_term if hasattr(job, 'uses_ottch_short_term') else False,
        jurisdiction=job.jurisdiction,
        control_method="flaggers",
    )
    
    # Import here to avoid circular imports and to fail gracefully if anthropic not installed
    try:
        from app.services.autonomous_generator import AutonomousGenerator
    except ImportError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Autonomous generation unavailable: {e}",
        )
    
    # Run autonomous generation
    generator = AutonomousGenerator()
    result = generator.generate(
        context=site_context,
        site_photos_summary=plan_data.site_photos_summary,
        triggering_user_id=current_user.id,
    )
    
    # Determine status based on result
    if result.success:
        plan_status = PlanStatus.autonomous_validated
    else:
        plan_status = PlanStatus.autonomous_failed_validation
    
    # Determine required approver kind (same logic as manual)
    if job.road_authority and ("ODOT" in job.road_authority.upper() or "state" in job.road_authority.lower()):
        required_approver = ApproverKind.pe
    else:
        required_approver = ApproverKind.tcs
    
    # Get next revision number
    existing_revisions = db.query(Plan).filter(Plan.job_id == job_id).count()
    
    # Build disclaimer with autonomous watermark
    if result.success:
        disclaimer = "AUTONOMOUS - AI GENERATED - NOT REVIEWED BY A HUMAN"
    else:
        disclaimer = f"AUTONOMOUS - AI GENERATED - VALIDATION FAILED ({result.final_validation.error_count if result.final_validation else 'unknown'} errors)"
    
    # Create plan
    plan = Plan(
        job_id=job_id,
        revision=existing_revisions + 1,
        status=plan_status,
        layout_family=plan_data.layout_family,
        rules_pack_version="autonomous-v1",
        required_approver_kind=required_approver,
        disclaimer=disclaimer,
        created_by=current_user.id,
        generation_mode=GenerationMode.autonomous,
        autonomous_attempt_count=result.total_attempts,
        autonomous_model_name=result.model_name,
        autonomous_model_version=result.model_version,
        autonomous_validation_passed=result.success,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    
    # Store all generation attempts
    for attempt in result.attempts:
        attempt_record = PlanGenerationAttempt(
            plan_id=plan.id,
            attempt_number=attempt.attempt_number,
            input_context={
                "site_context": {
                    "posted_speed_mph": site_context.posted_speed_mph,
                    "road_context": site_context.road_context,
                    "lane_count": site_context.lane_count,
                    "lane_width_ft": float(site_context.lane_width_ft),
                    "work_length_ft": float(site_context.work_length_ft),
                    "is_night": site_context.is_night,
                    "sight_distance_ft": site_context.sight_distance_ft,
                    "adt": site_context.adt,
                    "jurisdiction": site_context.jurisdiction,
                    "control_method": site_context.control_method,
                },
                "site_photos_summary": plan_data.site_photos_summary,
            },
            generated_layout=attempt.generated_layout or {},
            validation_passed=attempt.validation_result.passed if attempt.validation_result else False,
            violations=[v.to_dict() for v in attempt.validation_result.violations] if attempt.validation_result else [],
            error_count=attempt.validation_result.error_count if attempt.validation_result else 0,
            warning_count=attempt.validation_result.warning_count if attempt.validation_result else 0,
            prompt_tokens=attempt.prompt_tokens,
            completion_tokens=attempt.completion_tokens,
            total_tokens=attempt.total_tokens,
            latency_ms=attempt.latency_ms,
            model_name=attempt.model_name,
            model_version=attempt.model_version,
            api_error=attempt.api_error,
            error_message=attempt.error_message,
            malformed_json=attempt.malformed_json,
            started_at=attempt.started_at,
            completed_at=attempt.completed_at,
        )
        db.add(attempt_record)
    
    db.commit()
    
    # If we have a final layout, store computations
    if result.final_layout:
        _store_autonomous_computations(db, plan.id, result.final_layout, site_context)
    
    # Log audit event with AI actor info
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="plan.create_autonomous",
        entity_type="plan",
        entity_id=plan.id,
        payload={
            "revision": plan.revision,
            "layout_family": plan.layout_family.value,
            "generation_mode": "autonomous",
            "model_name": result.model_name,
            "model_version": result.model_version,
            "total_attempts": result.total_attempts,
            "validation_passed": result.success,
            "best_attempt": result.best_attempt_number,
            "triggering_user_id": str(current_user.id),
        },
    )
    
    # Build response
    plan_response = PlanResponse(
        id=plan.id,
        job_id=plan.job_id,
        revision=plan.revision,
        status=plan.status.value,
        layout_family=plan.layout_family.value,
        rules_pack_version=plan.rules_pack_version,
        required_approver_kind=plan.required_approver_kind.value,
        disclaimer=plan.disclaimer,
        created_by=plan.created_by,
        created_at=plan.created_at,
        generation_mode=plan.generation_mode.value,
        autonomous_attempt_count=plan.autonomous_attempt_count,
        autonomous_model_name=plan.autonomous_model_name,
        autonomous_validation_passed=plan.autonomous_validation_passed,
    )
    
    attempt_responses = [
        GenerationAttemptResponse(
            attempt_number=a.attempt_number,
            validation_passed=a.validation_result.passed if a.validation_result else False,
            error_count=a.validation_result.error_count if a.validation_result else 0,
            warning_count=a.validation_result.warning_count if a.validation_result else 0,
            violations=[v.to_dict() for v in a.validation_result.violations] if a.validation_result else [],
            latency_ms=a.latency_ms,
            model_name=a.model_name,
        )
        for a in result.attempts
    ]
    
    remaining_violations = None
    if not result.success and result.final_validation:
        remaining_violations = [v.to_dict() for v in result.final_validation.violations if v.severity.value == "error"]
    
    return AutonomousPlanResponse(
        plan=plan_response,
        success=result.success,
        total_attempts=result.total_attempts,
        best_attempt_number=result.best_attempt_number,
        attempts=attempt_responses,
        remaining_violations=remaining_violations,
    )


def _store_autonomous_computations(db: Session, plan_id: UUID, layout: dict, context: SiteContext):
    """Store computation results from autonomous generation."""
    fields_to_store = [
        ("spacing_A_ft", layout.get("spacing_A_ft"), "ft"),
        ("spacing_B_ft", layout.get("spacing_B_ft"), "ft"),
        ("spacing_C_ft", layout.get("spacing_C_ft"), "ft"),
        ("taper_length_ft", layout.get("taper_length_ft"), "ft"),
        ("downstream_taper_length_ft", layout.get("downstream_taper_length_ft"), "ft"),
        ("taper_device_spacing_ft", layout.get("taper_device_spacing_ft"), "ft"),
        ("tangent_device_spacing_ft", layout.get("tangent_device_spacing_ft"), "ft"),
        ("buffer_length_ft", layout.get("buffer_length_ft"), "ft"),
        ("flagger_count", layout.get("flagger_count"), None),
        ("cone_count", layout.get("cone_count"), None),
        ("drum_count", layout.get("drum_count"), None),
    ]
    
    for field_key, value, unit in fields_to_store:
        if value is not None:
            pc = PlanComputation(
                plan_id=plan_id,
                field_key=field_key,
                value_numeric=Decimal(str(value)) if isinstance(value, (int, float)) else None,
                value_text=str(value) if not isinstance(value, (int, float)) else None,
                unit=unit,
                formula="AI-generated",
                source_doc="Autonomous Generation",
                source_ref=f"Claude model validation",
                notes="Generated by autonomous AI, validated against MUTCD/OTTCH",
            )
            db.add(pc)
    
    # Store signs if present
    for sign in layout.get("sign_sequence", []):
        device = PlanDevice(
            plan_id=plan_id,
            device_kind="sign",
            mutcd_code=sign.get("mutcd_code"),
            sequence_order=layout.get("sign_sequence", []).index(sign) + 1,
            station_role=sign.get("position"),
            quantity=1 if sign.get("required", True) else 0,
            source_ref="Autonomous Generation - AI validated",
        )
        db.add(device)
    
    db.commit()


@router.get("/plans/{plan_id}", response_model=PlanResponse)
async def get_plan(
    plan_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get plan details with computations."""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    
    job = db.query(Job).filter(Job.id == plan.job_id).first()
    
    # Check membership
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Reconstruct computation from stored data
    computation = _reconstruct_computation(db, plan)
    
    return _build_plan_response(plan, computation)


@router.post("/plans/{plan_id}/submit")
async def submit_plan(
    plan_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Submit plan for approval (planner+ role)."""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    
    job = db.query(Job).filter(Job.id == plan.job_id).first()
    
    # Check role
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership or membership.role not in [OrgRole.owner, OrgRole.admin, OrgRole.planner]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Planner role required")
    
    if plan.status != PlanStatus.computed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan must be in computed state")
    
    plan.status = PlanStatus.pending_approval
    db.commit()
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action="plan.submit",
        entity_type="plan",
        entity_id=plan.id,
    )
    
    return {"message": "Plan submitted for approval", "status": plan.status.value}


@router.post("/plans/{plan_id}/approvals")
async def approve_plan(
    plan_id: UUID,
    approval_data: ApprovalCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Approve or reject a plan (approver role with valid credential)."""
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    
    job = db.query(Job).filter(Job.id == plan.job_id).first()
    
    # Check approver role
    membership = db.query(Membership).filter(
        Membership.organization_id == job.organization_id,
        Membership.user_id == current_user.id,
    ).first()
    
    if not membership or membership.role not in [OrgRole.tcs_approver, OrgRole.engineer_approver]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approver role required")
    
    # Approver cannot be the plan author
    if plan.created_by == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approver cannot be the same user who created the plan",
        )
    
    # Verify credential
    credential = db.query(Credential).filter(
        Credential.id == approval_data.credential_id,
        Credential.user_id == current_user.id,
    ).first()
    
    if not credential:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found")
    
    if not credential.is_valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credential is expired")
    
    # Check credential matches required approver kind
    if plan.required_approver_kind == ApproverKind.pe and credential.kind != CredentialKind.pe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PE credential required for this plan",
        )
    
    if plan.status != PlanStatus.pending_approval:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan must be pending approval")
    
    # Create approval record
    decision = ApprovalDecision(approval_data.decision)
    approval = Approval(
        plan_id=plan.id,
        approver_id=current_user.id,
        credential_id=credential.id,
        decision=decision,
        attestation=approval_data.attestation,
        comments=approval_data.comments,
    )
    db.add(approval)
    
    # Update plan status
    if decision == ApprovalDecision.approved:
        plan.status = PlanStatus.approved
        plan.disclaimer = f"APPROVED by {current_user.full_name} ({credential.identifier})"
    else:
        plan.status = PlanStatus.rejected
    
    db.commit()
    
    log_audit_event(
        db=db,
        organization_id=job.organization_id,
        actor_id=current_user.id,
        action=f"plan.{decision.value}",
        entity_type="plan",
        entity_id=plan.id,
        payload={
            "credential_id": str(credential.id),
            "credential_kind": credential.kind.value,
        },
    )
    
    return {
        "message": f"Plan {decision.value}",
        "status": plan.status.value,
        "disclaimer": plan.disclaimer,
    }


def _store_computations(db: Session, plan_id: UUID, computation):
    """Store computation results in the database."""
    computed_values = [
        ("spacing_A_ft", computation.spacing_A_ft),
        ("spacing_B_ft", computation.spacing_B_ft),
        ("spacing_C_ft", computation.spacing_C_ft),
        ("taper_length_ft", computation.taper_length_ft),
        ("downstream_taper_length_ft", computation.downstream_taper_length_ft),
        ("taper_device_spacing_ft", computation.taper_device_spacing_ft),
        ("tangent_device_spacing_ft", computation.tangent_device_spacing_ft),
        ("buffer_length_ft", computation.buffer_length_ft),
        ("mutcd_ssd_ft", computation.mutcd_ssd_ft),
        ("flagger_count", computation.flagger_count),
        ("cones_per_taper", computation.cones_per_taper),
        ("cones_tangent", computation.cones_tangent),
    ]
    
    for field_key, cv in computed_values:
        pc = PlanComputation(
            plan_id=plan_id,
            field_key=field_key,
            value_numeric=Decimal(str(cv.value)) if isinstance(cv.value, (int, float, Decimal)) else None,
            value_text=str(cv.value) if not isinstance(cv.value, (int, float, Decimal)) else None,
            unit=cv.unit,
            formula=cv.formula,
            source_doc=cv.citation.source_doc,
            source_ref=cv.citation.source_ref,
            source_url=cv.citation.source_url,
            notes=cv.citation.notes,
        )
        db.add(pc)
    
    db.commit()


def _store_devices(db: Session, plan_id: UUID, computation):
    """Store device specifications in the database."""
    for sign in computation.sign_sequence:
        device = PlanDevice(
            plan_id=plan_id,
            device_kind="sign",
            mutcd_code=sign.mutcd_code,
            sequence_order=sign.sequence_order,
            station_role=sign.purpose,
            quantity=1 if sign.required else 0,
            source_ref=f"{sign.citation.source_doc} {sign.citation.source_ref}",
        )
        db.add(device)
    
    db.commit()


def _reconstruct_computation(db: Session, plan: Plan):
    """Reconstruct computation data from stored values."""
    computations = db.query(PlanComputation).filter(PlanComputation.plan_id == plan.id).all()
    comp_dict = {c.field_key: c for c in computations}
    
    # Build minimal computation response
    return {
        "spacing_A_ft": _comp_to_dict(comp_dict.get("spacing_A_ft")),
        "spacing_B_ft": _comp_to_dict(comp_dict.get("spacing_B_ft")),
        "spacing_C_ft": _comp_to_dict(comp_dict.get("spacing_C_ft")),
        "taper_length_ft": _comp_to_dict(comp_dict.get("taper_length_ft")),
        "buffer_length_ft": _comp_to_dict(comp_dict.get("buffer_length_ft")),
        "flagger_count": _comp_to_dict(comp_dict.get("flagger_count")),
    }


def _comp_to_dict(comp):
    if not comp:
        return None
    return {
        "value": float(comp.value_numeric) if comp.value_numeric else comp.value_text,
        "unit": comp.unit,
        "formula": comp.formula,
        "citation": {
            "source_doc": comp.source_doc,
            "source_ref": comp.source_ref,
            "source_url": comp.source_url,
            "notes": comp.notes,
        },
    }


def _build_plan_response(plan: Plan, computation) -> PlanResponse:
    """Build plan response with computation data."""
    if hasattr(computation, "to_dict"):
        comp_dict = computation.to_dict()
    else:
        comp_dict = computation
    
    return PlanResponse(
        id=plan.id,
        job_id=plan.job_id,
        revision=plan.revision,
        status=plan.status.value,
        layout_family=plan.layout_family.value,
        rules_pack_version=plan.rules_pack_version,
        required_approver_kind=plan.required_approver_kind.value,
        disclaimer=plan.disclaimer,
        created_by=plan.created_by,
        created_at=plan.created_at,
        computation=ComputationResponse(**comp_dict) if comp_dict else None,
    )

"""
Integration tests for the full TCP workflow.

Tests the complete flow:
1. User registration and login
2. Organization and job creation
3. Plan generation via rules engine
4. Plan submission
5. Plan approval (different user)
6. Audit log verification

Uses SQLite in-memory database for testing.
"""
import os
import pytest
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

# Override DATABASE_URL before importing app modules
os.environ["DATABASE_URL"] = "sqlite:///./test_integration.db"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-at-least-32-characters-long"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db
from app.models import (
    Organization, User, Membership, OrgRole, Credential, CredentialKind,
    Job, JobStatus, AuditEvent
)
from app.auth.password import hash_password


# Create test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_integration.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def client():
    """Create test client with fresh database."""
    Base.metadata.create_all(bind=engine)
    yield TestClient(app)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db():
    """Get database session."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_org(db):
    """Create test organization."""
    org = Organization(
        id=uuid4(),
        name="Test Traffic Co",
        slug="test-traffic-co",
        billing_email="test@example.com",
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@pytest.fixture
def planner_user(db, test_org):
    """Create planner user with membership."""
    user = User(
        id=uuid4(),
        email="planner@test.com",
        full_name="Test Planner",
        password_hash=hash_password("plannerpass123"),
        email_verified=True,
    )
    db.add(user)
    db.commit()
    
    membership = Membership(
        organization_id=test_org.id,
        user_id=user.id,
        role=OrgRole.planner,
    )
    db.add(membership)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def approver_user(db, test_org):
    """Create approver user with membership and credential."""
    user = User(
        id=uuid4(),
        email="approver@test.com",
        full_name="Test Approver",
        password_hash=hash_password("approverpass123"),
        email_verified=True,
    )
    db.add(user)
    db.commit()
    
    membership = Membership(
        organization_id=test_org.id,
        user_id=user.id,
        role=OrgRole.tcs_approver,
    )
    db.add(membership)
    
    credential = Credential(
        id=uuid4(),
        user_id=user.id,
        kind=CredentialKind.tcs,
        identifier="TCS-TEST-001",
        issuing_authority="Test DOT",
        issued_date=datetime.utcnow().date(),
        expiration_date=(datetime.utcnow() + timedelta(days=365)).date(),
    )
    db.add(credential)
    db.commit()
    db.refresh(user)
    
    # Store credential on user for test access
    user.test_credential = credential
    return user


@pytest.fixture
def test_job(db, test_org, planner_user):
    """Create test job."""
    job = Job(
        id=uuid4(),
        organization_id=test_org.id,
        job_number="TEST-2024-001",
        street_or_road="Test Street",
        nearest_cross_street="Test Ave",
        city="Portland",
        state="OR",
        latitude=Decimal("45.5231"),
        longitude=Decimal("-122.6765"),
        road_authority="City of Portland",
        road_context="urban_low_speed",
        lane_count=2,
        posted_speed_mph=35,
        work_description="Test work",
        jurisdiction="OR",
        uses_ottch_short_term=True,
        duration_days=1,
        start_date=datetime.utcnow().date(),
        status=JobStatus.active,
        created_by=planner_user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


class TestAuthFlow:
    """Test authentication flow."""
    
    def test_register_and_login(self, client):
        """Test user registration and login."""
        # Register
        response = client.post("/api/auth/register", json={
            "email": "newuser@test.com",
            "password": "newpassword123",
            "full_name": "New User",
        })
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "newuser@test.com"
        
        # Login
        response = client.post("/api/auth/login", json={
            "email": "newuser@test.com",
            "password": "newpassword123",
        })
        assert response.status_code == 200
        assert "session_token" in response.cookies
        
        # Get current user
        response = client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "newuser@test.com"
    
    def test_login_invalid_password(self, client, db, planner_user):
        """Test login with invalid password."""
        response = client.post("/api/auth/login", json={
            "email": "planner@test.com",
            "password": "wrongpassword",
        })
        assert response.status_code == 401


class TestPlanWorkflow:
    """Test plan creation and approval workflow."""
    
    def test_create_plan_via_rules_engine(self, client, db, planner_user, test_job):
        """Test plan creation using rules engine."""
        # Login as planner
        response = client.post("/api/auth/login", json={
            "email": "planner@test.com",
            "password": "plannerpass123",
        })
        assert response.status_code == 200
        
        # Create plan
        response = client.post(f"/api/jobs/{test_job.id}/plans", json={
            "layout_family": "ottch_320_mutcd_ta10",
            "site_facts": {
                "posted_or_statutory_speed_mph": 35,
                "speed_basis": "posted",
                "road_context": "urban_low_speed",
                "lane_count": 2,
                "opposing_directions": True,
                "lane_width_ft": 12,
                "work_length_ft": 100,
                "is_night": False,
            },
        })
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "computed"
        assert data["computation"] is not None
        
        return data["id"]
    
    def test_submit_and_approve_plan(self, client, db, planner_user, approver_user, test_job):
        """Test full submit and approval flow."""
        # Login as planner
        client.post("/api/auth/login", json={
            "email": "planner@test.com",
            "password": "plannerpass123",
        })
        
        # Create plan
        response = client.post(f"/api/jobs/{test_job.id}/plans", json={
            "layout_family": "ottch_320_mutcd_ta10",
            "site_facts": {
                "posted_or_statutory_speed_mph": 35,
                "speed_basis": "posted",
                "road_context": "urban_low_speed",
                "lane_count": 2,
                "opposing_directions": True,
                "lane_width_ft": 12,
                "work_length_ft": 100,
                "is_night": False,
            },
        })
        plan_id = response.json()["id"]
        
        # Submit plan
        response = client.post(f"/api/plans/{plan_id}/submit")
        assert response.status_code == 200
        assert response.json()["status"] == "pending_approval"
        
        # Login as approver
        client.post("/api/auth/login", json={
            "email": "approver@test.com",
            "password": "approverpass123",
        })
        
        # Approve plan
        credential = db.query(Credential).filter(Credential.user_id == approver_user.id).first()
        response = client.post(f"/api/plans/{plan_id}/approvals", json={
            "decision": "approved",
            "credential_id": str(credential.id),
            "attestation": "I have reviewed this plan and attest that it meets requirements.",
        })
        assert response.status_code == 200
        assert response.json()["status"] == "approved"
        
        # Verify audit log
        audit_events = db.query(AuditEvent).filter(
            AuditEvent.entity_type == "plan",
            AuditEvent.entity_id == plan_id,
        ).all()
        actions = [e.action for e in audit_events]
        assert "plan.create" in actions
        assert "plan.submit" in actions
        assert "plan.approved" in actions
    
    def test_approver_cannot_approve_own_plan(self, client, db, test_org):
        """Test that approver cannot approve their own plan."""
        # Create user who is both planner and approver
        user = User(
            id=uuid4(),
            email="both@test.com",
            full_name="Both Roles",
            password_hash=hash_password("bothpass123"),
            email_verified=True,
        )
        db.add(user)
        db.commit()
        
        # Give both roles
        for role in [OrgRole.planner, OrgRole.tcs_approver]:
            membership = Membership(
                organization_id=test_org.id,
                user_id=user.id,
                role=role,
            )
            db.add(membership)
        
        credential = Credential(
            id=uuid4(),
            user_id=user.id,
            kind=CredentialKind.tcs,
            identifier="TCS-BOTH-001",
            issuing_authority="Test DOT",
            issued_date=datetime.utcnow().date(),
            expiration_date=(datetime.utcnow() + timedelta(days=365)).date(),
        )
        db.add(credential)
        
        # Create job
        job = Job(
            id=uuid4(),
            organization_id=test_org.id,
            job_number="TEST-BOTH-001",
            street_or_road="Test Street",
            city="Portland",
            state="OR",
            latitude=Decimal("45.5231"),
            longitude=Decimal("-122.6765"),
            road_context="urban_low_speed",
            lane_count=2,
            posted_speed_mph=35,
            jurisdiction="OR",
            uses_ottch_short_term=True,
            duration_days=1,
            start_date=datetime.utcnow().date(),
            status=JobStatus.active,
            created_by=user.id,
        )
        db.add(job)
        db.commit()
        
        # Login
        client.post("/api/auth/login", json={
            "email": "both@test.com",
            "password": "bothpass123",
        })
        
        # Create and submit plan
        response = client.post(f"/api/jobs/{job.id}/plans", json={
            "layout_family": "ottch_320_mutcd_ta10",
            "site_facts": {
                "posted_or_statutory_speed_mph": 35,
                "speed_basis": "posted",
                "road_context": "urban_low_speed",
                "lane_count": 2,
                "opposing_directions": True,
                "lane_width_ft": 12,
                "work_length_ft": 100,
                "is_night": False,
            },
        })
        plan_id = response.json()["id"]
        
        client.post(f"/api/plans/{plan_id}/submit")
        
        # Try to approve own plan - should fail
        response = client.post(f"/api/plans/{plan_id}/approvals", json={
            "decision": "approved",
            "credential_id": str(credential.id),
            "attestation": "Self approval attempt",
        })
        assert response.status_code == 400
        assert "same user" in response.json()["detail"].lower()


class TestRulesEngine:
    """Test rules engine integration via API."""
    
    def test_rules_engine_computes_correct_values(self, client, db, planner_user, test_job):
        """Test that rules engine returns correct computed values."""
        # Login
        client.post("/api/auth/login", json={
            "email": "planner@test.com",
            "password": "plannerpass123",
        })
        
        # Create plan at 35 mph
        response = client.post(f"/api/jobs/{test_job.id}/plans", json={
            "layout_family": "ottch_320_mutcd_ta10",
            "site_facts": {
                "posted_or_statutory_speed_mph": 35,
                "speed_basis": "posted",
                "road_context": "urban_low_speed",
                "lane_count": 2,
                "opposing_directions": True,
                "lane_width_ft": 12,
                "work_length_ft": 100,
                "is_night": False,
            },
        })
        
        assert response.status_code == 201
        data = response.json()
        comp = data["computation"]
        
        # Verify spacing values from OTTCH 2026 Table 2-4
        assert comp["spacing_A_ft"]["value"] == 100
        assert comp["spacing_B_ft"]["value"] == 100
        assert comp["spacing_C_ft"]["value"] == 100
        
        # Verify buffer from OTTCH 2026 Table 2-4
        assert comp["buffer_length_ft"]["value"] == 125
        
        # Verify taper - one-lane two-way uses 50-100 ft range
        assert 50 <= comp["taper_length_ft"]["value"] <= 100
    
    def test_rules_engine_refuses_out_of_scope(self, client, db, planner_user, test_job):
        """Test that rules engine refuses out-of-scope configurations."""
        # Login
        client.post("/api/auth/login", json={
            "email": "planner@test.com",
            "password": "plannerpass123",
        })
        
        # Try to create plan for 4-lane road (out of scope)
        response = client.post(f"/api/jobs/{test_job.id}/plans", json={
            "layout_family": "ottch_320_mutcd_ta10",
            "site_facts": {
                "posted_or_statutory_speed_mph": 35,
                "speed_basis": "posted",
                "road_context": "urban_low_speed",
                "lane_count": 4,  # Out of scope
                "opposing_directions": True,
                "lane_width_ft": 12,
                "work_length_ft": 100,
                "is_night": False,
            },
        })
        
        assert response.status_code == 422
        assert "refused" in response.json()["detail"]["error"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

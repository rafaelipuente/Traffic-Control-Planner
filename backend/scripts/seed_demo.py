#!/usr/bin/env python3
"""
Seed script for demo data.

Creates:
- 1 Demo organization
- 1 Planner user
- 1 Approver user (with TCS credential)
- 2 Sample jobs (25 mph residential, 45 mph rural)

Usage:
    DEMO_PLANNER_PASSWORD=... DEMO_APPROVER_PASSWORD=... python scripts/seed_demo.py

Passwords MUST be provided via environment variables, not hardcoded.
"""
import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, engine, Base
from app.models import (
    Organization, User, Membership, OrgRole, Credential, CredentialKind,
    Job, JobStatus
)
from app.auth.password import hash_password


def main():
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    planner_password = os.environ.get("DEMO_PLANNER_PASSWORD")
    approver_password = os.environ.get("DEMO_APPROVER_PASSWORD")
    
    if not planner_password or not approver_password:
        print("ERROR: DEMO_PLANNER_PASSWORD and DEMO_APPROVER_PASSWORD must be set")
        print("Usage: DEMO_PLANNER_PASSWORD=xxx DEMO_APPROVER_PASSWORD=yyy python scripts/seed_demo.py")
        sys.exit(1)
    
    if len(planner_password) < 8 or len(approver_password) < 8:
        print("ERROR: Passwords must be at least 8 characters")
        sys.exit(1)
    
    db = SessionLocal()
    
    try:
        # Check if demo org already exists
        existing_org = db.query(Organization).filter(Organization.name == "Demo Traffic Co").first()
        if existing_org:
            print("Demo data already exists. Skipping seed.")
            print(f"  Organization: {existing_org.name} ({existing_org.id})")
            return
        
        print("Creating demo data...")
        
        # 1. Create organization
        org = Organization(
            id=uuid4(),
            name="Demo Traffic Co",
            slug="demo-traffic-co",
            billing_email="demo@example.com",
        )
        db.add(org)
        db.flush()
        print(f"  Created organization: {org.name}")
        
        # 2. Create planner user
        planner = User(
            id=uuid4(),
            email="planner@demo.example",
            full_name="Demo Planner",
            password_hash=hash_password(planner_password),
            email_verified=True,
        )
        db.add(planner)
        db.flush()
        print(f"  Created planner user: {planner.email}")
        
        # 3. Create approver user
        approver = User(
            id=uuid4(),
            email="approver@demo.example",
            full_name="Demo Approver (TCS)",
            password_hash=hash_password(approver_password),
            email_verified=True,
        )
        db.add(approver)
        db.flush()
        print(f"  Created approver user: {approver.email}")
        
        # 4. Create memberships
        planner_membership = Membership(
            organization_id=org.id,
            user_id=planner.id,
            role=OrgRole.planner,
        )
        db.add(planner_membership)
        
        approver_membership = Membership(
            organization_id=org.id,
            user_id=approver.id,
            role=OrgRole.tcs_approver,
        )
        db.add(approver_membership)
        db.flush()
        print("  Created memberships")
        
        # 5. Create TCS credential for approver
        credential = Credential(
            id=uuid4(),
            user_id=approver.id,
            kind=CredentialKind.tcs,
            identifier="TCS-DEMO-001",
            issuing_authority="Oregon DOT",
            issued_date=datetime.utcnow().date(),
            expiration_date=(datetime.utcnow() + timedelta(days=365)).date(),
        )
        db.add(credential)
        db.flush()
        print(f"  Created TCS credential: {credential.identifier}")
        
        # 6. Create sample job 1: 25 mph residential
        job1 = Job(
            id=uuid4(),
            organization_id=org.id,
            job_number="DEMO-2024-001",
            street_or_road="Oak Street",
            nearest_cross_street="Maple Ave",
            city="Portland",
            state="OR",
            latitude=Decimal("45.5231"),
            longitude=Decimal("-122.6765"),
            road_authority="City of Portland",
            road_context="urban_low_speed",
            lane_count=2,
            posted_speed_mph=25,
            work_description="Utility repair - water main replacement",
            jurisdiction="OR",
            uses_ottch_short_term=True,
            duration_days=1,
            start_date=datetime.utcnow().date(),
            status=JobStatus.active,
            created_by=planner.id,
        )
        db.add(job1)
        print(f"  Created job 1: {job1.job_number} - 25 mph residential")
        
        # 7. Create sample job 2: 45 mph rural two-lane
        job2 = Job(
            id=uuid4(),
            organization_id=org.id,
            job_number="DEMO-2024-002",
            street_or_road="Highway 99E",
            nearest_cross_street="Silverton Road",
            city="Silverton",
            state="OR",
            latitude=Decimal("45.0051"),
            longitude=Decimal("-122.7831"),
            road_authority="ODOT Region 2",
            road_context="rural",
            lane_count=2,
            posted_speed_mph=45,
            work_description="Bridge deck repair - requires lane closure",
            jurisdiction="OR",
            uses_ottch_short_term=True,
            duration_days=2,
            start_date=datetime.utcnow().date(),
            status=JobStatus.active,
            created_by=planner.id,
        )
        db.add(job2)
        print(f"  Created job 2: {job2.job_number} - 45 mph rural (ODOT - requires PE)")
        
        db.commit()
        
        print("\n" + "="*60)
        print("DEMO DATA CREATED SUCCESSFULLY")
        print("="*60)
        print(f"\nOrganization: {org.name}")
        print(f"\nPlanner Login:")
        print(f"  Email: {planner.email}")
        print(f"  Password: (as provided via DEMO_PLANNER_PASSWORD)")
        print(f"\nApprover Login:")
        print(f"  Email: {approver.email}")
        print(f"  Password: (as provided via DEMO_APPROVER_PASSWORD)")
        print(f"  Credential: {credential.identifier}")
        print(f"\nSample Jobs:")
        print(f"  1. {job1.job_number}: {job1.street_or_road} @ {job1.posted_speed_mph}mph (residential)")
        print(f"  2. {job2.job_number}: {job2.street_or_road} @ {job2.posted_speed_mph}mph (state highway - PE required)")
        print("="*60)
        
    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()

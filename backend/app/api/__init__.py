"""API routes."""
from fastapi import APIRouter
from app.api import auth, organizations, jobs, plans, vision

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(organizations.router, prefix="/orgs", tags=["organizations"])
api_router.include_router(jobs.router, tags=["jobs"])
api_router.include_router(plans.router, tags=["plans"])
api_router.include_router(vision.router, tags=["vision"])

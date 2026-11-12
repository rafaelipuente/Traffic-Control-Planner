# TCP Planner

AI-powered Traffic Control Plan Generator using MUTCD 11th Edition and OTTCH 2026 guidelines.

## Overview

TCP Planner is a Phase 1 MVP for generating draft Traffic Control Plans. It supports:

- **MUTCD Figure 6P-10 / OTTCH Diagram 320**: One-lane two-way flagger closure on two-lane road
- **Deterministic Rules Engine**: All numeric values (spacing, tapers, buffers) computed from tables, not LLM
- **Real Authentication**: Org accounts, users, roles (owner/planner/approver), JWT httpOnly cookies
- **Approval Workflow**: draft → submitted → approved/rejected with audit log
- **Claude Vision**: Photo analysis for site conditions (optional, user-confirmed)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│                    (Vercel / localhost:3333)                     │
├─────────────────────────────────────────────────────────────────┤
│  /planner page       /login page        /api/draft-tcp          │
│  - Map drawing       - Auth login       - Rules engine call      │
│  - Job form          - Session mgmt     - SVG generation         │
│  - PDF export                                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────────┐
│                      FastAPI Backend                             │
│                  (Render / localhost:5555)                       │
├─────────────────────────────────────────────────────────────────┤
│  /api/auth/*         /api/plans/*        /api/vision/*          │
│  - Register/login    - Create/submit     - Photo extraction     │
│  - JWT sessions      - Approve/reject    - Claude API           │
│  - Role checks       - Audit logging                            │
└────────────────────────────┬────────────────────────────────────┘
                             │ SQLAlchemy
┌────────────────────────────▼────────────────────────────────────┐
│                       PostgreSQL                                 │
│                    (Render / local)                              │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start (Local Development)

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 14+
- Mapbox account (free tier works)
- Anthropic API key (for Claude vision, optional)

### 1. Clone and Install

```bash
git clone <repo-url>
cd Traffic-Control-Planner

# Frontend
npm install

# Backend
cd backend
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

**Frontend** (`.env.local`):

```bash
cp .env.example .env.local
# Edit .env.local:
NEXT_PUBLIC_MAP_TOKEN=pk.your-mapbox-token
NEXT_PUBLIC_API_URL=http://localhost:5555
```

**Backend** (`backend/.env`):

```bash
cp backend/.env.example backend/.env
# Edit backend/.env:
DATABASE_URL=postgresql://user:pass@localhost:5432/tcp_db
JWT_SECRET_KEY=your-secret-key-at-least-32-chars
ANTHROPIC_API_KEY=sk-ant-your-key  # Optional, for vision
CORS_ORIGINS=["http://localhost:3333"]
```

### 3. Set Up Database

```bash
# Create PostgreSQL database
createdb tcp_db

# Run migrations
cd backend
alembic upgrade head
cd ..
```

### 4. Seed Demo Data (Optional)

```bash
cd backend
DEMO_PLANNER_PASSWORD=demo1234 DEMO_APPROVER_PASSWORD=demo5678 python scripts/seed_demo.py
cd ..
```

This creates:
- Organization: "Demo Traffic Co"
- Planner user: `planner@demo.example`
- Approver user: `approver@demo.example` (with TCS credential)
- 2 sample jobs (25 mph residential, 45 mph rural/ODOT)

### 5. Run Both Services

**Terminal 1 - Backend:**

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 5555 --reload
```

**Terminal 2 - Frontend:**

```bash
npm run dev -- -p 3333
```

Open [http://localhost:3333/planner](http://localhost:3333/planner)

## Features

### Deterministic Rules Engine

All numeric values come from MUTCD 11th Edition and OTTCH 2026 tables:

| Component | Source |
|-----------|--------|
| Sign spacing (A, B, C) | OTTCH 2026 Table 2-4 |
| Buffer length | OTTCH 2026 Table 2-4 |
| Taper length (merging) | MUTCD Table 6B-4: L=WS²/60 for ≤40mph, L=WS for ≥45mph |
| One-lane two-way taper | 50-100 ft range (NOT the L formula) |
| Stopping sight distance | MUTCD Table 6B-2 |
| Flagger count | OTTCH Diagram 320 notes |

**Critical Note**: The old code had INVERTED taper formulas. The correct formulas are:
- `L = W × S² / 60` for speeds ≤ 40 mph
- `L = W × S` for speeds ≥ 45 mph

### Photo Analysis (Claude Vision)

Upload a site photo for AI-assisted field recognition:
1. Click "Upload Photo" in job form
2. Claude analyzes: road type, lanes, speed signs, hazards
3. **Review and confirm** findings before they're used
4. Extracted values pre-fill job form

### Plan Approval Workflow

1. **Planner** creates plan via rules engine
2. **Planner** submits for approval
3. **Approver** (different user) reviews with their credential
4. **Approver** approves or rejects with comments
5. All actions logged to audit_events table

### PDF Export

- **DRAFT watermark** on unapproved plans
- **Approver name/date** on approved plans
- **PE Stamp Required** banner for state highways

## API Reference

### Authentication

```bash
# Register
POST /api/auth/register
{"email": "user@example.com", "password": "...", "full_name": "..."}

# Login (sets httpOnly cookie)
POST /api/auth/login
{"email": "user@example.com", "password": "..."}

# Get current user
GET /api/auth/me

# Logout
POST /api/auth/logout
```

### Plans

```bash
# Create plan (runs rules engine)
POST /api/jobs/{job_id}/plans
{"site_facts": {...}, "layout_family": "ottch_320_mutcd_ta10"}

# Submit for approval
POST /api/plans/{plan_id}/submit

# Approve/reject
POST /api/plans/{plan_id}/approvals
{"decision": "approved", "credential_id": "...", "attestation": "..."}
```

### Vision Extraction

```bash
# Upload and analyze photo
POST /api/vision/extract
Content-Type: multipart/form-data
file: <image>
```

## Deployment

### Backend (Render)

1. Create new Web Service from `backend/` directory
2. Set build command: `pip install -r requirements.txt`
3. Set start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables:
   - `DATABASE_URL` (from Render Postgres)
   - `JWT_SECRET_KEY` (generate secure random)
   - `ANTHROPIC_API_KEY` (optional)
   - `CORS_ORIGINS` (your Vercel domain)

5. Create Render PostgreSQL database
6. Run migrations: `alembic upgrade head` (via Render shell or job)

### Frontend (Vercel)

1. Import repository to Vercel
2. Set environment variables:
   - `NEXT_PUBLIC_MAP_TOKEN`
   - `NEXT_PUBLIC_API_URL` (Render backend URL)
3. Deploy

## Environment Variables

### Frontend (.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAP_TOKEN` | Yes | Mapbox access token |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL |

### Backend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Yes | Secret for JWT signing (≥32 chars) |
| `JWT_ALGORITHM` | No | Default: HS256 |
| `JWT_EXPIRY_HOURS` | No | Default: 24 |
| `ANTHROPIC_API_KEY` | No | For Claude vision (photo analysis) |
| `CORS_ORIGINS` | Yes | JSON array of allowed origins |

## Testing

### Backend Tests

```bash
cd backend
pytest tests/test_rules_engine.py -v
```

49 tests covering:
- Taper formula speed boundaries (25/35/40/45/55/65 mph)
- Table lookups (spacing, buffer, SSD)
- Flagger requirements
- Scope refusal conditions

### Frontend Build

```bash
npm run build
```

## Project Structure

```
Traffic-Control-Planner/
├── app/                      # Next.js app directory
│   ├── api/draft-tcp/        # Plan generation endpoint
│   ├── login/                # Login page
│   └── planner/              # Main planner UI
├── backend/                  # FastAPI backend
│   ├── alembic/              # Database migrations
│   ├── app/
│   │   ├── api/              # API routes
│   │   ├── auth/             # Auth utilities
│   │   ├── models/           # SQLAlchemy models
│   │   ├── rules/            # Rules engine
│   │   ├── schemas/          # Pydantic schemas
│   │   └── services/         # Business logic
│   ├── scripts/              # Utility scripts
│   └── tests/                # Backend tests
├── components/               # React components
├── lib/
│   ├── api/                  # Backend API client
│   ├── rules/                # TypeScript rules engine
│   └── export/               # PDF export utilities
├── render.yaml               # Render deployment config
└── README.md
```

## Known Limitations (Phase 1)

- **Scope**: Only OTTCH Diagram 320 / MUTCD Figure 6P-10 (one-lane two-way flagger)
- **Speed Range**: 20-65 mph (41-44 mph ambiguous zone refused)
- **Duration**: Short-term only (≤3 days)
- **Road Types**: Two-lane two-way only (freeways, multi-lane refused)

## License

Private project - All rights reserved.

SentriRoad 🚦

SentriRoad is a road-safety operations platform for collecting road evidence, detecting road damage with AI, prioritizing repairs, and coordinating the workflow between citizens, drone operators, road authorities, and repair crews.

The project is split into a React/Vite frontend, an Express/Supabase backend, and a separate Python FastAPI AI service.

Overview

SentriRoad supports two main evidence sources:

Citizen reports — a citizen submits a road-damage photo and location.

Drone flight runs — a drone operator uploads flight video together with telemetry. GPS information is taken from the telemetry instead of requiring the operator to manually enter a location.

The system processes evidence, creates detections, calculates an urgency/priority score, creates a work order, and guides the repair workflow.

Main workflow

Citizen / Drone Operator
        │
        ├── Upload evidence
        │
        ▼
   Supabase Storage
        │
        ▼
   Express Backend
        │
        ▼
   Python AI Service
        │
        ├── Damage detection
        ├── Confidence
        └── Bounding box
        │
        ▼
    Detection
        │
        ▼
   Scoring Engine
        │
        ▼
    Work Order
        │
        ├── Authority dispatches
        ├── Authority assigns crew
        ▼
    Repair Crew
        │
        ├── Submits repair evidence
        ▼
    Authority Review
        │
        ├── Approve
        └── Return for repair
        │
        ▼
   Verification

Features

Evidence collection

Citizen road-damage reports

Drone video uploads

Drone telemetry uploads

Direct uploads to Supabase Storage using signed upload URLs

Optional report descriptions

Telemetry-derived GPS for drone detections

AI detection

Python FastAPI detection service

Hosted Roboflow inference

Pothole/road-damage detection

Confidence filtering

Bounding-box processing

Video frame extraction with FFmpeg

Configurable frame processing

Operations

Detection records

Automated urgency scoring

Estimated repair cost

SLA/priority information

Work-order generation

PDF work-order reports

Crew assignment

Repair evidence submission

Authority review

Verification after approval

Role-based access

Role

Main responsibilities

citizen

Submit reports, view own reports, provide feedback

drone_operator

Submit drone flight runs with video + telemetry and view their reports

authority

View operations, dispatch work, assign crews, review repairs, view PDFs

crew

View assigned work and submit repair evidence

admin

Administrative access and authority-level operations

The repair-submission action is restricted to the repair crew role.

Tech Stack

Frontend

React

TypeScript

Vite

Tailwind CSS

Radix UI

React Query

React Hook Form

Zod

Recharts

Wouter

Lucide React

Backend

Node.js

Express

Supabase JS

PostgreSQL through Supabase

JWT authentication

bcrypt password hashing

PDFKit

Axios

AI service

Python

FastAPI

Uvicorn

Pydantic

Requests

FFmpeg

Roboflow hosted inference

Storage / database

Supabase PostgreSQL

Supabase Storage

Project Structure

sentriroad/
├── artifacts/
│   └── sentriroad/                 # React/Vite frontend
│       ├── src/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── pages/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── public/
│       ├── package.json
│       └── vite.config.ts
│
├── lib/
│   ├── api-client-react/            # Generated React API client
│   └── api-spec/
│       └── openapi.yaml             # API contract
│
└── sentriroad-backend/
    └── src/
        ├── config/
        ├── controllers/
        ├── middleware/
        ├── routes/
        ├── services/
        ├── utils/
        └── server.js

Backend AI service and database files:

sentriroad-backend/
├── ai-service/
│   ├── main.py
│   ├── telemetry_service.py
│   └── requirements.txt
├── scripts/
│   └── seed.js
├── sql/
│   └── schema.sql
└── package.json

Prerequisites

Install the following before running the project:

Node.js 18+ recommended

npm

Python 3.10+

FFmpeg

A Supabase project

A Roboflow account/API key if using real AI inference

Environment Variables

Backend

Create a .env file in the backend directory.

PORT=4000
NODE_ENV=development

SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=evidence-uploads

JWT_SECRET=your_random_jwt_secret
JWT_EXPIRES_IN=7d

AI_SERVICE_URL=http://localhost:8000

SLA_HOURS_DEFAULT=48

AI Service

Create ai-service/.env:

ROBOFLOW_API_KEY=your_roboflow_private_api_key
ROBOFLOW_MODEL_ID=your_model_id

Never commit .env files or service-role/API keys to GitHub.

Database Setup

The backend contains the database schema in:

sql/schema.sql

The schema defines the core entities used by the application, including users, reports, detections, scores, work orders, and verification records.

Before applying database changes to an existing production/development database, inspect the current Supabase schema and compare it with the repository schema.

Supabase Storage

Create a storage bucket for evidence uploads.

The default configuration expects:

evidence-uploads

The application uses signed upload URLs so large media files can be uploaded directly to Supabase Storage instead of passing the file through the Express server.

Running the Project

1. Backend

cd sentriroad-backend
npm install
npm start

Development mode:

npm run dev

The API is served under:

/api/v1

2. AI service

cd sentriroad-backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

FFmpeg must be available on the system PATH.

Verify:

ffmpeg -version

3. Frontend

From the frontend workspace:

pnpm install
pnpm dev

Or use the project's configured package manager/workspace commands.

For a production build:

pnpm build

Drone Telemetry

Drone runs are designed to use GPS from the uploaded telemetry instead of requiring manual address/latitude/longitude entry.

Typical drone submission:

Flight video
     +
Telemetry file (.srt)
     │
     ▼
Telemetry parser
     │
     ▼
Timestamp → GPS mapping
     │
     ▼
Video frame timestamp
     │
     ▼
Detection + GPS

This allows detected road damage to be associated with the location where it occurred during the flight.

The telemetry implementation currently supports DJI-style .srt telemetry parsing.

API

The API contract is maintained in:

lib/api-spec/openapi.yaml

Important endpoints include:

Authentication

POST /api/v1/auth/signup
POST /api/v1/auth/login
GET  /api/v1/auth/me

Uploads

POST /api/v1/uploads/signed-url

Reports

POST /api/v1/reports
GET  /api/v1/reports
GET  /api/v1/reports/:id
GET  /api/v1/reports/:id/status
GET  /api/v1/reports/:id/detections
GET  /api/v1/reports/:id/score
POST /api/v1/reports/:id/feedback

Work orders

GET   /api/v1/workorders
GET   /api/v1/workorders/:id
GET   /api/v1/workorders/:id/pdf
PATCH /api/v1/workorders/:id/dispatch
PATCH /api/v1/workorders/:id/assign-crew
POST  /api/v1/workorders/:id/submit-repair
PATCH /api/v1/workorders/:id/review
GET   /api/v1/workorders/:id/verification

Metrics

GET /api/v1/metrics/summary

Role Permissions

The backend enforces role restrictions in addition to the frontend UI.

Citizen

Can:

Create citizen reports

View permitted reports

View detections/scores

Submit feedback

Drone Operator

Can:

Create drone flight reports

Upload flight video

Upload telemetry

View their own drone reports and processing results

Drone operators do not manually enter the road location when telemetry is being used.

Authority

Can:

View operational work

Dispatch work orders

Assign repair crews

Download work-order PDFs

Review repair submissions

Approve or return repairs

Authority users do not submit repair evidence.

Crew

Can:

View assigned work orders

Submit repair evidence

Admin

Can perform administrative/authority-level operations.

Authentication

SentriRoad uses:

Password
   ↓
bcrypt hash
   ↓
JWT
   ↓
Authorization header
   ↓
Express auth middleware
   ↓
Role authorization

Authenticated API requests use:

Authorization: Bearer <JWT>

AI Video Processing

For video evidence, the AI service extracts frames using FFmpeg.

The processing pipeline is approximately:

Video
  ↓
Frame extraction
  ↓
Selected frames
  ↓
Roboflow inference
  ↓
Confidence filtering
  ↓
Bounding-box normalization
  ↓
Best detection
  ↓
Backend detection record

The exact frame sampling and detection behavior should be treated as implementation details and may change as the AI pipeline evolves.

Scoring

After a detection is created, the backend scoring service evaluates the road issue and generates operational information such as:

urgency/priority

estimated repair cost

SLA information

This information is then used by the authority dashboard and work-order workflow.

Development Notes

Frontend API client

The frontend uses the generated client under:

lib/api-client-react/

The OpenAPI definition is:

lib/api-spec/openapi.yaml

When API response shapes or endpoints change, keep the OpenAPI contract and generated client in sync with the backend.

Direct uploads

Media files are intended to go directly to Supabase Storage through signed URLs. This avoids sending large video files through the Express server.

Security

Never commit:

.env
service_role keys
Roboflow private API keys
JWT secrets
database passwords

The backend service-role key must remain server-side.

Testing / Validation

Useful checks:

Frontend typecheck

pnpm typecheck

Frontend production build

pnpm build

Backend

npm start

AI service

uvicorn main:app --reload --port 8000

For production deployments, also test the complete flow with real Supabase Storage, database access, AI inference, telemetry, and role permissions.

Current Architecture

┌──────────────────────────────┐
│          React UI            │
│        Vite + TypeScript     │
└──────────────┬───────────────┘
               │ REST API
               ▼
┌──────────────────────────────┐
│       Express Backend        │
│ Auth / Reports / Workorders  │
│ Scoring / PDF / Orchestration│
└───────┬──────────────┬───────┘
        │              │
        │              ▼
        │      ┌─────────────────┐
        │      │ Python FastAPI  │
        │      │   AI Service    │
        │      └────────┬────────┘
        │               │
        │               ▼
        │          Roboflow API
        │
        ▼
┌──────────────────────────────┐
│           Supabase           │
│ PostgreSQL + Storage + Auth  │
└──────────────────────────────┘

Contributing

Create a feature branch.

Make the required changes.

Run frontend typechecking/build.

Test the relevant backend/API workflow.

Verify role permissions.

Open a pull request with a clear description of the change.

License

Add the project's chosen license here before publishing the repository publicly.

SentriRoad — road safety evidence, AI-assisted detection, and repair operations in one workflow.

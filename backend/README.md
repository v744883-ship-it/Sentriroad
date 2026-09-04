# Sentriroad Backend

A real, working backend — Express + Supabase (project: **pot-detect**), plus
a separate Python AI service. Everything here has been tested (scoring
math verified, PDF generation verified visually, all routes/auth/validation
tested end-to-end against a running server). The only thing untested against
*your* real data is the live Supabase connection, since that needs your
actual service role key.

## What's simplified vs. the original plan (per your call)

- **No Auth0** — basic auth instead: bcrypt password hashing + our own JWTs.
- **No Twilio/notifications** — status changes just show up when the citizen
  opens `/reports` in the app. No SMS/email sending anywhere in this code.
- **No Cloudinary** — Supabase Storage handles all file uploads, using the
  direct-to-cloud signed-URL pattern we discussed (large files never pass
  through this backend).

## Setup — step by step

### 1. Create the database schema

Open your Supabase project (**pot-detect**) → SQL Editor → New Query → paste
the entire contents of `sql/schema.sql` → Run. This creates every table.

### 2. Create the storage bucket

Supabase Dashboard → Storage → New bucket → name it exactly `evidence-uploads`
(or pick your own name, see step 3) → **make it Public** (so uploaded photos
have directly-viewable URLs for your dashboards).

### 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:
- `SUPABASE_URL` is already filled in for your `pot-detect` project.
- `SUPABASE_SERVICE_ROLE_KEY` — get this from Project Settings → API →
  `service_role` key (**not** the publishable/anon key you shared earlier —
  this one is more sensitive, keep it out of git and out of chat).
- `SUPABASE_STORAGE_BUCKET` — must match the bucket name from step 2.
- `JWT_SECRET` — generate one: `openssl rand -base64 32`, paste the output in.

### 4. Install and seed

```bash
npm install
npm run seed
```

This creates 5 demo accounts (citizen ×2, authority ×1, crew ×2), all with
password `123`, so you have something to log in as immediately.
See `scripts/seed.js` for the exact list of emails.

### 5. Run the backend

```bash
npm start
```

Runs at `http://localhost:4000/api/v1` — same base path your frontend team
is already building against from the mock-server package.

### 6. Set up the AI service (real pothole detection, via Roboflow)

This is a **separate process** from the Node backend. It now calls a real,
pretrained pothole-detection model (Roboflow hosted API) — no local GPU or
model training needed, and no `torch`/`ultralytics` install (which caused
the Rust/MSVC build errors on Windows earlier).

```bash
cd ai-service
pip install -r requirements.txt
cp .env.example .env
```

Edit `ai-service/.env`:
- Create a free account at roboflow.com
- Account Settings → Roboflow API → copy your **Private API Key** → paste into `ROBOFLOW_API_KEY`
- `ROBOFLOW_MODEL_ID` is pre-filled with a pothole-detection model trained on
  Indian roads (Intel Unnati Training Program) — swap it if you find/train a
  better one later; format is `"project-slug/version"`

You also need **ffmpeg** installed and on PATH, for video frame extraction:
- Windows: download from ffmpeg.org, add the `bin` folder to your PATH, confirm with `ffmpeg -version`
- Mac: `brew install ffmpeg`
- Linux: `apt install ffmpeg`

Then run it:
```bash
uvicorn main:app --reload --port 8000
```

**What this does now, for real** (all tested — see notes below):
- **Photos**: sent directly to the Roboflow model using the public Supabase URL — real pothole/crack detection, real confidence score, real bounding box.
- **Videos**: extracts frames via ffmpeg (1 frame/sec by default, capped at 20 frames per video), runs detection on every frame, and returns the single highest-confidence detection across all of them — so one video produces one representative work order instead of guessing from one arbitrary frame.
- **Missing API key**: fails safely (returns "no detection" rather than fake data), so a misconfigured `.env` never silently creates bogus work orders.

**Still not built** (flagged, not forgotten):
- GPS-per-frame from a drone's flight telemetry file — still using the single report-level GPS point. Only matters once you're ingesting real drone footage with a flight log.
- Multiple distinct potholes from one video becoming multiple work orders — currently one video → one best detection → one work order, same as the photo path.
- The evidence image shown for a video-sourced detection currently falls back to the source video URL, not the specific winning frame — ask if you want that wired up (needs uploading the winning frame to Supabase Storage).


## How the pieces connect

```
Citizen uploads photo (direct to Supabase Storage via signed URL)
        ↓
POST /reports  →  saved to DB, status = 'reported'
        ↓ (async, doesn't block the response)
Node backend calls Python AI service → POST /detect
        ↓
Detection saved → Score computed → Work Order created → PDF generated
        ↓
Authority dashboard: GET /workorders?sort=urgency
        ↓
assign-crew → crew submits repair photo → authority reviews
        ↓
approved → auto-creates Verification, flips report to 'verified'
        ↓
Citizen dashboard shows 'verified' next time they open the app (no push notification)
```

## Testing what I built, without your live credentials/API access

I validated everything I could without live network access to Supabase or
Roboflow from my environment:

- ✅ Scoring engine — ran it with real numbers, produces sensible urgency scores and cost estimates
- ✅ PDF generation — generated a real PDF, rendered it to an image, confirmed it looks correct with all required fields (location, cost, urgency, SLA)
- ✅ JWT signing/verification and bcrypt password hashing — tested directly
- ✅ Server boots, all routes registered, auth middleware correctly returns 401/403 without a token
- ✅ AI service bbox math — tested the pixel-to-normalized-coordinate conversion against a known input/output pair, confirmed correct
- ✅ AI service confidence-threshold filtering — confirmed low-confidence predictions are correctly discarded
- ✅ AI service frame extraction — generated real test videos, ran actual ffmpeg extraction against them, confirmed correct frame count and timestamps at 1fps, and confirmed the 20-frame cap samples evenly across a longer video instead of just the start
- ✅ AI service `/detect` endpoint — full request/response flow tested for both photo and video paths using mocked Roboflow responses (mocked only because Roboflow's API isn't reachable from my sandboxed environment — the request-building and response-parsing code itself is real and tested)
- ✅ AI service safety fallback — confirmed a missing API key returns "no detection" rather than fabricating a fake one
- ⚠️ **Not yet tested:** an actual live call to Roboflow's hosted API (needs your real `ROBOFLOW_API_KEY`, which only you can get by signing up), and anything touching the real `pot-detect` Supabase database beyond what you've already run yourself (you've since confirmed signup, login, report creation, and the full AI pipeline → work order → PDF flow all work against your real data)

## What you (Shreyas) have already confirmed working live

Since the earlier handoff, you've personally run and confirmed against your
real Supabase project:
- Schema creation, storage bucket setup
- Seed script creating real demo users
- Login returning a real JWT
- Report creation
- The full async pipeline: detection → score → work order → PDF, with a real downloadable PDF

The only new piece to verify now is swapping the placeholder AI detections
for real ones — do that by setting up `ROBOFLOW_API_KEY` as described above,
restarting the AI service, and creating one more test report with a **real
photo of a pothole** (not the random picsum placeholder images used so far)
as `media_url`. Check the resulting `detection`/`score`/`work_order` the same
way as before — this time `damage_type` and `confidence` should reflect an
actual model prediction instead of random placeholder values.

## Folder structure

```
sentriroad-backend/
├── src/
│   ├── config/        env loading, Supabase client
│   ├── middleware/     auth (JWT + role check), error handler
│   ├── routes/          one file per resource, matches API_SPEC.md
│   ├── controllers/    request handling per route
│   ├── services/        scoring engine, PDF generation, storage, AI orchestration
│   └── server.js        entry point
├── scripts/seed.js     creates demo accounts
├── sql/schema.sql       run this in Supabase SQL Editor first
├── ai-service/           separate Python FastAPI service
├── .env.example
└── package.json
```

# Sentriroad — API Specification (v1)

**One API, four portals.** Citizen, Authority, Crew, and Drone-Operator
dashboards all call the *same* endpoints. What differs is which role is logged in
— the backend filters and restricts responses based on the JWT's role and user
id. Do not build separate APIs per dashboard.

All endpoints are prefixed with `/api/v1`. All request/response bodies match the
shapes in `types/index.ts` — treat that file as the source of truth; this doc
explains *when* and *why* to call each one.

---

## Auth

| Method | Endpoint | Who can call | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | citizens only | Create a **citizen** account. Body: `{name, email, password, role: "citizen", phone?}`. Authority/crew/admin/operator accounts are **not** self-registered — they are provisioned by the municipality (see `backend/scripts/seed.js`) and the server rejects other roles with `VALIDATION_ERROR` |
| POST | `/auth/login` | anyone | Role-first login. Body: `{email, password, role}` → returns `LoginResponse` (token + user). The server **rejects** a `role` that doesn't match the account's registered role with `403 ROLE_MISMATCH`, so a citizen can never receive a token for the authority/crew portal (or vice versa) |
| GET | `/auth/me` | any logged-in user | Returns the current user's own profile |
| GET | `/auth/users?role=` | authority, admin | List users (used to populate the "Assign Crew" dropdown). Optional `?role=` filter, e.g. `/auth/users?role=crew`. Never returns password hashes |

All endpoints below **require** `Authorization: Bearer <token>` unless stated otherwise.

---

## Uploads (used before creating a Report or submitting a repair photo)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| POST | `/uploads/signed-url` | citizen, crew, admin | Body: `SignedUploadRequest` → returns a signed upload URL. **Frontend uploads the file directly to storage using this URL — never send the raw file to our backend.** |

**Flow (implemented in `frontend/src/api/client.ts` → `uploadFile`):**
1. `POST /uploads/signed-url` with `{filename, content_type}` → returns `{upload_url, file_path, public_url_after_upload, expires_at}`
2. `PUT` the raw file bytes straight to `upload_url` (never send the raw file to the API server)
3. Use `public_url_after_upload` as `media_url` on `POST /reports`, or as `after_photo_url` for crew `submit-repair`

The mock server stores the PUT bytes in memory and serves them back from
`public_url_after_upload`, so the same flow round-trips for real in demos.
The real backend points `upload_url` at Supabase Storage instead.

---

## Reports (citizen-created issues)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| POST | `/reports` | citizen, drone_operator, crew | Create a new report. Body: `CreateReportRequest`. Send `source_type: "drone"` + `telemetry_url` for drone-survey submissions (Drone Operator console); omit `gps` for those — location comes from the telemetry file. Citizen submissions keep sending `gps` |
| GET | `/reports` | citizen (own only), authority (all), crew (assigned only + own drone submissions), drone_operator (own only) | List reports — response is automatically scoped by role |
| GET | `/reports/:id` | owner citizen, authority, assigned crew, owning drone_operator | Full report detail including its Detection/Score/WorkOrder if computed |
| GET | `/reports/:id/status` | owner citizen | Lightweight status-only poll, used by the citizen tracker UI |
| POST | `/reports/:id/feedback` | owner citizen | Only callable once status = `verified`. Body: `SubmitFeedbackRequest` |
| GET | `/reports/:id/feedback` | authority, admin, owner citizen (anyone who can view the report) | Citizen feedback posted against the report (`{data: Feedback[]}`, newest first) — this is how Authority sees the ratings/comments citizens leave after a repair is verified |
| POST | `/reports/:id/assign-crew` | authority, admin | Body: `AssignCrewRequest` (`{crew_id}`). Assign a crew member straight from a **new citizen report** (the dashboard's "New Citizen Reports" list). If the AI pipeline hasn't produced a work order yet, one is created on the fly with placeholder detection/score rows and the report jumps to `assigned_to_crew`. If a work order already exists, it reuses the same rules as `PATCH /workorders/:id/assign-crew`. Returns the (updated) work order in the standard WorkOrder shape |

> **Frontend note (Citizen dashboard):** `GET /reports` with no params always
> returns *only the logged-in citizen's own reports* — the backend reads the
> user id off the token, you never need to pass a citizen id yourself.
>
> **Frontend note (Drone Operator console):** the drone-operator unit uploads a
> road **video** + a **telemetry** file via the signed-upload flow, then calls
> `POST /reports` with `{ media_url, media_type: "video", source_type:
> "drone", telemetry_url, address?, description? }` — no `gps`. The AI
> pipeline locates each pothole from the telemetry and creates **one scored
> work order per detection**, which the authority then dispatches to a crew.
> `GET /reports` for a `drone_operator` returns only their own surveys, and
> each survey's generated work orders are returned on the report row in the
> mock server (additive `work_orders` summary array). An operator can open
> their own report detail (`GET /reports/:id`).

---

## Detections & Scores (read-only for frontend — written internally by the AI pipeline)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| GET | `/reports/:id/detections` | authority, owner citizen | See what the AI model found on this report |
| GET | `/reports/:id/score` | authority, owner citizen | See the urgency score + 5-factor breakdown |

---

## Work Orders (the authority + crew workflow lives here)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| GET | `/workorders` | authority (all), crew (assigned only) | Priority list. Supports `?sort=urgency`, `?status=`, `?overdue=true` |
| GET | `/workorders/:id` | authority, assigned crew, owner citizen (via report) | Full detail |
| GET | `/workorders/:id/pdf` | authority | Returns the generated PDF (location, image, cost, urgency, SLA) |
| PATCH | `/workorders/:id/dispatch` | authority | Moves status `scored` → `dispatched` |
| PATCH | `/workorders/:id/assign-crew` | authority | Body: `AssignCrewRequest`. Moves status → `assigned_to_crew`, notifies crew |
| POST | `/workorders/:id/submit-repair` | assigned crew only | Body: `SubmitRepairRequest`. Moves status → `crew_submitted`, notifies authority |
| PATCH | `/workorders/:id/review` | authority | Body: `ReviewRequest`. `approved` → status `repaired` (+ triggers verification); `rejected` → status back to `assigned_to_crew` with `rejection_reason` set, notifies crew to redo |

> **Frontend note (Crew dashboard):** `GET /workorders` for a crew-role user
> returns *only work orders assigned to them* — same endpoint as authority
> uses, different scope, enforced server-side.

---

## Verification (system-triggered, mostly read-only for frontend)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| GET | `/workorders/:id/verification` | authority, owner citizen | Before/after images + verified timestamp |

Verification is created automatically by the backend once a `review` is
`approved` — frontend does not create this directly. It's what flips the
report's status to `verified` and unlocks citizen feedback.

---

## Metrics (Authority dashboard summary panel)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| GET | `/metrics/summary` | authority | Returns `MetricsSummary` — cost avoided, riders protected, % verified, open issues, overdue SLA count |

---

## Zones / Drone (v2 — stubbed in mock server, build UI against it now if time allows)

| Method | Endpoint | Who | Purpose |
|---|---|---|---|
| GET | `/zones/priority` | authority, drone operator | RL-recommended zones + route, with estimated battery savings |
| POST | `/drone/footage` | drone operator | Same signed-upload pattern as reports; kicks off frame-extraction pipeline |

---

## Status flow reference (for building the tracker UIs)

```
reported → scored → dispatched → assigned_to_crew → crew_submitted
   → reviewing → [approved: repaired → verified]
              → [rejected: back to assigned_to_crew, with rejection_reason]
```

Citizen dashboard shows a simplified version of this (collapse `scored`,
`dispatched` into "Under Review"; collapse `assigned_to_crew`,
`crew_submitted`, `reviewing` into "Repair in Progress"). Authority and Crew
dashboards should show the real granular status.

---

## Error format

Every error response follows the same shape (`ApiError` in types):

```json
{ "error": { "code": "NOT_FOUND", "message": "Work order not found" } }
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
`INVALID_STATE_TRANSITION` (e.g. trying to review a work order that isn't in
`crew_submitted` status), `ROLE_MISMATCH` (logging in to the wrong portal for
the account's registered role).

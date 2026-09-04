/**
 * SENTRIROAD MOCK API SERVER
 * ---------------------------
 * A real, running Express server that implements the full API_SPEC.md
 * contract against in-memory fixture data. Frontend teams point their app
 * at http://localhost:4000/api/v1 and build against this exactly as they
 * would the real backend. When the real backend is ready, only the base
 * URL changes.
 *
 * Auth here is intentionally simplified (no real JWT signing — tokens
 * are just the base64 user id — but passwords ARE checked: every seeded
 * account uses the demo password "123", same as the real backend's
 * seed accounts). The role contract matches the real backend exactly:
 * the login screen asks which portal the user is signing in to, and
 * this server REJECTS a sign-in when the account's registered role
 * doesn't match (403 ROLE_MISMATCH). A citizen account can never log
 * into the authority/crew portal, and vice versa. There is no
 * passwordless "login as any role" shortcut anymore.
 *
 * Run:
 *   npm install
 *   npm start
 * Server runs on http://localhost:4000
 */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const users = require("./data/users.json");
let reports = require("./data/reports.json");
let detections = require("./data/detections.json");
let scores = require("./data/scores.json");
let workorders = require("./data/workorders.json");
let verifications = require("./data/verifications.json");
let feedback = require("./data/feedback.json");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const PREFIX = "/api/v1";

// Single-process deployment (see Dockerfile): when STATIC_DIR points at the
// built frontend folder, this same server also serves the UI with an SPA
// fallback — one process = the whole app on one URL/port.
const fs = require("fs");
const path = require("path");
const STATIC_DIR = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null;

// ---------------- helpers ----------------

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Fake token = base64(userId). Good enough for a mock server.
function encodeToken(userId) {
  return Buffer.from(userId).toString("base64");
}
function decodeToken(token) {
  try {
    return Buffer.from(token, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// Auth middleware — reads Authorization: Bearer <token>, attaches req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return apiError(res, 401, "UNAUTHORIZED", "Missing bearer token");

  const userId = decodeToken(token);
  const user = users.find((u) => u.id === userId);
  if (!user) return apiError(res, 401, "UNAUTHORIZED", "Invalid token");

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return apiError(res, 403, "FORBIDDEN", `Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
}

function attachWorkOrderContext(wo) {
  const report = reports.find((r) => r.id === wo.report_id);
  const score = scores.find((s) => s.id === wo.score_id);
  return { ...wo, report, score };
}

// Lightweight additive enrichment: drone reports get a compact summary of
// the work orders their AI analysis has generated, so the operator and
// authority dashboards can show per-pothole results with a single list
// call. Real-backend rows simply omit the field (UI degrades gracefully).
function attachReportExtras(r) {
  if (r.source_type !== "drone") return r;
  return {
    ...r,
    work_orders: workorders
      .filter((w) => w.report_id === r.id)
      .map((w) => ({
        id: w.id,
        status: w.status,
        damage_type: w.damage_type,
        urgency_score: w.urgency_score,
        cost_estimate: w.cost_estimate,
      })),
  };
}

// ---------- Mock "AI analysis" for drone surveys ----------
// The real backend runs the drone video + telemetry through the AI
// service (clustering pothole detections, then per-pothole scores and
// work orders). The mock simulates that with a short delay so the UI can
// show the full Reported -> Analysed -> Work orders lifecycle live.

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fallback coordinate resolution — in production the telemetry file gives
// the exact flight path; the mock approximates from the road name.
function addressToGps(address) {
  const a = (address || "").toLowerCase();
  const spots = [
    [/whitefield|itpl/i, 12.9698, 77.75],
    [/marathahalli|outer ring/i, 12.9569, 77.6967],
    [/koramangala|sony signal/i, 12.9352, 77.6246],
    [/indiranagar|cmh road/i, 12.9719, 77.6412],
    [/domlur|hal airport/i, 12.9611, 77.6387],
    [/hebbal/i, 13.0358, 77.597],
    [/jayanagar/i, 12.925, 77.5938],
    [/bellandur/i, 12.9304, 77.6784],
  ];
  for (const [re, lat, lng] of spots) if (re.test(a)) return { lat, lng };
  return { lat: 12.9716, lng: 77.5946 }; // central Bengaluru
}

function estimateCostMock(damageType, urgencyScore) {
  const base = damageType === "crack" ? 8000 : 12000;
  return Math.round(base * (0.6 + (urgencyScore / 100) * 0.8));
}

function runDroneAnalysis(report) {
  // Guard: citizen report or already analysed.
  if (report.source_type !== "drone") return;
  if (detections.some((d) => d.report_id === report.id)) return;

  const rng = mulberry32(hashString(report.id));
  const base = addressToGps(report.address);
  const count = 1 + Math.floor(rng() * 3); // 1..3 clustered potholes

  for (let i = 0; i < count; i++) {
    const damageType = rng() < 0.75 ? "pothole" : "crack";
    const confidence = Math.round((0.72 + rng() * 0.22) * 100) / 100;
    const urgencyScore = Math.round(35 + rng() * 55); // 35..90
    const lat = base.lat + (rng() - 0.5) * 0.0024;
    const lng = base.lng + (rng() - 0.5) * 0.0024;
    const segmentLabel =
      count === 1 ? "" : ` — finding ${i + 1} of ${count}`;

    const detection = {
      id: genId("d"),
      report_id: report.id,
      damage_type: damageType,
      confidence,
      bounding_box: [0.2 + rng() * 0.2, 0.4 + rng() * 0.2, 0.15, 0.12],
      evidence_image_url: null, // location map is rendered instead
      gps_lat: Math.round(lat * 1e6) / 1e6,
      gps_lng: Math.round(lng * 1e6) / 1e6,
      frame_timestamp_seconds: Math.round(((i + 1) * 14 + rng() * 6) * 10) / 10,
      created_at: nowIso(),
    };
    detections.push(detection);

    const score = {
      id: genId("s"),
      detection_id: detection.id,
      urgency_score: urgencyScore,
      factor_breakdown: {
        severity: Math.min(100, urgencyScore + Math.round((rng() - 0.5) * 20)),
        traffic_volume: Math.min(100, urgencyScore + Math.round((rng() - 0.5) * 20)),
        accident_risk: Math.min(100, urgencyScore + Math.round((rng() - 0.5) * 20)),
        road_category: Math.min(100, urgencyScore + Math.round((rng() - 0.5) * 20)),
        time_since_detection: Math.min(100, urgencyScore + Math.round((rng() - 0.5) * 20)),
      },
      computed_at: nowIso(),
    };
    scores.push(score);

    workorders.push({
      id: genId("w"),
      report_id: report.id,
      score_id: score.id,
      location: {
        address: `${report.address || "Drone survey"}${segmentLabel}`,
        gps: { lat: detection.gps_lat, lng: detection.gps_lng },
      },
      evidence_image_url: null,
      damage_type: damageType,
      urgency_score: urgencyScore,
      cost_estimate: estimateCostMock(damageType, urgencyScore),
      sla_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      status: "scored",
      assigned_crew_id: null,
      crew_submitted_at: null,
      crew_photo_url: null,
      review_status: null,
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
      pdf_url: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  report.status = "scored";
  // eslint-disable-next-line no-console
  console.log(
    `[mock-ai] drone report ${report.id} analysed: ${count} finding(s) → ${count} scored work order(s) created`
  );
}

// ---------------- AUTH ----------------

app.post(`${PREFIX}/auth/signup`, (req, res) => {
  const { name, email, role, phone, password } = req.body || {};
  if (!name || !email || !role || !password) {
    return apiError(res, 400, "VALIDATION_ERROR", "name, email, password, and role are required");
  }
  if (role !== "citizen") {
    // Role separation mirrors the real backend: only citizens
    // self-register; authority/crew/admin accounts are seeded.
    return apiError(
      res,
      400,
      "VALIDATION_ERROR",
      "Public sign-up is for citizens only. Authority, crew, and operator accounts are provisioned by the municipality."
    );
  }
  const user = {
    id: genId("u"),
    name,
    email,
    phone: phone || null,
    role,
    password: password || "123",
    created_at: nowIso(),
  };
  users.push(user);
  res.status(201).json({ token: encodeToken(user.id), user });
});

app.post(`${PREFIX}/auth/login`, (req, res) => {
  // Mock login mirrors the real backend's contract: find the account by
  // email, verify the password (every seeded account uses "123"), and
  // — because the login screen is role-first — reject a mismatch
  // between the selected portal role and the account's registered role.
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    return apiError(res, 400, "VALIDATION_ERROR", "email and password are required");
  }
  const user = users.find((u) => u.email === email);
  // Seeded users carry no stored password → use the shared demo password
  // ("123", same as the real backend's seed accounts). Accounts created
  // through mock signup store their chosen password and are checked
  // against that instead.
  const expected = user?.password ?? "123";
  if (!user || password !== expected) {
    return apiError(res, 401, "UNAUTHORIZED", "Invalid email or password");
  }

  if (role) {
    if (!["citizen", "authority", "crew", "admin", "drone_operator"].includes(role)) {
      return apiError(res, 400, "VALIDATION_ERROR", "role must be one of citizen, authority, crew, admin, drone_operator");
    }
    if (user.role !== role) {
      return apiError(
        res,
        403,
        "ROLE_MISMATCH",
        `This account is registered as "${user.role}". Use the ${user.role} portal to sign in.`
      );
    }
  }

  res.json({ token: encodeToken(user.id), user });
});

app.get(`${PREFIX}/auth/me`, requireAuth, (req, res) => {
  res.json(req.user);
});

// Authority/admin only: list users (populates the "Assign Crew" dropdown
// on the work-order detail screen). Optional ?role= filter.
app.get(`${PREFIX}/auth/users`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  let list = users;
  if (req.query.role) list = users.filter((u) => u.role === req.query.role);
  res.json({ data: list });
});

// ---------------- UPLOADS ----------------
// Same contract as the real backend: POST /uploads/signed-url → PUT the
// file bytes straight to the returned upload_url → use
// public_url_after_upload as media_url. Unlike the real backend (which
// points at Supabase Storage), the mock actually stores the bytes in
// memory and serves them back so uploads round-trip for real in demos.

const uploadedFiles = new Map(); // full path -> { buffer, contentType }

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function collectRawBody(req, res, next) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", next);
}

app.post(`${PREFIX}/uploads/signed-url`, requireAuth, (req, res) => {
  const { filename, content_type } = req.body || {};
  if (!filename || !content_type) {
    return apiError(res, 400, "VALIDATION_ERROR", "filename and content_type are required");
  }
  const path = `uploads/${req.user.id}/${Date.now()}-${sanitizeFilename(filename)}`;
  const target = `http://localhost:${PORT}/${path}`;
  res.json({
    upload_url: target,
    file_path: path,
    public_url_after_upload: target,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
});

// PUT = the "direct upload to storage" step (browser → mock storage)
app.put("/uploads/*", collectRawBody, (req, res) => {
  const path = `uploads/${req.params[0]}`;
  const contentType =
    (req.headers["content-type"] && req.headers["content-type"].split(";")[0]) || "application/octet-stream";
  uploadedFiles.set(path, { buffer: req.rawBody, contentType });
  res.status(200).json({ ok: true });
});

// GET = serving the stored file back (media_url / after-photo display)
app.get("/uploads/*", (req, res) => {
  const path = `uploads/${req.params[0]}`;
  const file = uploadedFiles.get(path);
  if (!file) return apiError(res, 404, "NOT_FOUND", "Uploaded file not found");
  res.set("Content-Type", file.contentType);
  res.set("Cache-Control", "public, max-age=3600");
  res.send(file.buffer);
});

// ---------------- REPORTS ----------------

app.post(`${PREFIX}/reports`, requireAuth, requireRole("citizen", "drone_operator", "crew"), (req, res) => {
  const { media_url, media_type, gps, address, description, source_type, telemetry_url } = req.body || {};
  const isDrone = source_type === "drone";
  if (!media_url || !media_type) {
    return apiError(res, 400, "VALIDATION_ERROR", "media_url and media_type are required");
  }
  if (isDrone) {
    // Drone reports (crew/drone-operator survey uploads) have no single
    // GPS point at creation — location comes from the telemetry file.
    if (!telemetry_url) {
      return apiError(res, 400, "VALIDATION_ERROR", "telemetry_url is required for drone submissions");
    }
  } else if (!gps || gps.lat === undefined || gps.lng === undefined) {
    return apiError(res, 400, "VALIDATION_ERROR", "media_url, media_type, and gps {lat,lng} are required");
  }
  const report = {
    id: genId("r"),
    citizen_id: req.user.id,
    media_url,
    media_type,
    gps: isDrone ? { lat: null, lng: null } : gps,
    address: address || null,
    description: description || null,
    status: "reported",
    source_type: isDrone ? "drone" : "citizen",
    telemetry_url: isDrone ? telemetry_url : null,
    created_at: nowIso(),
  };
  reports.push(report);

  // Kick off the simulated drone AI analysis in the background so this
  // request returns immediately (mirrors the real backend's async
  // aiPipelineService). Detections/scores/work orders appear moments
  // later and the report flips reported -> scored.
  if (isDrone) setTimeout(() => runDroneAnalysis(report), 3000);

  res.status(201).json(report);
});

app.get(`${PREFIX}/reports`, requireAuth, (req, res) => {
  let scoped;
  if (req.user.role === "citizen") {
    scoped = reports.filter((r) => r.citizen_id === req.user.id);
  } else if (req.user.role === "authority" || req.user.role === "admin") {
    scoped = reports;
  } else if (req.user.role === "crew") {
    // Crew sees reports linked to their assigned work orders PLUS their
    // own drone-survey submissions (which store the crew member as
    // citizen_id = "submitted_by").
    const myWorkOrderReportIds = workorders
      .filter((w) => w.assigned_crew_id === req.user.id)
      .map((w) => w.report_id);
    scoped = reports.filter(
      (r) => myWorkOrderReportIds.includes(r.id) || r.citizen_id === req.user.id
    );
  } else if (req.user.role === "drone_operator") {
    scoped = reports.filter((r) => r.citizen_id === req.user.id);
  } else {
    scoped = [];
  }
  res.json({ data: scoped.map(attachReportExtras), page: 1, page_size: scoped.length, total: scoped.length });
});

app.get(`${PREFIX}/reports/:id`, requireAuth, (req, res) => {
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return apiError(res, 404, "NOT_FOUND", "Report not found");

  const canView =
    req.user.role === "authority" ||
    req.user.role === "admin" ||
    (req.user.role === "citizen" && report.citizen_id === req.user.id) ||
    (req.user.role === "drone_operator" && report.citizen_id === req.user.id) ||
    (req.user.role === "crew" &&
      workorders.some((w) => w.report_id === report.id && w.assigned_crew_id === req.user.id));
  if (!canView) return apiError(res, 403, "FORBIDDEN", "Not allowed to view this report");

  const detection = detections.find((d) => d.report_id === report.id) || null;
  const score = detection ? scores.find((s) => s.detection_id === detection.id) : null;
  const workOrder = workorders.find((w) => w.report_id === report.id) || null;

  res.json({ ...report, detection, score, work_order: workOrder });
});

app.get(`${PREFIX}/reports/:id/status`, requireAuth, (req, res) => {
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return apiError(res, 404, "NOT_FOUND", "Report not found");
  if (req.user.role === "citizen" && report.citizen_id !== req.user.id) {
    return apiError(res, 403, "FORBIDDEN", "Not your report");
  }
  res.json({ id: report.id, status: report.status, updated_at: nowIso() });
});

// Citizen feedback — readable by authority/admin (oversight) and the
// owning citizen; writable by the owning citizen once status = verified.
app.get(`${PREFIX}/reports/:id/feedback`, requireAuth, (req, res) => {
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return apiError(res, 404, "NOT_FOUND", "Report not found");
  const canView =
    req.user.role === "authority" ||
    req.user.role === "admin" ||
    (req.user.role === "citizen" && report.citizen_id === req.user.id) ||
    (req.user.role === "drone_operator" && report.citizen_id === req.user.id) ||
    (req.user.role === "crew" &&
      workorders.some((w) => w.report_id === report.id && w.assigned_crew_id === req.user.id));
  if (!canView) return apiError(res, 403, "FORBIDDEN", "Not allowed to view this report");
  res.json({
    data: feedback.filter((f) => f.report_id === report.id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
  });
});

app.post(`${PREFIX}/reports/:id/feedback`, requireAuth, requireRole("citizen"), (req, res) => {
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return apiError(res, 404, "NOT_FOUND", "Report not found");
  if (report.citizen_id !== req.user.id) return apiError(res, 403, "FORBIDDEN", "Not your report");
  if (report.status !== "verified") {
    return apiError(res, 409, "INVALID_STATE_TRANSITION", "Feedback only allowed once status is 'verified'");
  }
  const { rating, comment } = req.body || {};
  if (!rating) return apiError(res, 400, "VALIDATION_ERROR", "rating is required");

  const entry = {
    id: genId("f"),
    report_id: report.id,
    citizen_id: req.user.id,
    rating,
    comment: comment || null,
    created_at: nowIso(),
  };
  feedback.push(entry);
  res.status(201).json(entry);
});

// Authority shortcut: assign a crew member straight from a NEW citizen
// report (the dashboard's "New Citizen Reports" list). If no work order
// exists yet, one is created on the fly (with placeholder detection/
// score rows so score_id links) and the report jumps to
// assigned_to_crew. Matches the real backend's /reports/:id/assign-crew.
app.post(`${PREFIX}/reports/:id/assign-crew`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return apiError(res, 404, "NOT_FOUND", "Report not found");
  // Drone reports can spawn many work orders and have no single GPS
  // point — assign crews from their generated work orders instead.
  if (report.source_type === "drone") {
    return apiError(
      res,
      400,
      "VALIDATION_ERROR",
      "Drone reports are scored per-detection; assign crews from their generated work orders instead"
    );
  }

  const { crew_id } = req.body || {};
  if (!crew_id) return apiError(res, 400, "VALIDATION_ERROR", "crew_id is required");
  const crewUser = users.find((u) => u.id === crew_id && u.role === "crew");
  if (!crewUser) return apiError(res, 400, "VALIDATION_ERROR", "crew_id does not match a crew user");

  let wo = workorders.find((w) => w.report_id === report.id);
  if (!wo) {
    // AI pipeline hasn't scored this report yet — mint a manual work
    // order so the authority can expedite it (confidence 0 + mid-range
    // factors flag it as authority-created rather than AI-scored).
    const damageType = "pothole";
    const urgencyScore = 50;
    const detection = {
      id: genId("d"),
      report_id: report.id,
      damage_type: damageType,
      confidence: 0,
      bounding_box: [0.25, 0.5, 0.2, 0.12],
      evidence_image_url: report.media_url,
      frame_timestamp_seconds: null,
      created_at: nowIso(),
    };
    detections.push(detection);
    const score = {
      id: genId("s"),
      detection_id: detection.id,
      urgency_score: urgencyScore,
      factor_breakdown: { severity: 50, traffic_volume: 50, accident_risk: 50, road_category: 50, time_since_detection: 50 },
      computed_at: nowIso(),
    };
    scores.push(score);
    wo = {
      id: genId("w"),
      report_id: report.id,
      score_id: score.id,
      location: {
        address: report.address || "Address not provided",
        gps: { lat: report.gps?.lat ?? null, lng: report.gps?.lng ?? null },
      },
      evidence_image_url: report.media_url,
      damage_type: damageType,
      urgency_score: urgencyScore,
      cost_estimate: Math.round(12000 * (0.6 + (urgencyScore / 100) * 0.8)), // mirrors estimateCost('pothole')
      sla_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      status: "scored",
      assigned_crew_id: null,
      crew_submitted_at: null,
      crew_photo_url: null,
      review_status: null,
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
      pdf_url: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    workorders.push(wo);
  } else if (!["scored", "dispatched"].includes(wo.status)) {
    return apiError(res, 409, "INVALID_STATE_TRANSITION", `Cannot assign crew from work-order status '${wo.status}'`);
  }

  wo.assigned_crew_id = crew_id;
  wo.status = "assigned_to_crew";
  wo.updated_at = nowIso();
  report.status = "assigned_to_crew";

  res.json(attachWorkOrderContext(wo));
});

// ---------------- DETECTIONS / SCORES ----------------

app.get(`${PREFIX}/reports/:id/detections`, requireAuth, (req, res) => {
  const list = detections.filter((d) => d.report_id === req.params.id);
  res.json({ data: list });
});

app.get(`${PREFIX}/reports/:id/score`, requireAuth, (req, res) => {
  const detection = detections.find((d) => d.report_id === req.params.id);
  if (!detection) return apiError(res, 404, "NOT_FOUND", "No detection/score yet for this report");
  const score = scores.find((s) => s.detection_id === detection.id);
  res.json(score || null);
});

// ---------------- WORK ORDERS ----------------

app.get(`${PREFIX}/workorders`, requireAuth, (req, res) => {
  let scoped;
  if (req.user.role === "authority" || req.user.role === "admin") {
    scoped = workorders;
  } else if (req.user.role === "crew") {
    scoped = workorders.filter((w) => w.assigned_crew_id === req.user.id);
  } else {
    return apiError(res, 403, "FORBIDDEN", "Citizens should use /reports, not /workorders");
  }

  if (req.query.status) scoped = scoped.filter((w) => w.status === req.query.status);
  if (req.query.overdue === "true") {
    scoped = scoped.filter((w) => new Date(w.sla_deadline) < new Date() && w.status !== "verified");
  }
  if (req.query.sort === "urgency") {
    scoped = [...scoped].sort((a, b) => b.urgency_score - a.urgency_score);
  }

  res.json({ data: scoped.map(attachWorkOrderContext), page: 1, page_size: scoped.length, total: scoped.length });
});

app.get(`${PREFIX}/workorders/:id`, requireAuth, (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  res.json(attachWorkOrderContext(wo));
});

app.get(`${PREFIX}/workorders/:id/pdf`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  res.json({ pdf_url: wo.pdf_url || `https://storage.example.com/workorders/${wo.id}.pdf` });
});

app.patch(`${PREFIX}/workorders/:id/dispatch`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  if (wo.status !== "scored") {
    return apiError(res, 409, "INVALID_STATE_TRANSITION", `Cannot dispatch from status '${wo.status}'`);
  }
  wo.status = "dispatched";
  wo.updated_at = nowIso();
  res.json(attachWorkOrderContext(wo));
});

app.patch(`${PREFIX}/workorders/:id/assign-crew`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  const { crew_id } = req.body || {};
  if (!crew_id) return apiError(res, 400, "VALIDATION_ERROR", "crew_id is required");
  const crewUser = users.find((u) => u.id === crew_id && u.role === "crew");
  if (!crewUser) return apiError(res, 400, "VALIDATION_ERROR", "crew_id does not match a crew user");

  wo.assigned_crew_id = crew_id;
  wo.status = "assigned_to_crew";
  wo.updated_at = nowIso();
  res.json(attachWorkOrderContext(wo));
});

app.post(`${PREFIX}/workorders/:id/submit-repair`, requireAuth, requireRole("crew"), (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  if (wo.assigned_crew_id !== req.user.id) {
    return apiError(res, 403, "FORBIDDEN", "This work order is not assigned to you");
  }
  if (wo.status !== "assigned_to_crew") {
    return apiError(res, 409, "INVALID_STATE_TRANSITION", `Cannot submit repair from status '${wo.status}'`);
  }
  const { after_photo_url, notes } = req.body || {};
  if (!after_photo_url) return apiError(res, 400, "VALIDATION_ERROR", "after_photo_url is required");

  wo.crew_photo_url = after_photo_url;
  wo.crew_submitted_at = nowIso();
  wo.review_status = "pending";
  wo.status = "crew_submitted";
  wo.updated_at = nowIso();
  if (notes) wo.crew_notes = notes;
  res.json(attachWorkOrderContext(wo));
});

app.patch(`${PREFIX}/workorders/:id/review`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const wo = workorders.find((w) => w.id === req.params.id);
  if (!wo) return apiError(res, 404, "NOT_FOUND", "Work order not found");
  if (wo.status !== "crew_submitted" && wo.status !== "reviewing") {
    return apiError(res, 409, "INVALID_STATE_TRANSITION", `Cannot review from status '${wo.status}'`);
  }
  const { decision, rejection_reason } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return apiError(res, 400, "VALIDATION_ERROR", "decision must be 'approved' or 'rejected'");
  }

  wo.reviewed_by = req.user.id;
  wo.reviewed_at = nowIso();
  wo.updated_at = nowIso();

  if (decision === "approved") {
    wo.review_status = "approved";
    wo.status = "repaired";

    // auto-create verification + flip report to verified (mirrors real backend behavior)
    const verification = {
      id: genId("v"),
      work_order_id: wo.id,
      before_image: wo.evidence_image_url,
      after_image: wo.crew_photo_url,
      verified_by: req.user.id,
      verified_at: nowIso(),
    };
    verifications.push(verification);
    wo.status = "verified";

    const report = reports.find((r) => r.id === wo.report_id);
    if (report) report.status = "verified";
  } else {
    if (!rejection_reason) {
      return apiError(res, 400, "VALIDATION_ERROR", "rejection_reason is required when rejecting");
    }
    wo.review_status = "rejected";
    wo.rejection_reason = rejection_reason;
    wo.status = "assigned_to_crew"; // sent back to crew
    wo.crew_photo_url = null;
    wo.crew_submitted_at = null;
  }

  res.json(attachWorkOrderContext(wo));
});

app.get(`${PREFIX}/workorders/:id/verification`, requireAuth, (req, res) => {
  const v = verifications.find((v) => v.work_order_id === req.params.id);
  if (!v) return apiError(res, 404, "NOT_FOUND", "No verification yet for this work order");
  res.json(v);
});

// ---------------- METRICS ----------------

app.get(`${PREFIX}/metrics/summary`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  const open = workorders.filter((w) => w.status !== "verified").length;
  const overdue = workorders.filter(
    (w) => w.status !== "verified" && new Date(w.sla_deadline) < new Date()
  ).length;
  const verifiedCount = workorders.filter((w) => w.status === "verified").length;
  res.json({
    cost_avoided_inr: 28000000, // demo constant, matches deck's ₹2.8 Cr figure
    riders_protected_monthly: 12400,
    percent_repairs_verified: workorders.length
      ? Math.round((verifiedCount / workorders.length) * 100)
      : 0,
    open_issues: open,
    overdue_sla_count: overdue,
  });
});

// ---------------- ZONES / DRONE (v2 stub) ----------------

app.get(`${PREFIX}/zones/priority`, requireAuth, requireRole("authority", "admin"), (req, res) => {
  res.json({
    data: [
      { id: "z_1", name: "Ward 12 — Outer Ring Road belt", priority: "high", estimated_battery_saving_pct: 35 },
      { id: "z_2", name: "Ward 14 — Whitefield stretch", priority: "medium", estimated_battery_saving_pct: 22 },
    ],
    note: "Static stub for MVP demo — real endpoint will be backed by the RL routing model.",
  });
});

// ---------------- health check ----------------

app.get("/", (req, res) => {
  if (STATIC_DIR && fs.existsSync(path.join(STATIC_DIR, "index.html"))) {
    return res.sendFile(path.join(STATIC_DIR, "index.html"));
  }
  res.json({ status: "ok", message: "Sentriroad mock API running", prefix: PREFIX });
});

// Deploy mode: serve the built frontend + SPA fallback so /authority,
// /crew, /operator etc. resolve client-side. /api and /uploads keep
// hitting this same server.
if (STATIC_DIR && fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });
  console.log(`  Serving built frontend from ${STATIC_DIR}`);
}

app.listen(PORT, () => {
  console.log(`\n  Sentriroad mock API running → http://localhost:${PORT}${PREFIX}\n`);
  console.log(`  Sign in with any seeded account + password "123":`);
  console.log(`    citizen   → ravi@example.com        authority   → suresh.authority@bbmp.gov.in`);
  console.log(`    crew      → ramesh.crew@bbmp.gov.in drone op   → kavya.drone@bbmp.gov.in`);
  console.log(`    admin     → admin@sentriroad.app`);
  console.log(`  Role mismatch on sign-in is rejected (403 ROLE_MISMATCH).\n`);
});

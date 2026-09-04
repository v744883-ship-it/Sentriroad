const supabase = require("../config/supabaseClient");
const config = require("../config/env");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");
const { estimateCost } = require("../services/scoringService");

function toReportShape(row) {
  return {
    id: row.id,
    citizen_id: row.citizen_id,
    media_url: row.media_url,
    media_type: row.media_type,
    // gps.lat/lng can be null for drone reports (no single point at
    // creation time — see the nullable migration). Untouched/always
    // populated for citizen reports, exactly as before.
    gps: { lat: row.gps_lat, lng: row.gps_lng },
    address: row.address,
    description: row.description,
    status: row.status,
    source_type: row.source_type || "citizen",
    telemetry_url: row.telemetry_url || null,
    created_at: row.created_at,
  };
}

const createReport = asyncHandler(async (req, res) => {
  const { media_url, media_type, gps, address, description, source_type, telemetry_url } = req.body || {};

  const isDrone = source_type === "drone";

  if (!media_url || !media_type) {
    throw new ApiError(400, "VALIDATION_ERROR", "media_url and media_type are required");
  }
  if (isDrone) {
    if (!telemetry_url) {
      throw new ApiError(400, "VALIDATION_ERROR", "telemetry_url is required for drone submissions");
    }
  } else if (!gps || gps.lat === undefined || gps.lng === undefined) {
    // Unchanged from before: citizen submissions still always require gps.
    throw new ApiError(400, "VALIDATION_ERROR", "media_url, media_type, and gps {lat,lng} are required");
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({
      citizen_id: req.user.id,
      media_url,
      media_type,
      gps_lat: isDrone ? null : gps.lat,
      gps_lng: isDrone ? null : gps.lng,
      address: address || null,
      description: description || null,
      status: "reported",
      source_type: isDrone ? "drone" : "citizen",
      telemetry_url: isDrone ? telemetry_url : null,
    })
    .select("*")
    .single();

  if (error) throw error;

  // Fire-and-forget: kick off AI detection asynchronously so this
  // request returns immediately (see services/aiPipelineService.js).
  // Intentionally not awaited — do not block the citizen's upload
  // response on model inference time.
  require("../services/aiPipelineService").processReportAsync(data.id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[ai-pipeline] failed for report ${data.id}:`, err.message);
  });

  res.status(201).json(toReportShape(data));
});

const listReports = asyncHandler(async (req, res) => {
  let query = supabase.from("reports").select("*").order("created_at", { ascending: false });

  if (req.user.role === "citizen") {
    query = query.eq("citizen_id", req.user.id);
  } else if (req.user.role === "crew") {
    // Crew sees reports linked to their assigned work orders PLUS their
    // own drone-survey submissions (which store the crew member as
    // citizen_id = "submitted_by").
    const { data: myWorkOrders } = await supabase
      .from("work_orders")
      .select("report_id")
      .eq("assigned_crew_id", req.user.id);
    const { data: mySubmissions } = await supabase
      .from("reports")
      .select("id")
      .eq("citizen_id", req.user.id);
    const reportIds = [
      ...new Set([
        ...(myWorkOrders || []).map((w) => w.report_id),
        ...(mySubmissions || []).map((r) => r.id),
      ]),
    ];
    if (reportIds.length === 0) return res.json({ data: [], page: 1, page_size: 0, total: 0 });
    query = query.in("id", reportIds);
  } else if (req.user.role === "drone_operator") {
    query = query.eq("citizen_id", req.user.id);
  }
  // authority/admin: no filter, see all

  const { data, error } = await query;
  if (error) throw error;

  const shaped = data.map(toReportShape);
  res.json({ data: shaped, page: 1, page_size: shaped.length, total: shaped.length });
});

const getReport = asyncHandler(async (req, res) => {
  const { data: report, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");

  const canView = await userCanViewReport(req.user, report);
  if (!canView) throw new ApiError(403, "FORBIDDEN", "Not allowed to view this report");

  // IMPORTANT: a drone report can have MULTIPLE detections/work orders
  // (one per clustered pothole), while a citizen report always has at
  // most one. Supabase's .maybeSingle() throws if more than one row
  // comes back, so drone reports need the plain array fetch below —
  // this branch exists specifically to avoid that crash. The citizen
  // branch is byte-for-byte the same query/shape as before.
  if (report.source_type === "drone") {
    const { data: detections } = await supabase
      .from("detections")
      .select("*")
      .eq("report_id", report.id);

    const detectionIds = (detections || []).map((d) => d.id);
    let scores = [];
    if (detectionIds.length > 0) {
      const { data: scoreRows } = await supabase
        .from("scores")
        .select("*")
        .in("detection_id", detectionIds);
      scores = scoreRows || [];
    }

    const { data: workOrders } = await supabase
      .from("work_orders")
      .select("*")
      .eq("report_id", report.id);

    res.json({
      ...toReportShape(report),
      detections: detections || [],
      scores,
      work_orders: workOrders || [],
    });
    return;
  }

  const { data: detection } = await supabase
    .from("detections")
    .select("*")
    .eq("report_id", report.id)
    .maybeSingle();

  let score = null;
  if (detection) {
    const { data: scoreRow } = await supabase
      .from("scores")
      .select("*")
      .eq("detection_id", detection.id)
      .maybeSingle();
    score = scoreRow;
  }

  const { data: workOrder } = await supabase
    .from("work_orders")
    .select("*")
    .eq("report_id", report.id)
    .maybeSingle();

  res.json({ ...toReportShape(report), detection, score, work_order: workOrder });
});

const getReportStatus = asyncHandler(async (req, res) => {
  const { data: report, error } = await supabase
    .from("reports")
    .select("id, status, citizen_id, updated_at")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");
  const canView = await userCanViewReport(req.user, report);
  if (!canView) throw new ApiError(403, "FORBIDDEN", "Not allowed to view this report");

  res.json({ id: report.id, status: report.status, updated_at: report.updated_at });
});

const submitFeedback = asyncHandler(async (req, res) => {
  const { data: report, error } = await supabase
    .from("reports")
    .select("id, citizen_id, status")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");
  if (report.citizen_id !== req.user.id) throw new ApiError(403, "FORBIDDEN", "Not your report");
  if (report.status !== "verified") {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", "Feedback only allowed once status is 'verified'");
  }

  const { rating, comment } = req.body || {};
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, "VALIDATION_ERROR", "rating must be an integer 1-5");
  }

  const { data: entry, error: insertError } = await supabase
    .from("feedback")
    .insert({ report_id: report.id, citizen_id: req.user.id, rating, comment: comment || null })
    .select("*")
    .single();

  if (insertError) throw insertError;
  res.status(201).json(entry);
});

async function userCanViewReport(user, report) {
  if (user.role === "authority" || user.role === "admin") return true;
  if (user.role === "citizen") return report.citizen_id === user.id;
  // Drone operators can only see their own aerial-survey submissions
  // (stored with the operator as citizen_id = "submitted_by").
  if (user.role === "drone_operator") return report.citizen_id === user.id;
  if (user.role === "crew") {
    const { data } = await supabase
      .from("work_orders")
      .select("id")
      .eq("report_id", report.id)
      .eq("assigned_crew_id", user.id)
      .maybeSingle();
    return !!data;
  }
  return false;
}

/**
 * Authority visibility: returns the citizen feedback posted against a
 * report (ratings + comments). Anyone who can view the report can read
 * its feedback — that is authority/admin (oversight) and the owning
 * citizen (their own history).
 */
/**
 * Authority shortcut: assign a crew member straight from a NEW citizen
 * report (the dashboard's "New Citizen Reports" list). If the AI
 * pipeline hasn't produced a work order yet, one is created on the fly
 * (with placeholder detection/score rows — the work_order.score_id FK
 * is NOT NULL) and the report jumps straight to assigned_to_crew.
 * If a work order already exists, this delegates to the same rules as
 * PATCH /workorders/:id/assign-crew.
 */
const assignCrewToReport = asyncHandler(async (req, res) => {
  const { crew_id } = req.body || {};
  if (!crew_id) throw new ApiError(400, "VALIDATION_ERROR", "crew_id is required");

  const { data: report, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");

  // Drone reports can have MANY work orders (one per clustered pothole)
  // and no single GPS point — assigning a crew "to the report" is
  // ambiguous. Crews are assigned from the generated work orders
  // instead (standard /workorders/:id/assign-crew flow).
  if (report.source_type === "drone") {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Drone reports are scored per-detection; assign crews from their generated work orders instead"
    );
  }

  const { data: crewUser, error: crewErr } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", crew_id)
    .maybeSingle();
  if (crewErr) throw crewErr;
  if (!crewUser || crewUser.role !== "crew") {
    throw new ApiError(400, "VALIDATION_ERROR", "crew_id does not match a crew user");
  }

  const { data: existing } = await supabase
    .from("work_orders")
    .select("*")
    .eq("report_id", report.id)
    .maybeSingle();

  let wo;
  if (existing) {
    if (!["scored", "dispatched"].includes(existing.status)) {
      throw new ApiError(
        409,
        "INVALID_STATE_TRANSITION",
        `Cannot assign crew from work-order status '${existing.status}'`
      );
    }
    wo = existing;
  } else {
    // AI pipeline hasn't scored this report yet — mint a manual work
    // order so the authority can expedite it. Confidence 0 + mid-range
    // factors flag it as authority-created rather than AI-scored.
    const damageType = "pothole";
    const urgencyScore = 50;

    const { data: detection, error: detErr } = await supabase
      .from("detections")
      .insert({
        report_id: report.id,
        damage_type: damageType,
        confidence: 0,
        evidence_image_url: report.media_url,
      })
      .select("*")
      .single();
    if (detErr) throw detErr;

    const { data: score, error: scoreErr } = await supabase
      .from("scores")
      .insert({
        detection_id: detection.id,
        urgency_score: urgencyScore,
        factor_severity: 50,
        factor_traffic_volume: 50,
        factor_accident_risk: 50,
        factor_road_category: 50,
        factor_time_since_detection: 50,
      })
      .select("*")
      .single();
    if (scoreErr) throw scoreErr;

    const { data: created, error: woErr } = await supabase
      .from("work_orders")
      .insert({
        report_id: report.id,
        score_id: score.id,
        address: report.address || "Address not provided",
        gps_lat: report.gps_lat,
        gps_lng: report.gps_lng,
        evidence_image_url: report.media_url,
        damage_type: damageType,
        urgency_score: urgencyScore,
        cost_estimate: estimateCost(damageType, urgencyScore),
        sla_deadline: new Date(Date.now() + config.slaHoursDefault * 60 * 60 * 1000).toISOString(),
        status: "scored",
      })
      .select("*")
      .single();
    if (woErr) throw woErr;
    wo = created;
  }

  const { data: updated, error: updErr } = await supabase
    .from("work_orders")
    .update({
      assigned_crew_id: crew_id,
      status: "assigned_to_crew",
      updated_at: new Date().toISOString(),
    })
    .eq("id", wo.id)
    .select("*")
    .single();
  if (updErr) throw updErr;

  await supabase
    .from("reports")
    .update({ status: "assigned_to_crew", updated_at: new Date().toISOString() })
    .eq("id", report.id);

  // Same shape the work-order endpoints return, so the frontend can
  // render it with the existing WorkOrder UI helpers.
  res.json({
    id: updated.id,
    report_id: updated.report_id,
    score_id: updated.score_id,
    location: { address: updated.address, gps: { lat: updated.gps_lat, lng: updated.gps_lng } },
    evidence_image_url: updated.evidence_image_url,
    damage_type: updated.damage_type,
    urgency_score: updated.urgency_score,
    cost_estimate: updated.cost_estimate,
    sla_deadline: updated.sla_deadline,
    status: updated.status,
    assigned_crew_id: updated.assigned_crew_id,
    crew_submitted_at: updated.crew_submitted_at,
    crew_photo_url: updated.crew_photo_url,
    review_status: updated.review_status,
    reviewed_by: updated.reviewed_by,
    reviewed_at: updated.reviewed_at,
    rejection_reason: updated.rejection_reason,
    pdf_url: updated.pdf_url,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
  });
});

const getReportFeedback = asyncHandler(async (req, res) => {
  const { data: report, error } = await supabase
    .from("reports")
    .select("id, citizen_id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");

  const canView = await userCanViewReport(req.user, report);
  if (!canView) throw new ApiError(403, "FORBIDDEN", "Not allowed to view this report");

  const { data, error: fbError } = await supabase
    .from("feedback")
    .select("id, report_id, citizen_id, rating, comment, created_at")
    .eq("report_id", report.id)
    .order("created_at", { ascending: false });

  if (fbError) throw fbError;
  res.json({ data: data || [] });
});

module.exports = {
  createReport,
  listReports,
  getReport,
  getReportStatus,
  submitFeedback,
  getReportFeedback,
  assignCrewToReport,
};

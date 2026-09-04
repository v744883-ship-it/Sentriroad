const supabase = require("../config/supabaseClient");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");

function toWorkOrderShape(row) {
  return {
    id: row.id,
    report_id: row.report_id,
    score_id: row.score_id,
    location: { address: row.address, gps: { lat: row.gps_lat, lng: row.gps_lng } },
    evidence_image_url: row.evidence_image_url,
    damage_type: row.damage_type,
    urgency_score: row.urgency_score,
    cost_estimate: row.cost_estimate,
    sla_deadline: row.sla_deadline,
    status: row.status,
    assigned_crew_id: row.assigned_crew_id,
    crew_submitted_at: row.crew_submitted_at,
    crew_photo_url: row.crew_photo_url,
    review_status: row.review_status,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    rejection_reason: row.rejection_reason,
    pdf_url: row.pdf_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const listWorkOrders = asyncHandler(async (req, res) => {
  if (req.user.role === "citizen") {
    throw new ApiError(403, "FORBIDDEN", "Citizens should use /reports, not /workorders");
  }

  let query = supabase.from("work_orders").select("*");

  if (req.user.role === "crew") {
    query = query.eq("assigned_crew_id", req.user.id);
  }
  if (req.query.status) query = query.eq("status", req.query.status);
  if (req.query.overdue === "true") {
    query = query.lt("sla_deadline", new Date().toISOString()).neq("status", "verified");
  }
  if (req.query.sort === "urgency") {
    query = query.order("urgency_score", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  const shaped = data.map(toWorkOrderShape);
  res.json({ data: shaped, page: 1, page_size: shaped.length, total: shaped.length });
});

const getWorkOrder = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("work_orders").select("*").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "Work order not found");
  res.json(toWorkOrderShape(data));
});

const getWorkOrderPdf = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("work_orders").select("pdf_url").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "Work order not found");
  if (!data.pdf_url) throw new ApiError(404, "NOT_FOUND", "PDF not generated yet for this work order");
  res.json({ pdf_url: data.pdf_url });
});

const dispatchWorkOrder = asyncHandler(async (req, res) => {
  const wo = await fetchWorkOrderOr404(req.params.id);
  if (wo.status !== "scored") {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", `Cannot dispatch from status '${wo.status}'`);
  }
  const updated = await updateWorkOrder(wo.id, { status: "dispatched" });
  res.json(toWorkOrderShape(updated));
});

const assignCrew = asyncHandler(async (req, res) => {
  const wo = await fetchWorkOrderOr404(req.params.id);
  if (!["scored", "dispatched"].includes(wo.status)) {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", `Cannot assign crew from status '${wo.status}'`);
  }
  const { crew_id } = req.body || {};
  if (!crew_id) throw new ApiError(400, "VALIDATION_ERROR", "crew_id is required");

  const { data: crewUser } = await supabase.from("users").select("id, role").eq("id", crew_id).maybeSingle();
  if (!crewUser || crewUser.role !== "crew") {
    throw new ApiError(400, "VALIDATION_ERROR", "crew_id does not match a valid crew user");
  }

  const updated = await updateWorkOrder(wo.id, { assigned_crew_id: crew_id, status: "assigned_to_crew" });
  res.json(toWorkOrderShape(updated));
});

const submitRepair = asyncHandler(async (req, res) => {
  const wo = await fetchWorkOrderOr404(req.params.id);
  if (wo.assigned_crew_id !== req.user.id) {
    throw new ApiError(403, "FORBIDDEN", "This work order is not assigned to you");
  }
  if (wo.status !== "assigned_to_crew") {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", `Cannot submit repair from status '${wo.status}'`);
  }
  const { after_photo_url, notes } = req.body || {};
  if (!after_photo_url) throw new ApiError(400, "VALIDATION_ERROR", "after_photo_url is required");

  const updated = await updateWorkOrder(wo.id, {
    crew_photo_url: after_photo_url,
    crew_notes: notes || null,
    crew_submitted_at: new Date().toISOString(),
    review_status: "pending",
    status: "crew_submitted",
  });
  res.json(toWorkOrderShape(updated));
});

const reviewWorkOrder = asyncHandler(async (req, res) => {
  const wo = await fetchWorkOrderOr404(req.params.id);
  if (!["crew_submitted", "reviewing"].includes(wo.status)) {
    throw new ApiError(409, "INVALID_STATE_TRANSITION", `Cannot review from status '${wo.status}'`);
  }
  const { decision, rejection_reason } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    throw new ApiError(400, "VALIDATION_ERROR", "decision must be 'approved' or 'rejected'");
  }

  const baseUpdate = {
    reviewed_by: req.user.id,
    reviewed_at: new Date().toISOString(),
  };

  if (decision === "approved") {
    const updated = await updateWorkOrder(wo.id, {
      ...baseUpdate,
      review_status: "approved",
      status: "verified",
    });

    // Auto-create verification record + flip the report to verified,
    // mirroring the behavior we validated in the mock server.
    await supabase.from("verifications").insert({
      work_order_id: wo.id,
      before_image: wo.evidence_image_url,
      after_image: wo.crew_photo_url,
      verified_by: req.user.id,
    });
    await supabase
      .from("reports")
      .update({ status: "verified", updated_at: new Date().toISOString() })
      .eq("id", wo.report_id);

    res.json(toWorkOrderShape(updated));
  } else {
    if (!rejection_reason) {
      throw new ApiError(400, "VALIDATION_ERROR", "rejection_reason is required when rejecting");
    }
    const updated = await updateWorkOrder(wo.id, {
      ...baseUpdate,
      review_status: "rejected",
      rejection_reason: rejection_reason,
      status: "assigned_to_crew", // sent back to the same crew member to redo
      crew_photo_url: null,
      crew_submitted_at: null,
    });
    res.json(toWorkOrderShape(updated));
  }
});

const getVerification = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from("verifications")
    .select("*")
    .eq("work_order_id", req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "No verification yet for this work order");
  res.json(data);
});

// ---------- helpers ----------

async function fetchWorkOrderOr404(id) {
  const { data, error } = await supabase.from("work_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "Work order not found");
  return data;
}

async function updateWorkOrder(id, patch) {
  const { data, error } = await supabase
    .from("work_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  listWorkOrders,
  getWorkOrder,
  getWorkOrderPdf,
  dispatchWorkOrder,
  assignCrew,
  submitRepair,
  reviewWorkOrder,
  getVerification,
};

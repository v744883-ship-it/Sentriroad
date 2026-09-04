const supabase = require("../config/supabaseClient");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");

const getReportDetections = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from("detections").select("*").eq("report_id", req.params.id);
  if (error) throw error;
  res.json({ data });
});

const getReportScore = asyncHandler(async (req, res) => {
  // A drone report can have multiple detections, so .maybeSingle()
  // (which throws on >1 row) isn't safe here anymore — fetch as a
  // list and branch on count instead. Single-detection reports
  // (all citizen reports, always) get back the exact same shape as
  // before: one score object, not an array.
  const { data: detections } = await supabase
    .from("detections")
    .select("id")
    .eq("report_id", req.params.id);

  if (!detections || detections.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "No detection/score yet for this report");
  }

  const detectionIds = detections.map((d) => d.id);
  const { data: scores, error } = await supabase
    .from("scores")
    .select("*")
    .in("detection_id", detectionIds);
  if (error) throw error;

  if (detections.length === 1) {
    res.json((scores && scores[0]) || null);
  } else {
    res.json({ scores: scores || [] });
  }
});

module.exports = { getReportDetections, getReportScore };

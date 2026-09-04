const express = require("express");
const {
  createReport,
  listReports,
  getReport,
  getReportStatus,
  submitFeedback,
  getReportFeedback,
  assignCrewToReport,
} = require("../controllers/reports.controller");
const { getReportDetections, getReportScore } = require("../controllers/detections.controller");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Drone operators and crew (drone-survey dashboard) submit through the
// same endpoint as citizens — createReport branches internally on
// body.source_type. Citizen-only behavior (the else branch inside
// createReport) is unchanged.
router.post("/", requireAuth, requireRole("citizen", "drone_operator", "crew"), createReport);
router.get("/", requireAuth, listReports);
router.get("/:id", requireAuth, getReport);
router.get("/:id/status", requireAuth, getReportStatus);
router.get("/:id/feedback", requireAuth, getReportFeedback);
router.post("/:id/feedback", requireAuth, requireRole("citizen"), submitFeedback);
router.get("/:id/detections", requireAuth, getReportDetections);
router.get("/:id/score", requireAuth, getReportScore);
// Authority shortcut: assign a crew straight from a new citizen report
// (creates the work order on the fly if the AI pipeline hasn't yet).
router.post("/:id/assign-crew", requireAuth, requireRole("authority", "admin"), assignCrewToReport);

module.exports = router;

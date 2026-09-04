const express = require("express");
const { getMetricsSummary } = require("../controllers/metrics.controller");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/summary", requireAuth, requireRole("authority", "admin"), getMetricsSummary);

module.exports = router;

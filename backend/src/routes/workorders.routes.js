const express = require("express");
const {
  listWorkOrders,
  getWorkOrder,
  getWorkOrderPdf,
  dispatchWorkOrder,
  assignCrew,
  submitRepair,
  reviewWorkOrder,
  getVerification,
} = require("../controllers/workorders.controller");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, listWorkOrders);
router.get("/:id", requireAuth, getWorkOrder);
router.get("/:id/pdf", requireAuth, requireRole("authority", "admin"), getWorkOrderPdf);
router.patch("/:id/dispatch", requireAuth, requireRole("authority", "admin"), dispatchWorkOrder);
router.patch("/:id/assign-crew", requireAuth, requireRole("authority", "admin"), assignCrew);
router.post("/:id/submit-repair", requireAuth, requireRole("crew"), submitRepair);
router.patch("/:id/review", requireAuth, requireRole("authority", "admin"), reviewWorkOrder);
router.get("/:id/verification", requireAuth, getVerification);

module.exports = router;

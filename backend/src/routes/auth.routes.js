const express = require("express");
const { signup, login, me, listUsersByRole } = require("../controllers/auth.controller");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", requireAuth, me);

// Authority/admin only: used to populate the "Assign Crew" dropdown.
router.get("/users", requireAuth, requireRole("authority", "admin"), listUsersByRole);

module.exports = router;

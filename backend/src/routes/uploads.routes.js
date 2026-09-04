const express = require("express");
const { getSignedUploadUrl } = require("../controllers/uploads.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/signed-url", requireAuth, getSignedUploadUrl);

module.exports = router;

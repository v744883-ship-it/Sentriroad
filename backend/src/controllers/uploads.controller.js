const { createSignedUploadUrl } = require("../services/storageService");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");

const getSignedUploadUrl = asyncHandler(async (req, res) => {
  const { filename, content_type } = req.body || {};
  if (!filename || !content_type) {
    throw new ApiError(400, "VALIDATION_ERROR", "filename and content_type are required");
  }

  // file_type is optional and purely a naming/organization hint —
  // createSignedUploadUrl's behavior is otherwise identical for every
  // caller. Existing citizen callers that don't send it are unaffected.
  const { file_type } = req.body || {};
  const result = await createSignedUploadUrl(req.user.id, filename, file_type);
  res.json(result);
});

module.exports = { getSignedUploadUrl };

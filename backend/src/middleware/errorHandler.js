const { ApiError } = require("../utils/asyncHandler");

// Must be registered LAST in server.js, after all routes.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  // Supabase/Postgres errors and anything unexpected
  // eslint-disable-next-line no-console
  console.error("[unhandled error]", err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Check server logs." },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route: ${req.method} ${req.path}` } });
}

module.exports = { errorHandler, notFoundHandler };

// Wraps an async route handler so thrown errors / rejected promises
// reach Express's error middleware instead of crashing the process
// or hanging the request.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// A structured error we can throw from anywhere and have the central
// error middleware turn into the standard { error: { code, message } }
// envelope documented in API_SPEC.md.
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { asyncHandler, ApiError };

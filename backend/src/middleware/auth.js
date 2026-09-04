const { verifyToken } = require("../utils/jwt");
const { ApiError } = require("../utils/asyncHandler");
const supabase = require("../config/supabaseClient");

/**
 * Verifies the Authorization: Bearer <token> header, then loads the
 * full user record fresh from the DB and attaches it to req.user.
 * We re-fetch from DB (rather than trusting the token payload alone)
 * so a role change or account deactivation takes effect immediately.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token");

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, phone, role, created_at")
      .eq("id", payload.sub)
      .single();

    if (error || !user) throw new ApiError(401, "UNAUTHORIZED", "User no longer exists");

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Usage: router.patch('/x', requireAuth, requireRole('authority', 'admin'), handler)
 * Must run AFTER requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "FORBIDDEN", `Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

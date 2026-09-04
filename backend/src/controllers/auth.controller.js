const supabase = require("../config/supabaseClient");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");

const signup = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone } = req.body || {};
  if (!name || !email || !password || !role) {
    throw new ApiError(400, "VALIDATION_ERROR", "name, email, password, and role are required");
  }
  if (role !== "citizen") {
    // Role separation: only citizens self-register. Authority, crew,
    // admin, and drone_operator accounts are provisioned by the
    // municipal team (see scripts/seed.js), so no one can sign up as a
    // role they don't legitimately hold.
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Public sign-up is for citizens only. Authority, crew, and operator accounts are provisioned by the municipality."
    );
  }

  const { data: existing } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) throw new ApiError(409, "VALIDATION_ERROR", "An account with this email already exists");

  const password_hash = await hashPassword(password);

  const { data: user, error } = await supabase
    .from("users")
    .insert({ name, email, phone: phone || null, password_hash, role })
    .select("id, name, email, phone, role, created_at")
    .single();

  if (error) throw error;

  const token = signToken(user);
  res.status(201).json({ token, user });
});

const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    throw new ApiError(400, "VALIDATION_ERROR", "email and password are required");
  }

  const { data: user, error } = await supabase
    .from("users")
    .select("id, name, email, phone, role, password_hash, created_at")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  if (!user) throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password");

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password");

  // Role-first login: the frontend asks which portal the user is signing
  // in to, and this backend enforces it — a citizen account can never
  // receive a token for the authority/crew portal (or vice versa). This
  // is the server-side guarantee behind the login UI's role selector.
  if (role) {
    if (!["citizen", "authority", "crew", "admin", "drone_operator"].includes(role)) {
      throw new ApiError(400, "VALIDATION_ERROR", "role must be one of citizen, authority, crew, admin, drone_operator");
    }
    if (user.role !== role) {
      throw new ApiError(
        403,
        "ROLE_MISMATCH",
        `This account is registered as "${user.role}". Use the ${user.role} portal to sign in.`
      );
    }
  }

  const { password_hash, ...safeUser } = user;
  const token = signToken(safeUser);
  res.json({ token, user: safeUser });
});

const me = asyncHandler(async (req, res) => {
  res.json(req.user);
});

/**
 * Authority/admin only: list users (used to populate the "Assign Crew"
 * dropdown). Optional ?role= filter. Never returns password hashes.
 */
const listUsersByRole = asyncHandler(async (req, res) => {
  let query = supabase.from("users").select("id, name, email, phone, role, created_at");
  if (req.query.role) query = query.eq("role", req.query.role);
  query = query.order("name");

  const { data, error } = await query;
  if (error) throw error;
  res.json({ data: data || [] });
});

module.exports = { signup, login, me, listUsersByRole };

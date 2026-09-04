const { createClient } = require("@supabase/supabase-js");
const config = require("./env");

/**
 * This client uses the SERVICE ROLE key, which bypasses Row Level
 * Security entirely. That's intentional — access control is enforced
 * in our own middleware (see src/middleware/auth.js), not by Supabase.
 *
 * NEVER expose this client or this key to the frontend. The frontend
 * should only ever use the publishable/anon key, and only for direct
 * file uploads (see src/controllers/uploads.controller.js for how the
 * backend issues a signed URL instead of proxying files itself).
 */
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

module.exports = supabase;

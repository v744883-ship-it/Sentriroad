require("dotenv").config();

function required(name, fallback = undefined) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[config] WARNING: env var ${name} is not set. The server will start, but calls needing it will fail.`);
  }
  return val;
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "evidence-uploads",

  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  aiServiceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",

  slaHoursDefault: Number(process.env.SLA_HOURS_DEFAULT || 48),
};

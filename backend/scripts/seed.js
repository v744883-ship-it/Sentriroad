/**
 * Seeds demo users (and a couple of sample reports) into your Supabase
 * project so you have something to log in as and look at immediately.
 *
 * Run AFTER creating the schema (sql/schema.sql) and setting up .env:
 *   npm run seed
 */
require("dotenv").config();
const supabase = require("../src/config/supabaseClient");
const { hashPassword } = require("../src/utils/password");

const DEMO_PASSWORD = "123";

const DEMO_USERS = [
  { name: "Ravi Kumar", email: "ravi@example.com", phone: "+919900011122", role: "citizen" },
  { name: "Anjali Rao", email: "anjali@example.com", phone: "+919900033344", role: "citizen" },
  { name: "Suresh Patil (Authority)", email: "suresh.authority@bbmp.gov.in", phone: "+919900055566", role: "authority" },
  { name: "Ramesh (Crew Lead)", email: "ramesh.crew@bbmp.gov.in", phone: "+919900077788", role: "crew" },
  { name: "Manjunath (Crew)", email: "manju.crew@bbmp.gov.in", phone: "+919900099900", role: "crew" },
  { name: "Kavya Nair (Drone Pilot)", email: "kavya.drone@bbmp.gov.in", phone: "+919900011199", role: "drone_operator" },
];

async function seed() {
  console.log("Seeding demo users (password for all: '123')...\n");

  const password_hash = await hashPassword(DEMO_PASSWORD);

  for (const u of DEMO_USERS) {
    const { data: existing } = await supabase.from("users").select("id").eq("email", u.email).maybeSingle();
    if (existing) {
      console.log(`  - ${u.email} already exists, skipping`);
      continue;
    }
    const { error } = await supabase.from("users").insert({ ...u, password_hash });
    if (error) {
      console.error(`  - FAILED to insert ${u.email}:`, error.message);
    } else {
      console.log(`  - created ${u.email} (${u.role})`);
    }
  }

  console.log("\nDone. Log in with any of the emails above and password '123'.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});

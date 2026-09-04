-- ============================================================
-- SENTRIROAD — SUPABASE SCHEMA (project: pot-detect)
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run.
-- This creates every table the backend needs. Safe to re-run
-- (uses IF NOT EXISTS) except for enum types, which will error
-- harmlessly if they already exist — ignore that specific error
-- on re-run.
-- ============================================================

-- ---------- ENUM TYPES ----------

do $$ begin
  create type user_role as enum ('citizen', 'authority', 'crew', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type damage_type as enum ('pothole', 'crack');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_type as enum ('photo', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_order_status as enum (
    'reported', 'scored', 'dispatched', 'assigned_to_crew',
    'crew_submitted', 'reviewing', 'repaired', 'verified' , 'review_needed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------- USERS ----------
-- NOTE: this is our OWN users table (basic auth, not Supabase Auth).
-- We store a bcrypt password hash here and issue our own JWTs.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  password_hash text not null,
  role user_role not null default 'citizen',
  created_at timestamptz not null default now()
);

-- ---------- REPORTS ----------

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references users(id) on delete cascade,
  media_url text not null,
  media_type media_type not null,
  gps_lat double precision not null,
  gps_lng double precision not null,
  address text,
  description text,
  status work_order_status not null default 'reported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reports_citizen on reports(citizen_id);
create index if not exists idx_reports_status on reports(status);

-- ---------- DETECTIONS ----------

create table if not exists detections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  damage_type damage_type not null,
  confidence double precision not null,
  bbox_x double precision,
  bbox_y double precision,
  bbox_w double precision,
  bbox_h double precision,
  evidence_image_url text not null,
  frame_timestamp_seconds double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_detections_report on detections(report_id);

-- ---------- SCORES ----------

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  detection_id uuid not null references detections(id) on delete cascade,
  urgency_score int not null check (urgency_score >= 0 and urgency_score <= 100),
  factor_severity int not null,
  factor_traffic_volume int not null,
  factor_accident_risk int not null,
  factor_road_category int not null,
  factor_time_since_detection int not null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_scores_detection on scores(detection_id);
create index if not exists idx_scores_urgency on scores(urgency_score desc);

-- ---------- WORK ORDERS ----------

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  score_id uuid not null references scores(id) on delete cascade,

  address text not null,
  gps_lat double precision not null,
  gps_lng double precision not null,
  evidence_image_url text not null,
  damage_type damage_type not null,
  urgency_score int not null,
  cost_estimate numeric(10, 2) not null,
  sla_deadline timestamptz not null,
  status work_order_status not null default 'scored',

  assigned_crew_id uuid references users(id),
  crew_submitted_at timestamptz,
  crew_photo_url text,
  crew_notes text,

  review_status review_status,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,

  pdf_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workorders_status on work_orders(status);
create index if not exists idx_workorders_crew on work_orders(assigned_crew_id);
create index if not exists idx_workorders_urgency on work_orders(urgency_score desc);
create index if not exists idx_workorders_report on work_orders(report_id);

-- ---------- VERIFICATIONS ----------

create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  before_image text not null,
  after_image text not null,
  verified_by uuid not null references users(id),
  verified_at timestamptz not null default now()
);

create index if not exists idx_verifications_workorder on verifications(work_order_id);

-- ---------- FEEDBACK ----------

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  citizen_id uuid not null references users(id),
  rating int not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_report on feedback(report_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- The backend connects using the SERVICE ROLE key, which bypasses
-- RLS entirely — all access control (who can see/edit what) is
-- enforced in our Express middleware, not in the database.
--
-- We still enable RLS on every table with NO permissive policies,
-- so that if the anon/publishable key is ever used directly against
-- these tables (e.g. by mistake from the frontend), it is blocked
-- by default rather than exposing data.
-- ============================================================

alter table users enable row level security;
alter table reports enable row level security;
alter table detections enable row level security;
alter table scores enable row level security;
alter table work_orders enable row level security;
alter table verifications enable row level security;
alter table feedback enable row level security;

-- (No policies created = no access via anon/publishable key. This is
-- intentional. Only the service-role-key-based backend can read/write.)

-- ============================================================
-- SEED DATA
-- ============================================================
-- This file only creates schema, deliberately. Demo users need a
-- real bcrypt hash, which SQL can't generate — run this instead,
-- after `npm install`, from the backend/ folder:
--
--   npm run seed
--
-- That script (scripts/seed.js) inserts the same demo accounts used
-- in the earlier mock-server package (ravi@example.com,
-- suresh.authority@bbmp.gov.in, ramesh.crew@bbmp.gov.in, etc.), all
-- with the password "password123", properly hashed.
-- ============================================================

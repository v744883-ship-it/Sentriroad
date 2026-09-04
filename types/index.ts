/**
 * SENTRIROAD — SHARED TYPE CONTRACT
 * ----------------------------------
 * These are the exact shapes the real backend will return.
 * Frontend devs: import these into your React project now and build
 * against them. When the real backend replaces the mock server, these
 * types do not change — only the data source does.
 */

// ---------- ENUMS ----------

export type UserRole = "citizen" | "authority" | "crew" | "admin";

export type DamageType = "pothole" | "crack";

export type MediaType = "photo" | "video";

/**
 * The full lifecycle of a single reported issue, in order.
 * A WorkOrder's `status` field will always be one of these.
 */
export type WorkOrderStatus =
  | "reported"          // citizen just submitted, no AI processing yet
  | "scored"             // AI detection + urgency score computed
  | "dispatched"         // authority has seen it, not yet assigned to a crew
  | "assigned_to_crew"   // authority assigned a specific crew member
  | "crew_submitted"     // crew uploaded an after-repair photo, awaiting review
  | "reviewing"          // authority is actively reviewing crew submission
  | "rejected_by_crew_review" // authority rejected crew's submission, sent back
  | "repaired"           // authority approved the repair
  | "verified";          // final state — citizen has been notified

export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

// ---------- CORE ENTITIES ----------

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  created_at: string; // ISO 8601
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Report {
  id: string;
  citizen_id: string;
  media_url: string;
  media_type: MediaType;
  gps: GeoPoint;
  address?: string;
  description?: string;
  status: WorkOrderStatus;
  created_at: string;
}

export interface Detection {
  id: string;
  report_id: string;
  damage_type: DamageType;
  confidence: number; // 0-1
  bounding_box: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  evidence_image_url: string;
  frame_timestamp_seconds?: number; // set only when source was a video
  created_at: string;
}

export interface ScoreFactors {
  severity: number;          // 0-100
  traffic_volume: number;    // 0-100
  accident_risk: number;     // 0-100
  road_category: number;     // 0-100
  time_since_detection: number; // 0-100
}

export interface Score {
  id: string;
  detection_id: string;
  urgency_score: number; // 0-100 composite
  factor_breakdown: ScoreFactors;
  computed_at: string;
}

export interface WorkOrder {
  id: string;
  report_id: string;
  score_id: string;
  location: {
    address: string;
    gps: GeoPoint;
  };
  evidence_image_url: string;
  damage_type: DamageType;
  urgency_score: number;
  cost_estimate: number; // in INR
  sla_deadline: string; // ISO 8601
  status: WorkOrderStatus;

  assigned_crew_id?: string;
  crew_submitted_at?: string;
  crew_photo_url?: string;

  review_status?: "pending" | "approved" | "rejected";
  reviewed_by?: string; // authority user id
  reviewed_at?: string;
  rejection_reason?: string;

  pdf_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Verification {
  id: string;
  work_order_id: string;
  before_image: string;
  after_image: string;
  verified_by: string; // authority user id
  verified_at: string;
}

export interface Feedback {
  id: string;
  report_id: string;
  citizen_id: string;
  rating: FeedbackRating;
  comment?: string;
  created_at: string;
}

export interface MetricsSummary {
  cost_avoided_inr: number;
  riders_protected_monthly: number;
  percent_repairs_verified: number;
  open_issues: number;
  overdue_sla_count: number;
}

// ---------- AUTH ----------

export interface AuthUser extends User {}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ---------- API REQUEST BODIES ----------

export interface CreateReportRequest {
  media_url: string;
  media_type: MediaType;
  gps: GeoPoint;
  address?: string;
  description?: string;
}

export interface SignedUploadRequest {
  filename: string;
  content_type: string; // e.g. "video/mp4", "image/jpeg"
}

export interface SignedUploadResponse {
  upload_url: string;
  file_path: string;
  public_url_after_upload: string;
  expires_at: string;
}

export interface AssignCrewRequest {
  crew_id: string;
}

export interface SubmitRepairRequest {
  after_photo_url: string;
  notes?: string;
}

export interface ReviewRequest {
  decision: "approved" | "rejected";
  rejection_reason?: string; // required if decision === "rejected"
}

export interface SubmitFeedbackRequest {
  rating: FeedbackRating;
  comment?: string;
}

// ---------- STANDARD API ENVELOPE ----------

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

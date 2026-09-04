/**
 * SENTRIROAD — SHARED TYPE CONTRACT
 * ----------------------------------
 * These are the exact shapes the real backend returns.
 */

// ---------- ENUMS ----------

export type UserRole = "citizen" | "authority" | "crew" | "admin" | "drone_operator";

export type DamageType = "pothole" | "crack";

export type MediaType = "photo" | "video";

/**
 * The full lifecycle of a single reported issue, in order.
 * A WorkOrder's `status` field will always be one of these.
 */
export type WorkOrderStatus =
  | "reported"
  | "scored"
  | "dispatched"
  | "assigned_to_crew"
  | "crew_submitted"
  | "reviewing"
  | "repaired"
  | "verified"
  | "review_needed";

export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

// ---------- CORE ENTITIES ----------

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  created_at: string;
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
  source_type?: "citizen" | "drone";
  created_at: string;
}

export interface Detection {
  id: string;
  report_id: string;
  damage_type: DamageType;
  confidence: number;
  bbox_x?: number;
  bbox_y?: number;
  bbox_w?: number;
  bbox_h?: number;
  bounding_box?: [number, number, number, number];
  evidence_image_url: string;
  frame_timestamp_seconds?: number;
  gps_lat?: number;
  gps_lng?: number;
  created_at: string;
}

export interface Score {
  id: string;
  detection_id: string;
  urgency_score: number;
  factor_severity?: number;
  factor_traffic_volume?: number;
  factor_accident_risk?: number;
  factor_road_category?: number;
  factor_time_since_detection?: number;
  factor_breakdown?: {
    severity: number;
    traffic_volume: number;
    accident_risk: number;
    road_category: number;
    time_since_detection: number;
  };
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
  cost_estimate: number;
  sla_deadline: string;
  status: WorkOrderStatus;
  assigned_crew_id?: string;
  crew_submitted_at?: string;
  crew_photo_url?: string;
  crew_notes?: string;
  review_status?: "pending" | "approved" | "rejected" | null;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  pdf_url?: string;
  created_at: string;
  updated_at: string;
  report?: Report;
  score?: Score;
}

export interface Verification {
  id: string;
  work_order_id: string;
  before_image: string;
  after_image: string;
  verified_by: string;
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
  riders_protected_monthly: number | null;
  percent_repairs_verified: number;
  open_issues: number;
  overdue_sla_count: number;
}

// ---------- API RESPONSES ----------

export interface LoginResponse {
  token: string;
  user: User;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

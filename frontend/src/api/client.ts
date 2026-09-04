/**
 * Sentriroad API Client
 * All requests go through this single client. Base URL from env.
 *
 * Contract notes (see docs/API_SPEC.md):
 * - Login is ROLE-FIRST: send the role selected on the login screen and
 *   the backend rejects a mismatch (403 ROLE_MISMATCH) so a citizen can
 *   never receive a token for the authority/crew portal (or vice versa).
 * - File uploads use the signed-URL pattern: POST /uploads/signed-url,
 *   PUT the bytes straight to the returned upload_url, then store
 *   public_url_after_upload as media_url. Raw files never pass through
 *   the API server.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('sr_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Session expired or invalid — clear it and send the user back to
    // the login screen (skip when already there, e.g. a failed sign-in
    // attempt that must show its own error message).
    localStorage.removeItem('sr_token');
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body?.error?.message ||
      body?.message ||
      `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// --- Auth ---
/** Role-first login. `role` must match the account's registered role. */
export async function login(email: string, password: string, role: string) {
  return request<{ token: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, role }),
  });
}

/** Public sign-up is citizen-only (enforced server-side too). */
export async function signup(data: {
  name: string;
  email: string;
  password: string;
  role: string;
  phone?: string;
}) {
  return request<{ token: string; user: any }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMe() {
  return request<any>('/auth/me');
}

/** Authority/admin only: list users, optionally filtered by role. */
export async function getUsersByRole(role: string) {
  return request<{ data: any[] }>(`/auth/users?role=${encodeURIComponent(role)}`);
}

// --- Uploads (signed URL → direct PUT) ---
export interface UploadResult {
  url: string;
  file_path: string;
}

/**
 * Uploads a file using the direct-to-storage signed-URL flow that the
 * backend (and mock server) expect:
 *   1. POST /uploads/signed-url  → { upload_url, public_url_after_upload }
 *   2. PUT the raw bytes to upload_url
 *   3. media_url = public_url_after_upload
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const { upload_url, public_url_after_upload, file_path } = await request<{
    upload_url: string;
    public_url_after_upload: string;
    file_path: string;
    expires_at: string;
  }>('/uploads/signed-url', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream' }),
  });

  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });

  if (!put.ok) {
    throw new Error(`Upload to storage failed (${put.status})`);
  }

  return { url: public_url_after_upload, file_path };
}

// --- Reports ---
export async function getReports() {
  return request<{ data: any[]; total: number }>('/reports');
}

export async function getReport(id: string) {
  return request<any>(`/reports/${id}`);
}

export async function getReportStatus(id: string) {
  return request<{ id: string; status: string; updated_at: string }>(`/reports/${id}/status`);
}

export async function createReport(body: {
  media_url: string;
  media_type: string;
  /** Required for citizen submissions (drone reports have no single GPS point). */
  gps?: { lat: number; lng: number };
  address?: string;
  description?: string;
  /** "drone" routes the report into the drone AI pipeline instead of the citizen one. */
  source_type?: 'drone';
  /** Required when source_type === "drone". */
  telemetry_url?: string;
}) {
  return request<any>('/reports', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function submitFeedback(reportId: string, rating: number, comment?: string) {
  return request<any>(`/reports/${reportId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment }),
  });
}

/** Citizen feedback on a report — authority/admin use this for oversight. */
export async function getReportFeedback(reportId: string) {
  return request<{ data: any[] }>(`/reports/${reportId}/feedback`);
}

// --- Detections & Scores (id is a REPORT id) ---
export async function getDetections(reportId: string) {
  return request<{ data: any[] }>(`/reports/${reportId}/detections`);
}

export async function getScore(reportId: string) {
  return request<any>(`/reports/${reportId}/score`);
}

// --- Work Orders ---
export async function getWorkOrders(params?: { status?: string; sort?: string; overdue?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.overdue) qs.set('overdue', params.overdue);
  const query = qs.toString();
  return request<{ data: any[]; total: number }>(`/workorders${query ? '?' + query : ''}`);
}

export async function getWorkOrder(id: string) {
  return request<any>(`/workorders/${id}`);
}

export async function getWorkOrderPdf(id: string) {
  return request<{ pdf_url: string }>(`/workorders/${id}/pdf`);
}

export async function dispatchWorkOrder(id: string) {
  return request<any>(`/workorders/${id}/dispatch`, { method: 'PATCH' });
}

export async function assignCrew(workOrderId: string, crewId: string) {
  return request<any>(`/workorders/${workOrderId}/assign-crew`, {
    method: 'PATCH',
    body: JSON.stringify({ crew_id: crewId }),
  });
}

/**
 * Authority shortcut: assign a crew straight from a new citizen report.
 * If the AI pipeline hasn't produced a work order yet, the backend
 * creates one on the fly, then assigns the crew.
 */
export async function assignCrewToReport(reportId: string, crewId: string) {
  return request<any>(`/reports/${reportId}/assign-crew`, {
    method: 'POST',
    body: JSON.stringify({ crew_id: crewId }),
  });
}

export async function submitRepair(workOrderId: string, afterPhotoUrl: string, notes?: string) {
  return request<any>(`/workorders/${workOrderId}/submit-repair`, {
    method: 'POST',
    body: JSON.stringify({ after_photo_url: afterPhotoUrl, notes }),
  });
}

export async function reviewWorkOrder(workOrderId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
  return request<any>(`/workorders/${workOrderId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, rejection_reason: rejectionReason }),
  });
}

export async function getVerification(workOrderId: string) {
  return request<any>(`/workorders/${workOrderId}/verification`);
}

// --- Metrics ---
export async function getMetrics() {
  return request<{
    cost_avoided_inr: number;
    riders_protected_monthly: number | null;
    percent_repairs_verified: number;
    open_issues: number;
    overdue_sla_count: number;
  }>('/metrics/summary');
}

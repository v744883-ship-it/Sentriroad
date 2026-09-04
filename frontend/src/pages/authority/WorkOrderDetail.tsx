import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getWorkOrder,
  getDetections,
  getScore,
  dispatchWorkOrder,
  assignCrew,
  reviewWorkOrder,
  getUsersByRole,
} from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import IncidentMap from '../../components/IncidentMap';
import EvidenceImage from '../../components/EvidenceImage';
import CitizenFeedback from '../../components/CitizenFeedback';

/**
 * Score factor breakdown arrives in two shapes depending on the server:
 * - mock server:  score.factor_breakdown = { severity, traffic_volume, ... }
 * - real backend: flat columns    score.factor_severity, factor_traffic_volume, ...
 * This normalizes both.
 */
function factorBreakdown(score: any): Record<string, number> | null {
  if (!score) return null;
  if (score.factor_breakdown) {
    return Object.fromEntries(
      Object.entries(score.factor_breakdown).filter(([, v]) => typeof v === 'number')
    ) as Record<string, number>;
  }
  const flat: Record<string, number> = {
    severity: score.factor_severity,
    traffic_volume: score.factor_traffic_volume,
    accident_risk: score.factor_accident_risk,
    road_category: score.factor_road_category,
    time_since_detection: score.factor_time_since_detection,
  };
  const present = Object.fromEntries(Object.entries(flat).filter(([, v]) => typeof v === 'number'));
  return Object.keys(present).length ? (present as Record<string, number>) : null;
}

function urgencyColor(score: number): string {
  if (score >= 70) return 'text-red-600';
  if (score >= 40) return 'text-orange-500';
  return 'text-green-600';
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [wo, setWo] = useState<any>(null);
  const [detections, setDetections] = useState<any[]>([]);
  const [score, setScore] = useState<any>(null);
  const [crewList, setCrewList] = useState<any[]>([]);
  const [crewLoading, setCrewLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    if (!id) return;
    getWorkOrder(id).then(setWo).catch((e: any) => setError(e.message));
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getWorkOrder(id)
      .then((w) => {
        setWo(w);
        // Detections/score live on the REPORT, not the work order —
        // fetch them through the report so both backend & mock work.
        if (w?.report_id) {
          getDetections(w.report_id).then((d) => setDetections(d.data || [])).catch(() => setDetections([]));
          getScore(w.report_id).then(setScore).catch(() => setScore(null));
        }
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Crew members to assign from (authority/admin only endpoint)
  useEffect(() => {
    if (!id) return;
    setCrewLoading(true);
    getUsersByRole('crew')
      .then((c) => setCrewList(c.data || []))
      .catch(() => setCrewList([]))
      .finally(() => setCrewLoading(false));
  }, [id]);

  const factors = useMemo(() => factorBreakdown(score), [score]);

  const handleDispatch = async () => {
    if (!id) return;
    setActionLoading(true);
    setError('');
    try {
      await dispatchWorkOrder(id);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignCrew = async () => {
    if (!id || !selectedCrew) return;
    setActionLoading(true);
    setError('');
    try {
      await assignCrew(id, selectedCrew);
      setSelectedCrew('');
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReview = async (decision: 'approved' | 'rejected') => {
    if (!id) return;
    setActionLoading(true);
    setError('');
    try {
      await reviewWorkOrder(id, decision, decision === 'rejected' ? rejectionReason : undefined);
      setShowReject(false);
      setRejectionReason('');
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!wo) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Work order not found</p>
        <Link to="/authority/workorders" className="text-indigo-600 text-sm mt-2 inline-block">← Back to work orders</Link>
      </div>
    );
  }

  const isOverdue = new Date(wo.sla_deadline) < new Date() && wo.status !== 'verified';
  const location = wo.location || {};
  const assignedCrew = crewList.find((c) => c.id === wo.assigned_crew_id);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/authority/workorders" className="text-sm text-indigo-600 hover:text-indigo-800 mb-4 inline-block">
        ← Back to Work Orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{location.address || 'Unknown Location'}</h1>
          <p className="text-sm text-gray-500 mt-1">Work Order {wo.id} • Report {wo.report_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={wo.status} />
          {isOverdue && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">Overdue</span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-6">{error}</div>
      )}

      {/* Evidence + location */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <EvidenceImage
            src={wo.evidence_image_url}
            lat={location.gps?.lat}
            lng={location.gps?.lng}
            alt="Evidence"
            className="w-full h-56"
          />
          <div className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
📸 Incident evidence (photo, or live map of the location when no photo exists)
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">📍 Incident Location</h3>
          <IncidentMap
            center={location.gps}
            markerLabel={location.address || 'Incident Location'}
            className="h-44"
          />
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Damage Type" value={<span className="capitalize">{wo.damage_type || '—'}</span>} />
        <InfoCard
          label="Urgency Score"
          value={
            <span className={`font-bold ${urgencyColor(wo.urgency_score)}`}>
              {wo.urgency_score ?? '—'}{typeof wo.urgency_score === 'number' ? '/100' : ''}
            </span>
          }
        />
        <InfoCard label="Cost Estimate" value={wo.cost_estimate ? `₹${Number(wo.cost_estimate).toLocaleString('en-IN')}` : '—'} />
        <InfoCard
          label="SLA Deadline"
          value={
            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
              {wo.sla_deadline ? new Date(wo.sla_deadline).toLocaleDateString() : '—'}
            </span>
          }
        />
      </div>

      {/* AI Detection */}
      {detections.length > 0 &&
        detections.every((d) => Number(d.confidence) === 0) ? (
          <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/60 p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">🤖 AI Detection</h3>
            <p className="text-sm text-amber-800">
              ⚠️ Work order created directly by the authority from a new citizen report —
              AI detection/scoring has not run on this issue yet.
            </p>
          </div>
        ) : (
        detections.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">🤖 AI Detection</h3>
          {detections.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="capitalize font-medium">{d.damage_type}</span>
              <span className="text-gray-400">•</span>
              <span>Confidence: {(Math.round((d.confidence <= 1 ? d.confidence : d.confidence / 100) * 100))}%</span>
              {d.frame_timestamp_seconds != null && (
                <>
                  <span className="text-gray-400">•</span>
                  <span>Frame: {d.frame_timestamp_seconds}s</span>
                </>
              )}
            </div>
          ))}
          {factors && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">5-Factor Urgency Breakdown:</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {Object.entries(factors).map(([key, val]) => (
                  <div key={key} className="text-center bg-gray-50 rounded-lg py-2 px-1">
                    <div className={`text-sm font-bold ${urgencyColor(Number(val))}`}>{val}</div>
                    <div className="text-[10px] text-gray-400 capitalize leading-tight mt-0.5">
                      {key.replace(/_/g, ' ')}
                    </div>
                  </div>
                ))}
              </div>
              {typeof score?.urgency_score === 'number' && (
                <p className="text-xs text-gray-400 mt-2">
                  Composite urgency: <span className="font-semibold text-gray-600">{score.urgency_score}/100</span>
                </p>
              )}
            </div>
          )}
        </div>
        )
      )}

      {/* Crew status */}
      {wo.assigned_crew_id && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Assigned Crew</h3>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-lg">🧑‍🔧</div>
            <div>
              <p className="text-sm font-medium text-gray-900">{assignedCrew?.name || wo.assigned_crew_id}</p>
              {assignedCrew?.email && <p className="text-xs text-gray-400">{assignedCrew.email}</p>}
            </div>
          </div>
          {wo.crew_submitted_at && (
            <p className="text-xs text-gray-400 mt-2">Submitted: {new Date(wo.crew_submitted_at).toLocaleString()}</p>
          )}
          {wo.crew_photo_url && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1">After-repair photo</p>
              <EvidenceImage
                src={wo.crew_photo_url}
                lat={location.gps?.lat}
                lng={location.gps?.lng}
                alt="After repair"
                className="w-40 h-28 rounded-lg border border-gray-200"
              />
            </div>
          )}
          {wo.rejection_reason && (
            <div className="mt-3 p-2.5 bg-red-50 rounded-lg text-xs text-red-700">
              ⚠️ Rejected: {wo.rejection_reason}
            </div>
          )}
        </div>
      )}

      {/* Citizen Feedback (visible to authority once the resident rates a verified repair) */}
      <div className="mb-6">
        <CitizenFeedback reportId={wo.report_id} />
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Actions</h3>

        <div className="space-y-4">
          {/* Dispatch */}
          {wo.status === 'scored' && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                Step 1 — send this scored issue to the field queue, then assign a crew.
              </p>
              <button
                onClick={handleDispatch}
                disabled={actionLoading}
                className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Processing…' : '📋 Dispatch'}
              </button>
            </div>
          )}

          {/* Assign Crew */}
          {(wo.status === 'scored' || wo.status === 'dispatched') && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                Assign a crew member to carry out the repair.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedCrew}
                  onChange={(e) => setSelectedCrew(e.target.value)}
                  disabled={crewLoading || crewList.length === 0}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-w-52"
                >
                  <option value="">
                    {crewLoading ? 'Loading crews…' : crewList.length === 0 ? 'No crews provisioned' : 'Select crew…'}
                  </option>
                  {crewList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleAssignCrew}
                  disabled={!selectedCrew || actionLoading}
                  className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Assigning…' : '🔧 Assign Crew'}
                </button>
              </div>
            </div>
          )}

          {/* Review */}
          {(wo.status === 'crew_submitted' || wo.status === 'reviewing') && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                Crew submitted an after-repair photo. Review and verify the repair.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleReview('approved')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Processing…' : '✅ Approve & Verify'}
                </button>
                <button
                  onClick={() => setShowReject(!showReject)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200 disabled:opacity-50 transition-colors"
                >
                  ❌ Reject
                </button>
              </div>
            </div>
          )}

          {wo.status === 'verified' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
              ✅ Repair approved &amp; verified — the citizen's report is now closed.
            </div>
          )}
        </div>

        {/* Rejection form */}
        {showReject && (
          <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason</label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Describe what needs to be redone…"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none mb-2"
            />
            <button
              onClick={() => handleReview('rejected')}
              disabled={!rejectionReason.trim() || actionLoading}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Confirm Rejection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}

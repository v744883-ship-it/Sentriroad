import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReport, getUsersByRole, assignCrewToReport } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import IncidentMap from '../../components/IncidentMap';
import EvidenceImage from '../../components/EvidenceImage';
import CitizenFeedback from '../../components/CitizenFeedback';

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

export default function AuthorityReportDetail() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [crewList, setCrewList] = useState<any[]>([]);
  const [citizenNames, setCitizenNames] = useState<Record<string, string>>({});
  const [selectedCrew, setSelectedCrew] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      getReport(id).catch((e: any) => {
        setError(e.message);
        return null;
      }),
      getUsersByRole('crew').catch(() => ({ data: [] })),
      getUsersByRole('citizen').catch(() => ({ data: [] })),
    ]).then(([r, crews, citizens]) => {
      setReport(r);
      setCrewList(crews?.data || []);
      const names: Record<string, string> = {};
      for (const u of citizens?.data || []) names[u.id] = u.name;
      setCitizenNames(names);
    }).finally(() => setLoading(false));
  }, [id]);

  const factors = useMemo(() => factorBreakdown(report?.score), [report?.score]);

  const handleAssignCrew = async () => {
    if (!id || !selectedCrew) return;
    setActionLoading(true);
    setError('');
    try {
      const wo = await assignCrewToReport(id, selectedCrew);
      setSelectedCrew('');
      // work_order on the report flips the panel to the assigned state
      setReport((prev: any) => (prev ? { ...prev, status: wo.status, work_order: wo } : prev));
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

  if (!report) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Report not found</p>
        <Link to="/authority" className="text-indigo-600 text-sm mt-2 inline-block">← Back to dashboard</Link>
      </div>
    );
  }

  const wo = report.work_order || null;
  const canAssign = !wo || ['scored', 'dispatched'].includes(wo.status);
  const assignedCrew = crewList.find((c) => c.id === (wo?.assigned_crew_id || report.assigned_crew_id));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/authority" className="text-sm text-indigo-600 hover:text-indigo-800 mb-4 inline-block">
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{report.address || 'Location not specified'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Citizen Report {report.id} • submitted by{' '}
            <span className="font-medium text-gray-700">{citizenNames[report.citizen_id] || 'Resident'}</span>
          </p>
        </div>
        <StatusBadge status={report.status} />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-6">{error}</div>
      )}

      {/* Evidence + location */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <EvidenceImage
            src={report.media_url}
            lat={report.gps?.lat}
            lng={report.gps?.lng}
            alt="Report evidence"
            className="w-full h-56"
          />
          <div className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
            📸 Citizen-submitted evidence ({report.media_type === 'video' ? 'video' : 'photo'})
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">📍 Reported Location</h3>
          <IncidentMap
            center={report.gps?.lat != null ? report.gps : undefined}
            markerLabel={report.address || 'Reported Location'}
            className="h-44"
          />
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Media" value={report.media_type === 'video' ? '🎥 Video' : '📷 Photo'} />
        <InfoCard
          label="Urgency Score"
          value={
            <span className="font-bold">
              {typeof report.score?.urgency_score === 'number'
                ? `${report.score.urgency_score}/100`
                : wo?.urgency_score != null
                  ? `${wo.urgency_score}/100`
                  : 'Awaiting AI scoring'}
            </span>
          }
        />
        <InfoCard label="Reported On" value={new Date(report.created_at).toLocaleDateString()} />
        <InfoCard
          label="GPS"
          value={
            typeof report.gps?.lat === 'number'
              ? `${report.gps.lat.toFixed(4)}, ${report.gps.lng.toFixed(4)}`
              : '—'
          }
        />
      </div>

      {/* Description */}
      {report.description && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">📝 Description</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{report.description}</p>
        </div>
      )}

      {/* AI Detection (if the pipeline has already scored this report) */}
      {report.detection && Number(report.detection.confidence) === 0 && (
        <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/60 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">🤖 AI Detection</h3>
          <p className="text-sm text-amber-800">
            ⚠️ This issue was expedited by the authority — AI detection/scoring has not run on it yet.
          </p>
        </div>
      )}
      {report.detection && Number(report.detection.confidence) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">🤖 AI Detection</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="capitalize font-medium">{report.detection.damage_type}</span>
            <span className="text-gray-400">•</span>
            <span>Confidence: {Math.round((report.detection.confidence <= 1 ? report.detection.confidence : report.detection.confidence / 100) * 100)}%</span>
          </div>
          {factors && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">5-Factor Urgency Breakdown:</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {Object.entries(factors).map(([key, val]) => (
                  <div key={key} className="text-center bg-gray-50 rounded-lg py-2 px-1">
                    <div className="text-sm font-bold text-gray-700">{val}</div>
                    <div className="text-[10px] text-gray-400 capitalize leading-tight mt-0.5">
                      {key.replace(/_/g, ' ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Citizen feedback (once verified) */}
      <div className="mb-6">
        <CitizenFeedback reportId={report.id} />
      </div>

      {/* Assign crew */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">🔧 Assign Crew</h3>

        {assignedCrew && wo && ['assigned_to_crew', 'crew_submitted', 'reviewing', 'repaired', 'verified'].includes(wo.status) && (
          <div className="mb-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-lg">🧑‍🔧</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{assignedCrew?.name || wo.assigned_crew_id}</p>
                <p className="text-xs text-gray-500">
                  Assigned • work order status: <StatusBadge status={wo.status} />
                </p>
              </div>
              <Link
                to={`/authority/workorders/${wo.id}`}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
              >
                Open work order →
              </Link>
            </div>
          </div>
        )}

        {canAssign && (
          <>
            <p className="text-xs text-gray-500 mb-2">
              {wo
                ? 'This report already has a work order — assign a crew member to carry out the repair.'
                : 'No work order exists yet. Assigning a crew will create one on the fly and dispatch the crew directly to this location.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCrew}
                onChange={(e) => setSelectedCrew(e.target.value)}
                disabled={crewList.length === 0 || actionLoading}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-w-52"
              >
                <option value="">
                  {crewList.length === 0 ? 'No crews provisioned' : 'Select crew…'}
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
          </>
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
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMetrics, getWorkOrders, getReports, getReportFeedback, getUsersByRole } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import IncidentMap from '../../components/IncidentMap';
import EvidenceImage from '../../components/EvidenceImage';
import type { WorkOrder } from '../../types';

export default function AuthorityDashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [workOrders, setWorkOrders] = useState<(WorkOrder & { report?: any })[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [citizenNames, setCitizenNames] = useState<Record<string, string>>({});
  const [operatorNames, setOperatorNames] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      getMetrics().catch(() => null),
      getWorkOrders({ sort: 'urgency' }),
      getReports().catch(() => ({ data: [] })),
      getUsersByRole('drone_operator').catch(() => ({ data: [] })),
    ]).then(([m, wo, rp, ops]) => {
      setMetrics(m);
      setWorkOrders(wo.data);
      setReports(rp.data || []);
      const names: Record<string, string> = {};
      for (const u of ops?.data || []) names[u.id] = u.name;
      setOperatorNames(names);
    }).finally(() => setLoading(false));
  }, []);

  // Citizen feedback across the reports of the visible work orders, so
  // authority sees ratings/comments without opening every detail page.
  useEffect(() => {
    if (workOrders.length === 0) return;
    const reportIds = [...new Set(workOrders.slice(0, 5).map((w) => w.report_id).filter(Boolean))];
    Promise.all([
      Promise.all(reportIds.map((rid) => getReportFeedback(rid).catch(() => ({ data: [] })))),
      getUsersByRole('citizen').catch(() => ({ data: [] })),
    ]).then(([fbResults, users]) => {
      const names: Record<string, string> = {};
      for (const u of users?.data || []) names[u.id] = u.name;
      setCitizenNames(names);
      const entries: any[] = [];
      reportIds.forEach((rid, i) => {
        for (const f of fbResults[i]?.data || []) {
          entries.push({ ...f, report_id: rid, work_order: workOrders.find((w) => w.report_id === rid) });
        }
      });
      entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      setFeedback(entries);
    });
  }, [workOrders]);

  // Drone survey rows, with each survey's generated findings resolved from
  // the report row (mock embeds a work_orders summary) or — for the real
  // backend — from the already-loaded work-order list by report id.
  const droneSurveyRows = reports
    .filter((r) => r.source_type === 'drone')
    .map((r) => ({
      ...r,
      work_orders: Array.isArray(r.work_orders)
        ? r.work_orders
        : workOrders
            .filter((w) => w.report_id === r.id)
            .map((w) => ({
              id: w.id,
              status: w.status,
              damage_type: w.damage_type,
              urgency_score: w.urgency_score,
              cost_estimate: w.cost_estimate,
            })),
    }));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Authority Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Municipal road infrastructure oversight</p>
      </div>

      {/* Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <MetricCard
            icon="✅"
            label="Verified Repairs"
            value={`${metrics.percent_repairs_verified}%`}
            color="text-emerald-600"
          />
          <MetricCard
            icon="📋"
            label="Open Issues"
            value={metrics.open_issues}
            color="text-orange-600"
          />
          <MetricCard
            icon="⏰"
            label="Overdue"
            value={metrics.overdue_sla_count}
            color={metrics.overdue_sla_count > 0 ? 'text-red-600' : 'text-gray-600'}
          />
        </div>
      )}

      {/* Map Overview — pins colored by urgency score (green = low, red = high) */}
      {workOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">📍 Incident Locations</h2>
          <IncidentMap
            showLegend
            center={workOrders[0]?.location?.gps}
            markers={workOrders
              .filter((wo) => wo.location?.gps && typeof wo.location.gps.lat === 'number')
              .map((wo) => ({
                lat: wo.location.gps.lat,
                lng: wo.location.gps.lng,
                label: wo.location?.address || wo.id,
                urgency: wo.urgency_score,
              }))}
            className="h-64"
          />
        </div>
      )}

      {/* New citizen reports — submitted but not yet dispatched to a crew */}
      {reports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-8">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">📬 New Citizen Reports</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Fresh citizen submissions awaiting AI scoring and dispatch
              </p>
            </div>
          </div>
          <NewCitizenReports reports={reports} />
        </div>
      )}

      {/* Drone surveys — aerial findings from the drone-operator unit */}
      <DroneSurveysSection
        surveys={droneSurveyRows}
        operatorNames={operatorNames}
      />

      {/* Citizen Feedback */}
      {feedback.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">💬 Citizen Feedback</h2>
              <p className="text-xs text-gray-500 mt-0.5">Ratings residents left on verified repairs</p>
            </div>
          </div>
          <div className="grid gap-3">
            {feedback.map((f) => (
              <div key={f.id} className="rounded-lg bg-amber-50/60 border border-amber-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-yellow-400 tracking-tight whitespace-nowrap">
                      {'★'.repeat(Math.max(0, Math.min(5, Number(f.rating) || 0)))}
                      <span className="text-gray-300">
                        {'★'.repeat(Math.max(0, 5 - Math.min(5, Number(f.rating) || 0)))}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-gray-800 whitespace-nowrap">
                      {citizenNames[f.citizen_id] || 'Resident'}
                    </span>
                  </div>
                  {f.work_order && (
                    <Link
                      to={`/authority/workorders/${f.work_order.id}`}
                      className="text-xs text-indigo-600 hover:text-indigo-800 truncate"
                    >
                      {f.work_order.location?.address}
                    </Link>
                  )}
                </div>
                {f.comment && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{f.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Priority Work Orders */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Priority Work Orders</h2>
            <p className="text-xs text-gray-500 mt-0.5">Sorted by urgency score</p>
          </div>
          <Link
            to="/authority/workorders"
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            View All →
          </Link>
        </div>

        <div className="divide-y divide-gray-100">
          {workOrders.slice(0, 5).map((wo) => (
            <Link
              key={wo.id}
              to={`/authority/workorders/${wo.id}`}
              className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
            >
              <EvidenceImage
                src={wo.evidence_image_url}
                lat={wo.location?.gps?.lat}
                lng={wo.location?.gps?.lng}
                alt=""
                className="w-12 h-12 rounded-lg flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {wo.location?.address || 'Unknown location'}
                  </p>
                  <StatusBadge status={wo.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span className="capitalize">{wo.damage_type}</span>
                  <span>•</span>
                  <span>₹{wo.cost_estimate?.toLocaleString()}</span>
                  <span>•</span>
                  <span>SLA: {new Date(wo.sla_deadline).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`text-xl font-bold ${
                  wo.urgency_score >= 70 ? 'text-red-600' : wo.urgency_score >= 40 ? 'text-orange-500' : 'text-green-600'
                }`}>
                  {wo.urgency_score}
                </div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">urgency</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

/**
 * Drone surveys submitted by the drone-operator unit. The AI pipeline
 * turns each survey into per-pothole scored work orders, which the
 * authority opens from here and assigns to crews.
 */
function DroneSurveysSection({ surveys, operatorNames }: { surveys: any[]; operatorNames: Record<string, string> }) {
  const sorted = [...surveys].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <div className="p-5 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">🚁 Drone Survey Findings</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Aerial surveys analysed by the AI pipeline — each finding is a scored work order ready for dispatch
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {sorted.map((s) => {
          const wos: any[] = s.work_orders || [];
          const analysing = s.status === 'reported';
          const top = [...wos].sort((a, b) => b.urgency_score - a.urgency_score)[0];
          const estCost = wos.reduce((n, w) => n + (Number(w.cost_estimate) || 0), 0);
          const maxUrgency = wos.length ? Math.max(...wos.map((w) => w.urgency_score)) : null;
          return (
            <div key={s.id} className="p-4 flex items-start gap-4">
              <div className="w-14 h-14 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-xl flex-shrink-0">
                🎥
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {s.address || 'Aerial survey (route not labelled)'}
                    </p>
                    {s.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.description}</p>
                    )}
                  </div>
                  {analysing ? (
                    <span className="px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full whitespace-nowrap flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      AI analysis running
                    </span>
                  ) : (
                    <StatusBadge status={s.status} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                  <span>🛸 {operatorNames[s.citizen_id] || 'Drone operator'}</span>
                  <span>•</span>
                  <span>{new Date(s.created_at).toLocaleString()}</span>
                  <span>•</span>
                  <span className="font-mono">{s.id}</span>
                </div>

                {!analysing && wos.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    {wos.map((w) => (
                      <span
                        key={w.id}
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-medium capitalize ${
                          w.urgency_score >= 70
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : w.urgency_score >= 40
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {w.damage_type} · {w.urgency_score}/100
                      </span>
                    ))}
                    <span className="text-[11px] text-gray-400">
                      est. ₹{estCost.toLocaleString('en-IN')} total
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                {maxUrgency != null && (
                  <span
                    className={`text-xl font-bold leading-none ${
                      maxUrgency >= 70 ? 'text-red-600' : maxUrgency >= 40 ? 'text-orange-500' : 'text-green-600'
                    }`}
                  >
                    {maxUrgency}
                  </span>
                )}
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">top urgency</span>
                {top ? (
                  <Link
                    to={`/authority/workorders/${top.id}`}
                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
                  >
                    Open work order →
                  </Link>
                ) : analysing ? (
                  <span className="mt-1 text-[11px] text-gray-400 whitespace-nowrap">findings pending…</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Citizen reports that haven't progressed to a dispatched work order yet
 * (fresh submissions the authority hasn't acted on). Drone reports are
 * excluded — their detections flow in as work orders, handled in the
 * priority list.
 */
function NewCitizenReports({ reports }: { reports: any[] }) {
  const fresh = reports
    .filter(
      (r) =>
        r.source_type !== 'drone' &&
        ['reported', 'scored', 'review_needed'].includes(r.status)
    )
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  if (fresh.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-400">
        No new citizen reports — all submissions have been dispatched. ✅
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {fresh.map((r) => (
        <Link
          key={r.id}
          to={`/authority/reports/${r.id}`}
          className="flex items-start gap-4 p-4 hover:bg-indigo-50/40 transition-colors group"
        >
          <EvidenceImage
            src={r.media_url}
            lat={r.gps?.lat}
            lng={r.gps?.lng}
            alt="Report evidence"
            className="w-16 h-16 rounded-lg flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                  {r.address || 'Location not specified'}
                </p>
                {r.description && (
                  <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{r.description}</p>
                )}
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
              <span>
                📍 {typeof r.gps?.lat === 'number' ? `${r.gps.lat.toFixed(4)}, ${r.gps.lng.toFixed(4)}` : '—'}
              </span>
              <span>•</span>
              <span>{new Date(r.created_at).toLocaleString()}</span>
              <span>•</span>
              <span className={r.media_type === 'video' ? 'text-purple-500' : 'text-blue-500'}>
                {r.media_type === 'video' ? '🎥 video' : '📷 photo'}
              </span>
              <span className="ml-auto text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                View details →
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

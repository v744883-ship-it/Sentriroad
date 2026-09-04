import { useCallback, useEffect, useRef, useState } from 'react';
import { createReport, getReport, getReports, uploadFile } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import type { WorkOrderStatus } from '../../types';

type Survey = any;
type WorkOrderSummary = { id: string; status: WorkOrderStatus; damage_type: string; urgency_score: number; cost_estimate: number };

function urgencyTone(score: number): string {
  if (score >= 70) return 'bg-red-50 text-red-700 border-red-200';
  if (score >= 40) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

/** Normalize a raw work-order row (mock list summary or real/detail row) into the compact chip shape. */
function summarizeWo(w: any): WorkOrderSummary | null {
  if (!w) return null;
  return {
    id: w.id,
    status: w.status as WorkOrderStatus,
    damage_type: w.damage_type,
    urgency_score: Number(w.urgency_score) || 0,
    cost_estimate: Number(w.cost_estimate) || 0,
  };
}

/**
 * Extract per-finding work orders for a drone survey. The mock embeds a
 * compact `work_orders` array on list rows; the real backend returns full
 * `work_orders` arrays (or a single `work_order`) on GET /reports/:id —
 * this accepts all three shapes.
 */
function workOrdersFor(detail: any): WorkOrderSummary[] {
  const rows = detail.work_orders || (detail.work_order ? [detail.work_order] : []);
  return rows.map(summarizeWo).filter(Boolean) as WorkOrderSummary[];
}

export default function OperatorConsole() {
  const { user } = useAuth();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);

  // Submission form state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [telemetryFile, setTelemetryFile] = useState<File | null>(null);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const telemetryInputRef = useRef<HTMLInputElement>(null);

  const loadSurveys = useCallback(async () => {
    try {
      const res: any = await getReports();
      let mine = (res.data || []).filter(
        (r: any) => r.source_type === 'drone' && r.citizen_id === user?.id
      );
      // Real backend: list rows don't embed generated work orders, but its
      // GET /reports/:id returns per-survey detections/scores/work_orders.
      // Hydrate any finished survey whose findings are missing so the
      // console shows them against the real backend too.
      const needDetail = mine.filter(
        (r: any) => r.status !== 'reported' && !Array.isArray(r.work_orders)
      );
      if (needDetail.length > 0) {
        const details = await Promise.all(
          needDetail.map((r: any) => getReport(r.id).catch(() => null))
        );
        const byId = new Map(details.filter(Boolean).map((d: any) => [d.id, d]));
        mine = mine.map((r: any) => {
          const detail = byId.get(r.id);
          return detail ? { ...r, work_orders: workOrdersFor(detail) } : r;
        });
      }
      setSurveys(mine);
    } catch {
      // keep last known state on transient errors
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadSurveys();
  }, [loadSurveys]);

  // Poll while any survey is still in the analysis queue, so completed
  // findings (scored work orders) appear on the console without a manual
  // refresh. Polling stops automatically once everything is analysed.
  const hasPending = surveys.some((s) => s.status === 'reported');
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => loadSurveys(), 3000);
    return () => clearInterval(timer);
  }, [hasPending, loadSurveys]);

  const pending = surveys.filter((s) => s.status === 'reported').length;
  const flagged = surveys.reduce(
    (n, s) => n + ((s.work_orders as WorkOrderSummary[] | undefined)?.length || 0),
    0
  );
  const highUrgency = surveys.reduce((n, s) => {
    const wos: WorkOrderSummary[] = s.work_orders || [];
    return n + wos.filter((w) => w.urgency_score >= 70).length;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile || !telemetryFile) {
      setError('Select both the road video and its matching telemetry file.');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const video = await uploadFile(videoFile);
      const telemetry = await uploadFile(telemetryFile);
      const report = await createReport({
        media_url: video.url,
        media_type: 'video',
        source_type: 'drone',
        telemetry_url: telemetry.url,
        address: address || undefined,
        description: description || undefined,
      });
      setSuccess(
        `Survey ${report.id} submitted. AI analysis is running — detections and work orders will appear here and on the authority dashboard shortly.`
      );
      setVideoFile(null);
      setTelemetryFile(null);
      setAddress('');
      setDescription('');
      if (videoInputRef.current) videoInputRef.current.value = '';
      if (telemetryInputRef.current) telemetryInputRef.current.value = '';
      loadSurveys();
    } catch (err: any) {
      setError(err?.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const sorted = [...surveys].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🚁 Drone Operations Console</h1>
        <p className="text-sm text-gray-500 mt-1">
          Aerial road surveys — submit flight video + telemetry, then review AI-detected findings.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm mb-4">{success}</div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi icon="🛫" label="Surveys flown" value={surveys.length} tone="text-slate-900" />
        <Kpi icon="🕳️" label="Potholes flagged" value={flagged} tone="text-indigo-600" />
        <Kpi icon="⏳" label="In analysis queue" value={pending} tone={pending ? 'text-amber-600' : 'text-slate-900'} />
        <Kpi icon="🚨" label="High urgency" value={highUrgency} tone={highUrgency ? 'text-red-600' : 'text-slate-900'} />
      </div>

      <div className="grid lg:grid-cols-5 gap-6 mb-8">
        {/* Submission panel */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">New aerial survey</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Fly a road segment and submit the recording. Location is recovered from the telemetry file — no manual pin needed.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <DropZone
                label="Road video *"
                hint={videoFile ? `${(videoFile.size / 1048576).toFixed(1)} MB selected` : 'MP4 · AVI · MOV'}
                icon={videoFile ? '🎬' : '🎥'}
                active={!!videoFile}
                onClick={() => videoInputRef.current?.click()}
                fileName={videoFile?.name}
              />
              <DropZone
                label="Telemetry file *"
                hint={telemetryFile ? 'GPS ↔ frame sync attached' : 'SRT · CSV · JSON'}
                icon={telemetryFile ? '📡' : '🗺️'}
                active={!!telemetryFile}
                onClick={() => telemetryInputRef.current?.click()}
                fileName={telemetryFile?.name}
              />
            </div>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
            />
            <input
              ref={telemetryInputRef}
              type="file"
              accept=".srt,.csv,.json,.txt,application/json,text/csv,text/plain"
              className="hidden"
              onChange={(e) => setTelemetryFile(e.target.files?.[0] || null)}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Road / area flown (recommended)</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Outer Ring Road, Marathahalli stretch"
                className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Flight notes (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Weather, traffic, altitude, battery…"
                className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {submitting ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uploading & submitting…
                </>
              ) : (
                <>🚁 Launch analysis</>
              )}
            </button>
          </form>
        </div>

        {/* Pipeline explainer + live queue */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-xl p-5">
            <h3 className="text-sm font-semibold text-indigo-200 uppercase tracking-wider mb-3">
              How it works
            </h3>
            <ol className="space-y-3">
              {[
                ['🛫', 'Flight upload', 'Video + telemetry are stored securely'],
                ['🤖', 'AI analysis', 'Potholes located & clustered from the video feed'],
                ['📊', 'Scoring', 'Each finding gets an urgency score & cost estimate'],
                ['🏛️', 'Authority queue', 'Scored work orders appear for dispatch to crews'],
              ].map(([icon, title, body], i) => (
                <li key={title} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-sm flex-shrink-0">
                      {icon}
                    </div>
                    {i < 3 && <div className="w-px flex-1 bg-white/15 my-1" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-slate-300/80 mt-0.5">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {pending > 0 && (
            <div className="bg-white rounded-xl border border-amber-200 p-4 flex items-start gap-3">
              <div className="mt-0.5 h-3.5 w-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  {pending} survey{pending > 1 ? 's' : ''} in the analysis queue
                </p>
                <p className="text-xs text-amber-700/80 mt-0.5">
                  Findings appear here automatically once the AI pipeline finishes.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Survey history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Flight log</h2>
            <p className="text-xs text-gray-500 mt-0.5">Every survey you have flown, newest first</p>
          </div>
          <span className="px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded-full">
            {surveys.length} survey{surveys.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <div className="h-7 w-7 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-3">🛩️</div>
            <p className="text-sm text-gray-500">No surveys flown yet.</p>
            <p className="text-xs text-gray-400 mt-1">Upload a flight above to run the first analysis.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sorted.map((s) => {
              const wos: WorkOrderSummary[] = s.work_orders || [];
              const expanded = expandedId === s.id;
              const analysing = s.status === 'reported';
              return (
                <div key={s.id} className={analysing ? 'bg-amber-50/40' : undefined}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    className="w-full text-left p-4 hover:bg-gray-50/70 transition-colors flex items-start gap-4 group"
                  >
                    <div className="w-14 h-14 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl flex-shrink-0">
                      🎥
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                            {s.address || 'Drone survey (route not labelled)'}
                          </p>
                          {s.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {analysing && (
                            <span className="px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Analysing
                            </span>
                          )}
                          <StatusBadge status={s.status} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                        <span className="font-mono">{s.id}</span>
                        <span>•</span>
                        <span>{new Date(s.created_at).toLocaleString()}</span>
                        <span>•</span>
                        <span className="text-purple-500">🎥 video</span>
                        <span className="text-emerald-500">📡 telemetry</span>
                        {wos.length > 0 && !analysing && (
                          <>
                            <span>•</span>
                            <span className="text-indigo-500 font-medium">
                              {wos.length} finding{wos.length === 1 ? '' : 's'} → {wos.length} work order{wos.length === 1 ? '' : 's'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className={`text-gray-300 group-hover:text-indigo-500 transition-colors mt-1 ${expanded ? 'rotate-180 text-indigo-500' : ''}`}>
                      ▾
                    </span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-5">
                      {analysing ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-center gap-3">
                          <div className="h-4 w-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          AI analysis in progress — this page refreshes automatically. Once complete, each detected
                          finding is scored and queued for the authority to dispatch.
                        </div>
                      ) : wos.length === 0 ? (
                        <p className="text-sm text-gray-400">No findings were recorded for this flight.</p>
                      ) : (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">
                            Detected findings (scored work orders)
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {wos.map((w) => (
                              <div
                                key={w.id}
                                className="rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800 capitalize">{w.damage_type}</p>
                                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">{w.id}</p>
                                  <p className="text-[11px] text-gray-500 mt-1">
                                    ₹{Number(w.cost_estimate).toLocaleString('en-IN')} est.
                                  </p>
                                </div>
                                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                  <span className={`px-2 py-0.5 rounded-full border text-xs font-bold ${urgencyTone(w.urgency_score)}`}>
                                    {w.urgency_score}/100
                                  </span>
                                  <StatusBadge status={w.status} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-3">
                            Findings flow to the authority's work-order queue, where crews are assigned for repair.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className={`text-2xl font-bold leading-none ${tone}`}>{value}</div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>
      </div>
    </div>
  );
}

function DropZone({
  label,
  hint,
  icon,
  active,
  onClick,
  fileName,
}: {
  label: string;
  hint: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  fileName?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-xl px-4 py-5 text-sm transition-colors ${
          active
            ? 'border-indigo-300 bg-indigo-50/50 text-indigo-700'
            : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-indigo-300 hover:bg-indigo-50/40'
        }`}
      >
        <span className="text-xl">{icon}</span>
        <span className="font-medium text-center break-all leading-snug">
          {fileName || (active ? 'File ready' : 'Click to browse')}
        </span>
        <span className="text-[11px] opacity-70">{hint}</span>
      </button>
    </div>
  );
}

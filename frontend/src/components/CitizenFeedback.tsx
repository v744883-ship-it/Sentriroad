import { useEffect, useState } from 'react';
import { getReportFeedback, getUsersByRole } from '../api/client';

/**
 * Citizen Feedback panel — authority/admin oversight view.
 *
 * Fetches the feedback citizens posted against a report (ratings +
 * comments, newest first) plus the citizen directory so names can be
 * shown instead of raw ids. Renders nothing when no feedback exists,
 * so callers can mount it unconditionally.
 */
export default function CitizenFeedback({ reportId }: { reportId?: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [citizenNames, setCitizenNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!reportId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      getReportFeedback(reportId).catch(() => ({ data: [] })),
      getUsersByRole('citizen').catch(() => ({ data: [] })),
    ])
      .then(([fb, users]) => {
        if (!alive) return;
        const names: Record<string, string> = {};
        for (const u of users?.data || []) names[u.id] = u.name;
        setCitizenNames(names);
        setEntries(fb?.data || []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reportId]);

  if (loading || entries.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-gray-900">💬 Citizen Feedback</h3>
        <span className="text-xs text-gray-400">What the resident said about this repair</span>
      </div>

      <div className="space-y-4">
        {entries.map((f) => (
          <div key={f.id} className="rounded-lg bg-amber-50/60 border border-amber-100 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 text-sm tracking-tight">
                  {'★'.repeat(Math.max(0, Math.min(5, Number(f.rating) || 0)))}
                  <span className="text-gray-300">
                    {'★'.repeat(Math.max(0, 5 - Math.min(5, Number(f.rating) || 0)))}
                  </span>
                </span>
                <span className="text-xs font-medium text-gray-700">
                  {citizenNames[f.citizen_id] || 'Citizen'}
                </span>
              </div>
              <span className="text-[11px] text-gray-400">
                {f.created_at ? new Date(f.created_at).toLocaleDateString() : ''}
              </span>
            </div>
            {f.comment && <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{f.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

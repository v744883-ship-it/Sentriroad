import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReport, submitFeedback } from '../../api/client';
import { CitizenStatusBadge } from '../../components/StatusBadge';
import IncidentMap from '../../components/IncidentMap';
import EvidenceImage from '../../components/EvidenceImage';
import type { Report, WorkOrder } from '../../types';

const simplifiedSteps = [
  { label: 'Reported', statuses: ['reported'] },
  { label: 'Under Review', statuses: ['scored', 'dispatched'] },
  { label: 'Repair in Progress', statuses: ['assigned_to_crew', 'crew_submitted', 'reviewing'] },
  { label: 'Needs Review', statuses: ['review_needed'] },
  { label: 'Repaired', statuses: ['repaired'] },
  { label: 'Verified', statuses: ['verified'] },
];

function getStepIndex(status: string): number {
  const idx = simplifiedSteps.findIndex(s => s.statuses.includes(status));
  return idx >= 0 ? idx : 0;
}

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<(Report & { work_order?: WorkOrder }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    getReport(id)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [id]);

  // Poll the full report every 5s so the tracker, the AI work-order
  // panel, and the feedback form all appear as soon as the pipeline
  // moves the issue forward (no refresh needed).
  useEffect(() => {
    if (!id || !polling) return;
    const interval = setInterval(() => {
      getReport(id)
        .then((fresh) => setReport((prev) => (prev ? { ...prev, ...fresh } : prev)))
        .catch(() => {
          /* transient network error — keep last known state */
        });
    }, 5000);
    return () => clearInterval(interval);
  }, [id, polling]);

  const handleFeedback = async () => {
    if (!id || rating === 0) return;
    setFeedbackLoading(true);
    setError('');
    try {
      await submitFeedback(id, rating, comment || undefined);
      setFeedbackSent(true);
      setPolling(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFeedbackLoading(false);
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
        <Link to="/citizen" className="text-indigo-600 text-sm mt-2 inline-block">← Back to reports</Link>
      </div>
    );
  }

  const currentStep = getStepIndex(report.status);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link to="/citizen" className="text-sm text-indigo-600 hover:text-indigo-800 mb-4 inline-block">
        ← Back to My Reports
      </Link>

      {/* Report Image */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <EvidenceImage
          src={report.media_url}
          lat={report.gps?.lat}
          lng={report.gps?.lng}
          alt="Report evidence"
          className="w-full h-64"
        />
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-gray-900">{report.address || 'Location not specified'}</p>
              {report.description && <p className="text-sm text-gray-500 mt-1">{report.description}</p>}
            </div>
            <CitizenStatusBadge status={report.status} />
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
            <span>📍 {report.gps.lat.toFixed(4)}, {report.gps.lng.toFixed(4)}</span>
            <span>•</span>
            <span>{new Date(report.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Location Map */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">📍 Incident Location</h3>
        <IncidentMap
          center={report.gps}
          markerLabel={report.address || `Location (${report.gps.lat.toFixed(4)}, ${report.gps.lng.toFixed(4)})`}
          className="h-48"
        />
      </div>

      {/* Status Tracker */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Status Tracker</h3>
        <div className="flex items-center justify-between relative">
          {/* Progress line */}
          <div className="absolute top-3 left-0 right-0 h-0.5 bg-gray-200" />
          <div
            className="absolute top-3 left-0 h-0.5 bg-indigo-500 transition-all duration-500"
            style={{ width: `${(currentStep / (simplifiedSteps.length - 1)) * 100}%` }}
          />

          {simplifiedSteps.map((step, i) => {
            const isActive = i === currentStep;
            const isDone = i < currentStep;
            return (
              <div key={step.label} className="relative z-10 flex flex-col items-center">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    isDone
                      ? 'bg-indigo-500 border-indigo-500 text-white'
                      : isActive
                      ? 'bg-white border-indigo-500 text-indigo-600 ring-2 ring-indigo-200'
                      : 'bg-white border-gray-300 text-gray-400'
                  }`}
                >
                  {isDone ? '✓' : i + 1}
                </div>
                <span className={`text-[10px] mt-1.5 whitespace-nowrap ${isActive ? 'text-indigo-600 font-semibold' : isDone ? 'text-gray-600' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Work Order Info */}
      {report.work_order && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Work Order Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Damage Type:</span>
              <span className="ml-2 font-medium capitalize">{report.work_order.damage_type}</span>
            </div>
            <div>
              <span className="text-gray-500">Urgency:</span>
              <span className={`ml-2 font-bold ${report.work_order.urgency_score >= 70 ? 'text-red-600' : report.work_order.urgency_score >= 40 ? 'text-orange-600' : 'text-green-600'}`}>
                {report.work_order.urgency_score}/100
              </span>
            </div>
            <div>
              <span className="text-gray-500">Cost Estimate:</span>
              <span className="ml-2 font-medium">₹{report.work_order.cost_estimate.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">SLA Deadline:</span>
              <span className="ml-2 font-medium">{new Date(report.work_order.sla_deadline).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Form (only for verified reports) */}
      {report.status === 'verified' && !feedbackSent && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Rate This Repair</h3>
          <p className="text-xs text-gray-500 mb-4">Your feedback helps improve road maintenance quality.</p>

          {/* Star rating */}
          <div className="flex gap-1 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className={`text-2xl transition-transform hover:scale-110 ${star <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Any comments? (optional)"
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none mb-3"
          />

          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

          <button
            onClick={handleFeedback}
            disabled={rating === 0 || feedbackLoading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {feedbackLoading ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </div>
      )}

      {feedbackSent && (
        <div className="bg-green-50 rounded-xl border border-green-200 p-5 text-center">
          <div className="text-3xl mb-2">✅</div>
          <p className="text-sm font-medium text-green-800">Thank you for your feedback!</p>
        </div>
      )}
    </div>
  );
}

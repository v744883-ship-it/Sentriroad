import { useEffect, useState, useRef } from 'react';
import { getWorkOrders, uploadFile, submitRepair } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import EvidenceImage from '../../components/EvidenceImage';
import type { WorkOrder } from '../../types';

export default function CrewDashboard() {
  const [workOrders, setWorkOrders] = useState<(WorkOrder & { report?: any })[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});

  const load = () => {
    getWorkOrders()
      .then((res) => setWorkOrders(res.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, woId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFiles(prev => ({ ...prev, [woId]: file }));
    }
  };

  const handleSubmitRepair = async (woId: string) => {
    const file = selectedFiles[woId];
    if (!file) {
      setError('Please select a repair photo first');
      return;
    }

    setSubmittingId(woId);
    setError('');
    try {
      const uploadResult = await uploadFile(file);
      await submitRepair(woId, uploadResult.url, 'Repair completed');
      setSelectedFiles(prev => {
        const next = { ...prev };
        delete next[woId];
        return next;
      });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmittingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const assigned = workOrders.filter(w => w.status === 'assigned_to_crew');
  const submitted = workOrders.filter(w => ['crew_submitted', 'reviewing'].includes(w.status));
  const completed = workOrders.filter(w => ['repaired', 'verified'].includes(w.status));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Assignments</h1>
        <p className="text-sm text-gray-500 mt-1">Work orders assigned to you</p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm mb-4">{error}</div>
      )}

      {/* Active Assignments */}
      <Section title="🔧 Active Assignments" count={assigned.length} empty="No active assignments right now.">
        {assigned.map((wo) => (
          <WorkOrderCard
            key={wo.id}
            wo={wo}
            showFileUpload
            selectedFile={selectedFiles[wo.id] || null}
            onFileSelect={(e) => handleFileSelect(e, wo.id)}
            onSubmit={() => handleSubmitRepair(wo.id)}
            submitting={submittingId === wo.id}
          />
        ))}
      </Section>

      {/* Under Review */}
      <Section title="⏳ Under Review" count={submitted.length} empty="No submissions under review.">
        {submitted.map((wo) => (
          <WorkOrderCard key={wo.id} wo={wo} />
        ))}
      </Section>

      {/* Completed */}
      <Section title="✅ Completed" count={completed.length} empty="No completed repairs yet.">
        {completed.map((wo) => (
          <WorkOrderCard key={wo.id} wo={wo} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">{count}</span>
      </div>
      {count === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </div>
  );
}

function WorkOrderCard({ wo, showFileUpload, selectedFile, onFileSelect, onSubmit, submitting }: {
  wo: WorkOrder & { report?: any };
  showFileUpload?: boolean;
  selectedFile?: File | null;
  onFileSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
  submitting?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOverdue = new Date(wo.sla_deadline) < new Date() && wo.status !== 'verified';
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow">
      <div className="p-4">
        <div className="flex gap-4">
          <EvidenceImage
            src={wo.evidence_image_url}
            lat={wo.location?.gps?.lat}
            lng={wo.location?.gps?.lng}
            alt=""
            className="w-16 h-16 rounded-lg flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{wo.location?.address || 'Unknown location'}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span className="capitalize">{wo.damage_type}</span>
                  <span>•</span>
                  <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                    SLA: {new Date(wo.sla_deadline).toLocaleDateString()}
                    {isOverdue && ' (Overdue!)'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={wo.status} />
              </div>
            </div>

            {/* File upload for active assignments */}
            {showFileUpload && (
              <div className="mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    📷 {selectedFile ? 'Change Photo' : 'Select Repair Photo'}
                  </button>
                  {selectedFile && (
                    <span className="text-xs text-green-600">✅ {selectedFile.name}</span>
                  )}
                </div>
                {selectedFile && (
                  <div className="mt-2">
                    <img
                      src={URL.createObjectURL(selectedFile)}
                      alt="Repair preview"
                      className="w-32 h-24 rounded-lg object-cover"
                    />
                  </div>
                )}
                <button
                  onClick={onSubmit}
                  disabled={submitting || !selectedFile}
                  className="mt-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    '📸 Submit Repair'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Rejection reason */}
        {wo.rejection_reason && (
          <div className="mt-3 p-2 bg-red-50 rounded-lg text-xs text-red-700">
            ⚠️ Rejected: {wo.rejection_reason}
          </div>
        )}
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors border-t border-gray-100"
      >
        {expanded ? '↑ Less details' : '↓ More details'}
      </button>

      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
          <div>
            <span className="text-gray-500">Work Order:</span>
            <span className="ml-2 font-mono text-xs">{wo.id}</span>
          </div>
          <div>
            <span className="text-gray-500">Urgency:</span>
            <span className={`ml-2 font-bold ${wo.urgency_score >= 70 ? 'text-red-600' : 'text-orange-500'}`}>
              {wo.urgency_score}/100
            </span>
          </div>
          <div>
            <span className="text-gray-500">Cost Estimate:</span>
            <span className="ml-2">₹{wo.cost_estimate?.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">GPS:</span>
            <span className="ml-2">{wo.location?.gps?.lat?.toFixed(4)}, {wo.location?.gps?.lng?.toFixed(4)}</span>
          </div>
          {wo.crew_photo_url && (
            <div className="col-span-2">
              <span className="text-gray-500">Submitted Photo:</span>
              <EvidenceImage
                src={wo.crew_photo_url}
                lat={wo.location?.gps?.lat}
                lng={wo.location?.gps?.lng}
                alt="After repair"
                className="mt-1 w-32 h-24 rounded-lg"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

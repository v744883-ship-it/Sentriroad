import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWorkOrders } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import EvidenceImage from '../../components/EvidenceImage';
import type { WorkOrder } from '../../types';

const statusFilters: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'scored', label: 'Scored' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'assigned_to_crew', label: 'Assigned' },
  { value: 'crew_submitted', label: 'Crew Submitted' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'repaired', label: 'Repaired' },
  { value: 'verified', label: 'Verified' },
  { value: 'review_needed', label: 'Needs Review' },
];

export default function WorkOrdersList() {
  const [workOrders, setWorkOrders] = useState<(WorkOrder & { report?: any })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy] = useState<'urgency' | ''>('urgency');
  const [showOverdue, setShowOverdue] = useState(false);

  useEffect(() => {
    setLoading(true);
    getWorkOrders({
      status: statusFilter || undefined,
      sort: sortBy || undefined,
      overdue: showOverdue ? 'true' : undefined,
    })
      .then((res) => setWorkOrders(res.data))
      .finally(() => setLoading(false));
  }, [statusFilter, sortBy, showOverdue]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
        <p className="text-sm text-gray-500 mt-1">Manage and dispatch repair work orders</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex flex-wrap gap-1.5">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                statusFilter === f.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={showOverdue}
              onChange={(e) => setShowOverdue(e.target.checked)}
              className="rounded border-gray-300"
            />
            Overdue only
          </label>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : workOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No work orders match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Issue</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Urgency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Cost</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">SLA</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {workOrders.map((wo) => (
                <tr key={wo.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <EvidenceImage
                        src={wo.evidence_image_url}
                        lat={wo.location?.gps?.lat}
                        lng={wo.location?.gps?.lng}
                        alt=""
                        className="w-10 h-10 rounded-lg"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                          {wo.location?.address || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-400">{wo.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-600">{wo.damage_type}</td>
                  <td className="px-4 py-3">
                    <span className={`font-bold ${
                      wo.urgency_score >= 70 ? 'text-red-600' : wo.urgency_score >= 40 ? 'text-orange-500' : 'text-green-600'
                    }`}>
                      {wo.urgency_score}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">₹{wo.cost_estimate?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(wo.sla_deadline).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><StatusBadge status={wo.status} /></td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/authority/workorders/${wo.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

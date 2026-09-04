import type { WorkOrderStatus } from '../types';

const statusConfig: Record<WorkOrderStatus, { label: string; color: string }> = {
  reported: { label: 'Reported', color: 'bg-blue-100 text-blue-800' },
  scored: { label: 'Scored', color: 'bg-purple-100 text-purple-800' },
  dispatched: { label: 'Dispatched', color: 'bg-orange-100 text-orange-800' },
  assigned_to_crew: { label: 'Assigned to Crew', color: 'bg-yellow-100 text-yellow-800' },
  crew_submitted: { label: 'Crew Submitted', color: 'bg-cyan-100 text-cyan-800' },
  reviewing: { label: 'Reviewing', color: 'bg-indigo-100 text-indigo-800' },
  repaired: { label: 'Repaired', color: 'bg-green-100 text-green-800' },
  verified: { label: 'Verified', color: 'bg-emerald-100 text-emerald-800' },
  review_needed: { label: 'Needs Review', color: 'bg-amber-100 text-amber-800' },
};

export default function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const cfg = statusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

/** Simplified status for citizen view */
export function CitizenStatusBadge({ status }: { status: WorkOrderStatus }) {
  const simplified: Record<string, { label: string; color: string }> = {
    reported: { label: 'Reported', color: 'bg-blue-100 text-blue-800' },
    scored: { label: 'Under Review', color: 'bg-purple-100 text-purple-800' },
    dispatched: { label: 'Under Review', color: 'bg-purple-100 text-purple-800' },
    assigned_to_crew: { label: 'Repair in Progress', color: 'bg-yellow-100 text-yellow-800' },
    crew_submitted: { label: 'Repair in Progress', color: 'bg-yellow-100 text-yellow-800' },
    reviewing: { label: 'Repair in Progress', color: 'bg-yellow-100 text-yellow-800' },
    repaired: { label: 'Repaired', color: 'bg-green-100 text-green-800' },
    verified: { label: 'Verified', color: 'bg-emerald-100 text-emerald-800' },
    review_needed: { label: 'Under Review', color: 'bg-amber-100 text-amber-800' },
  };
  const cfg = simplified[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

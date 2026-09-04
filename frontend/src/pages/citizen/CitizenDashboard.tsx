import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReports } from '../../api/client';
import { CitizenStatusBadge } from '../../components/StatusBadge';
import IncidentMap from '../../components/IncidentMap';
import EvidenceImage from '../../components/EvidenceImage';
import type { Report } from '../../types';

export default function CitizenDashboard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReports()
      .then((res) => setReports(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Track the status of your road damage reports</p>
        </div>
        <Link
          to="/citizen/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
        >
          📸 Report New Issue
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-500">No reports yet. Help improve road safety by reporting an issue!</p>
        </div>
      ) : (
        <>
          {/* Map Overview */}
          {reports.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">📍 All Incident Locations</h3>
              <IncidentMap
                center={reports.find((r) => r.gps?.lat)?.gps}
                markers={reports
                  .filter((r) => r.gps && typeof r.gps.lat === 'number')
                  .map((r) => ({
                    lat: r.gps.lat,
                    lng: r.gps.lng,
                    label: r.address || `Reported ${new Date(r.created_at).toLocaleDateString()}`,
                  }))}
                className="h-64"
              />
            </div>
          )}

          <div className="space-y-4">
          {reports.map((report) => (
            <Link
              key={report.id}
              to={`/citizen/report/${report.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-indigo-200 transition-all"
            >
              <div className="flex gap-4">
                <EvidenceImage
                  src={report.media_url}
                  lat={report.gps?.lat}
                  lng={report.gps?.lng}
                  alt="Report evidence"
                  className="w-20 h-20 rounded-lg flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {report.address || 'Location not specified'}
                      </p>
                      {report.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{report.description}</p>
                      )}
                    </div>
                    <CitizenStatusBadge status={report.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>📍 {report.gps?.lat?.toFixed(4)}, {report.gps?.lng?.toFixed(4)}</span>
                    <span>•</span>
                    <span>{new Date(report.created_at).toLocaleDateString()}</span>
                    <span className={`ml-auto font-mono ${report.media_type === 'video' ? 'text-purple-400' : 'text-blue-400'}`}>
                      {report.media_type === 'video' ? '🎥' : '📷'} {report.media_type}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
        </>
      )}
    </div>
  );
}

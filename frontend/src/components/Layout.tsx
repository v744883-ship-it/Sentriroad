import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const roleLabels: Record<string, string> = {
  citizen: '👤 Citizen',
  authority: '🏛️ Authority',
  crew: '🔧 Crew',
  drone_operator: '🛸 Drone Operator',
  admin: '⚙️ Admin',
};

const navByRole: Record<string, { to: string; label: string; icon: string }[]> = {
  citizen: [
    { to: '/citizen', label: 'My Reports', icon: '📋' },
    { to: '/citizen/new', label: 'Report Issue', icon: '📸' },
  ],
  authority: [
    { to: '/authority', label: 'Dashboard', icon: '📊' },
    { to: '/authority/workorders', label: 'Work Orders', icon: '📝' },
  ],
  crew: [{ to: '/crew', label: 'My Assignments', icon: '🔧' }],
  drone_operator: [{ to: '/operator', label: 'Drone Console', icon: '🚁' }],
  admin: [
    { to: '/authority', label: 'Dashboard', icon: '📊' },
    { to: '/authority/workorders', label: 'Work Orders', icon: '📝' },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (!user) return <Outlet />;

  const navItems = navByRole[user.role] || [];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl">
        <div className="p-5 border-b border-slate-700">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            🛣️ Sentriroad
          </h1>
          <p className="text-xs text-slate-400 mt-1">Road Infrastructure Safety</p>
        </div>

        <div className="p-4 border-b border-slate-700">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{roleLabels[user.role] || user.role}</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.to
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-700">
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const roles = [
  {
    value: 'citizen',
    icon: '👤',
    name: 'Citizen',
    desc: 'Report road damage and track your repairs',
  },
  {
    value: 'authority',
    icon: '🏛️',
    name: 'Authority',
    desc: 'Municipal portal — manage work orders and dispatch crews',
  },
  {
    value: 'crew',
    icon: '🔧',
    name: 'Crew',
    desc: 'Field portal — view assignments and submit repair photos',
  },
  {
    value: 'drone_operator',
    icon: '🛸',
    name: 'Drone Operator',
    desc: 'Drone unit — aerial surveys with video + telemetry for AI road analysis',
  },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState('citizen');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selected = roles.find((r) => r.value === role)!;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError('');
    try {
      // Role-first: the backend verifies the account is registered for the
      // selected role and rejects it otherwise (403 ROLE_MISMATCH).
      const user = await login(email.trim(), password, role);
      if (user.role === 'citizen') navigate('/citizen', { replace: true });
      else if (user.role === 'crew') navigate('/crew', { replace: true });
      else if (user.role === 'drone_operator') navigate('/operator', { replace: true });
      else navigate('/authority', { replace: true });
    } catch (err: any) {
      if (err?.code === 'ROLE_MISMATCH') {
        setError(err.message || 'This account belongs to a different portal.');
      } else {
        setError(err?.message || 'Sign in failed. Check your credentials.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-emerald-400 via-sky-400 to-indigo-500 p-[3px] shadow-lg shadow-indigo-900/50">
            <div className="w-full h-full rounded-[13px] bg-slate-900 flex items-center justify-center text-2xl">
              🛣️
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Sentriroad</h1>
          <p className="text-sm text-slate-400 mt-1.5">Closed-Loop AI for Road Infrastructure Safety</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 sm:p-7 shadow-2xl border border-white/10">
          {/* Step 1 — which portal */}
          <div className="mb-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              I am signing in as…
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Select your role">
              {roles.map((r) => {
                const active = role === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setRole(r.value);
                      setError('');
                    }}
                    className={`relative p-3 rounded-xl border text-center transition-all duration-200 group ${
                      active
                        ? 'bg-indigo-600/25 border-indigo-400/70 shadow-inner'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className={`text-lg mb-1 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
                      {r.icon}
                    </div>
                    <div className={`text-xs font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>
                      {r.name}
                    </div>
                    {active && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center shadow">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
              <span className="text-slate-400">{selected.icon}</span>
              <span key={role} className="animate-[fadeIn_.2s_ease]">
                {selected.desc}. Accounts are locked to the portal they were registered for.
              </span>
            </p>
          </div>

          {/* Step 2 — credentials */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full px-3.5 py-2.5 bg-white/10 border border-white/15 rounded-lg text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full px-3.5 py-2.5 bg-white/10 border border-white/15 rounded-lg text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  Sign in to {selected.name} portal
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/10 text-center">
            <p className="text-sm text-slate-400">
              New citizen?{' '}
              <Link to="/signup" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                Create an account
              </Link>
            </p>
            <p className="text-[11px] text-slate-600 mt-2">
              Authority, crew &amp; drone-operator accounts are provisioned by the municipality.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

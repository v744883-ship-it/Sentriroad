import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    setLoading(true);
    setError('');
    try {
      // Public registration is citizen-only; authority/crew accounts are
      // provisioned by the municipality (server enforces this too).
      await signup({ name, email, password, role: 'citizen', phone: phone || undefined });
      navigate('/citizen', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Signup failed. Please try again.');
    } finally {
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
          <p className="text-sm text-slate-400 mt-1.5">Join as a citizen and help keep roads safe</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 sm:p-7 shadow-2xl border border-white/10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Fixed role notice */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-600/15 border border-indigo-400/30">
              <span className="text-2xl">👤</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">Citizen account</div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  Report road damage and track repairs. Authority &amp; crew accounts are provisioned by the municipality — not self-registered.
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Full name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ravi Kumar"
                autoComplete="name"
                required
                className="w-full px-3.5 py-2.5 bg-white/10 border border-white/15 rounded-lg text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete="new-password"
                required
                minLength={6}
                className="w-full px-3.5 py-2.5 bg-white/10 border border-white/15 rounded-lg text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Phone <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 99000 11122"
                autoComplete="tel"
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
              disabled={loading || !name || !email || !password}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating account…
                </>
              ) : (
                'Create citizen account'
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/10 text-center">
            <p className="text-sm text-slate-400">
              Already registered?{' '}
              <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

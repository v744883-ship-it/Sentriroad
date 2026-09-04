import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { User } from '../types';
import { login as apiLogin, signup as apiSignup, getMe } from '../api/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** Role-first login — the backend rejects a mismatch (403 ROLE_MISMATCH). */
  login: (email: string, password: string, role: string) => Promise<User>;
  signup: (data: { name: string; email: string; password: string; role: string; phone?: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sr_token');
    if (token) {
      getMe()
        .then(setUser)
        .catch(() => localStorage.removeItem('sr_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string, role: string): Promise<User> => {
    const { token, user } = await apiLogin(email, password, role);
    localStorage.setItem('sr_token', token);
    setUser(user);
    return user;
  };

  const signup = async (data: { name: string; email: string; password: string; role: string; phone?: string }) => {
    const { token, user } = await apiSignup(data);
    localStorage.setItem('sr_token', token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('sr_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

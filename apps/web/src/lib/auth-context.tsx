import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { restoreSession, login as apiLogin, logout as apiLogout, type SessionUser } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    restoreSession().then((u) => { setUser(u); setLoading(false); });
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: async (email, password) => setUser(await apiLogin(email, password)),
    signOut: async () => { await apiLogout(); setUser(null); },
    can: (permission) => user?.permissions.includes(permission) ?? false,
    refresh: async () => setUser(await restoreSession()),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

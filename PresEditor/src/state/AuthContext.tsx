import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from '../lib/apiClient';
import { ApiError, type AuthUser } from '../lib/apiClient';
import { toast } from '../lib/toastBus';

interface AuthContextValue {
  user: AuthUser | null;
  // 'loading' while the initial /api/auth/me check is in flight — routes/
  // RequireAuth.tsx waits on this instead of momentarily treating a real
  // session as signed-out and redirecting.
  // 'unreachable': the API couldn't be reached at all (network/server
  // down, or — even in dev — the Vite proxy answering with its own 502/504
  // HTTP error page rather than a network-level fetch rejection), as
  // opposed to a confirmed 401. These must NOT be treated the same: a
  // genuine 401 means "no session, redirect to /signin"; anything else
  // tells us nothing about the session, and treating it as 'anon' would
  // boot an actually-signed-in user out of a cloud editor the instant the
  // API blips (and specifically breaks offline-queue recovery on reload —
  // the reload itself would redirect away before the editor ever mounts to
  // retry). RequireAuth.tsx lets 'unreachable' through rather than
  // redirecting; real authorization is enforced server-side on every
  // /api/projects/* call regardless of what this client-side guard
  // decides, so this is a UX nicety, not a security boundary.
  status: 'loading' | 'anon' | 'authed' | 'unreachable';
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthStateContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed' | 'unreachable'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setStatus('authed');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof ApiError && err.status === 401 ? 'anon' : 'unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const u = await api.signin(email, password);
      setUser(u);
      setStatus('authed');
      toast('Connecté.');
      return true;
    } catch (err: any) {
      toast(err.message || 'Échec de la connexion.', true);
      return false;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    try {
      const u = await api.signup(email, password, displayName);
      setUser(u);
      setStatus('authed');
      toast('Compte créé.');
      return true;
    } catch (err: any) {
      toast(err.message || 'Échec de la création du compte.', true);
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signout();
    } catch {
      /* cookie is cleared client-side regardless below */
    }
    setUser(null);
    setStatus('anon');
    toast('Déconnecté.');
  }, []);

  return (
    <AuthStateContext.Provider value={{ user, status, signIn, signUp, signOut }}>{children}</AuthStateContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthStateContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

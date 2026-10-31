import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

const MeSchema = z.object({ needsConsent: z.boolean(), versions: z.object({ terms: z.string().nullable(), privacy: z.string().nullable() }) });
type Me = z.infer<typeof MeSchema>;
type Auth = { session: Session | null; loading: boolean; me: Me | null; error: Error | null; reload: () => void; signOut: () => Promise<void> };
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<{ token: string; me?: Me; error?: Error } | null>(null);
  const [initialError, setInitialError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) { setSession(next); if (!next) setResult(null); setReady(true); setInitialError(null); }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) { setSession(data.session); setInitialError(error); setReady(true); }
    }).catch((e: Error) => { if (active) { setInitialError(e); setReady(true); } });
    const refresh = (state: string | null | undefined) => { if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh(); };
    refresh(AppState.currentState);
    const listener = AppState.addEventListener('change', refresh);
    return () => { active = false; subscription.unsubscribe(); listener.remove(); supabase.auth.stopAutoRefresh(); };
  }, [restoreAttempt]);
  const token = session?.access_token;
  useEffect(() => {
    let active = true;
    if (!token) return;
    void api<unknown>('/me').then(data => {
      const me = MeSchema.parse(data);
      if (active) setResult({ token, me });
    }).catch((error: unknown) => {
      if (active) setResult({ token, error: error instanceof Error ? error : new Error('Unable to load your account.') });
    });
    return () => { active = false; };
  }, [token, revision]);
  const current = result?.token === token ? result : null;
  const value: Auth = {
    session, loading: !ready || (!!session && !current), me: current?.me ?? null, error: initialError ?? current?.error ?? null,
    reload: () => {
      if (initialError) { setReady(false); setInitialError(null); setRestoreAttempt(n => n + 1); }
      else { setResult(null); setRevision(n => n + 1); }
    },
    signOut: async () => { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error; setInitialError(null); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() { const auth = useContext(Context); if (!auth) throw new Error('AuthProvider is required'); return auth; }

import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSupabase } from '@/lib/supabase/client';

type AuthState =
  | { status: 'loading'; user: null; session: null }
  | { status: 'signed_out'; user: null; session: null }
  | { status: 'signed_in'; user: User; session: Session };

interface AuthContextValue {
  state: AuthState;
  /** True while the user arrived through a recovery/invite link and must set a password. */
  recovery: boolean;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, session: null });
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(data.session ? { status: 'signed_in', user: data.session.user, session: data.session } : { status: 'signed_out', user: null, session: null });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        // Never leave a previous user's clinical data in memory.
        queryClient.clear();
      }
      setState(session ? { status: 'signed_in', user: session.user, session } : { status: 'signed_out', user: null, session: null });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ state, recovery, clearRecovery: () => setRecovery(false) }), [state, recovery]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user; only call beneath a signed-in route. */
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== 'signed_in') throw new Error('useCurrentUser requires a signed-in user');
  return state.user;
}

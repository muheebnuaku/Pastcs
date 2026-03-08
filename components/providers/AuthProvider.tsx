'use client';

import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/store';
import type { User } from '@/types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, setUser, isLoading, setLoading } = useAuthStore();
  const supabase = useMemo(() => createClient(), []);

  /**
   * Fetch the public.users profile for an auth user.
   * If the row doesn't exist yet (e.g. created via Supabase dashboard or a
   * brief race after registration), auto-upsert a default student row.
   * Defined as useCallback so it's stable and can be used outside useEffect.
   */
  // Fetch the public.users profile for an auth user.
  // The DB trigger (on_auth_user_created) creates the row automatically on
  // signup, so we only SELECT here. A single retry handles the rare case where
  // the trigger hasn't fully committed before this fires.
  const fetchOrCreateUser = useCallback(
    async (authUser: { id: string }) => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (data) return data;

      // Retry once after a short delay (trigger may still be committing)
      await new Promise((r) => setTimeout(r, 300));
      const { data: retried } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      return retried;
    },
    [supabase]
  );

  // On mount: restore session and subscribe to auth events
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(await fetchOrCreateUser(session.user));
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    init();

    // Handle token refresh and sign-in from other tabs
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          // Only update if user isn't already set (avoids redundant fetch after
          // signIn/signUp which already sets the user directly)
          const current = useAuthStore.getState().user;
          if (!current || current.id !== session.user.id) {
            setLoading(true);
            setUser(await fetchOrCreateUser(session.user));
            setLoading(false);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Keep profile data in sync on token refresh
          const current = useAuthStore.getState().user;
          if (!current) {
            setUser(await fetchOrCreateUser(session.user));
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, setUser, setLoading, fetchOrCreateUser]);

  /**
   * Sign in and immediately set the user before returning.
   * This ensures the dashboard layout sees user != null as soon as
   * the caller calls router.replace('/dashboard').
   */
  const signIn = async (email: string, password: string) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);
      return { error: error.message };
    }

    // Fetch session directly to guarantee user is set before caller navigates
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(await fetchOrCreateUser(session.user));
    }
    setLoading(false);
    return {};
  };

  /**
   * Register via admin API then sign in, setting user before returning.
   */
  const signUp = async (email: string, password: string, fullName: string) => {
    setLoading(true);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName }),
    });

    const resData = await res.json();
    if (!res.ok) {
      setLoading(false);
      return { error: resData.error ?? 'Registration failed' };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setLoading(false);
      return { error: signInError.message };
    }

    // Fetch session directly to guarantee user is set before caller navigates
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(await fetchOrCreateUser(session.user));
    }
    setLoading(false);
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(await fetchOrCreateUser(session.user));
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

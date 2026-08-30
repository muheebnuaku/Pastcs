'use client';

import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore, useSubscriptionStore } from '@/lib/store';
import { triggerNotifications } from '@/lib/hooks/useNotifications';
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
  const router = useRouter();

  const fetchOrCreateUser = useCallback(
    async (authUser: { id: string; email?: string; user_metadata?: Record<string, string> }) => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (data) return data;

      // Profile row missing — create it (handles existing auth users + race conditions)
      const { data: created } = await supabase
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email ?? '',
          full_name: authUser.user_metadata?.full_name ?? null,
          role: (authUser.user_metadata?.role as 'student' | 'admin') ?? 'student',
        })
        .select()
        .single();

      return created;
    },
    [supabase]
  );

  /** Fetch active subscriptions and sync into Zustand store */
  const fetchSubscriptions = useCallback(
    async (userId: string) => {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');
      useSubscriptionStore.getState().setSubscriptions(data ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userData = await fetchOrCreateUser(session.user);
          setUser(userData);
          if (userData) {
            await fetchSubscriptions(userData.id);
            triggerNotifications(userData).catch(() => {});
          }
        } else {
          setUser(null);
          useSubscriptionStore.getState().setSubscriptions([]);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const current = useAuthStore.getState().user;
          if (!current || current.id !== session.user.id) {
            setLoading(true);
            const userData = await fetchOrCreateUser(session.user);
            setUser(userData);
            if (userData) await fetchSubscriptions(userData.id);
            setLoading(false);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          useSubscriptionStore.getState().setSubscriptions([]);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          const current = useAuthStore.getState().user;
          if (!current) {
            const userData = await fetchOrCreateUser(session.user);
            setUser(userData);
            if (userData) await fetchSubscriptions(userData.id);
          }
        } else if (event === 'PASSWORD_RECOVERY') {
          // Supabase can land a recovery link's #access_token on whatever
          // page its dashboard-configured Site URL points to (e.g. the
          // homepage) rather than /reset-password, if that exact path
          // isn't in the project's Redirect URLs allow list. This client
          // is mounted on every page, so wherever the token lands, catch
          // the event here and route to the form that can actually use it.
          if (window.location.pathname !== '/reset-password') {
            router.replace('/reset-password');
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, setUser, setLoading, fetchOrCreateUser, fetchSubscriptions, router]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);
      return { error: error.message };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const userData = await fetchOrCreateUser(session.user);
      setUser(userData);
      if (userData) await fetchSubscriptions(userData.id);
    }
    setLoading(false);
    return {};
  };

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

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const userData = await fetchOrCreateUser(session.user);
      setUser(userData);
      useSubscriptionStore.getState().setSubscriptions([]);
    }
    setLoading(false);
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    useSubscriptionStore.getState().setSubscriptions([]);
  };

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const userData = await fetchOrCreateUser(session.user);
      setUser(userData);
      if (userData) await fetchSubscriptions(userData.id);
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

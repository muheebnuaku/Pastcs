'use client';

import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore, useSubscriptionStore } from '@/lib/store';
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

  const fetchOrCreateUser = useCallback(
    async (authUser: { id: string }) => {
      const { data } = await supabase
        .from('user_public')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (data) return data;

      await new Promise((r) => setTimeout(r, 300));
      const { data: retried } = await supabase
        .from('user_public')
        .select('*')
        .eq('id', authUser.id)
        .single();

      return retried;
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
          if (userData) await fetchSubscriptions(userData.id);
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
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, setUser, setLoading, fetchOrCreateUser, fetchSubscriptions]);

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

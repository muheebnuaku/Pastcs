'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
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

  useEffect(() => {
    // Fetch existing profile row, or auto-create one if missing (e.g. account created
    // via Supabase dashboard or registration race condition). This prevents a null DB
    // user from being mistaken as "not logged in" and redirecting back to /login.
    const fetchOrCreateUser = async (authUser: {
      id: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
    }) => {
      const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (existing) return existing;

      // No profile row — upsert a default one so auth state resolves correctly
      const fullName =
        (authUser.user_metadata?.full_name as string) ??
        authUser.email?.split('@')[0] ??
        null;

      const { data: created } = await supabase
        .from('users')
        .upsert({
          id: authUser.id,
          email: authUser.email ?? '',
          full_name: fullName,
          role: 'student',
        })
        .select()
        .single();

      return created;
    };

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setLoading(true);
          setUser(await fetchOrCreateUser(session.user));
          setLoading(false);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, setUser, setLoading]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      return { error: error.message };
    }

    return {};
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    setLoading(true);
    // Use admin API route to create user with email pre-confirmed
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName }),
    });

    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      return { error: data.error ?? 'Registration failed' };
    }

    // Sign in immediately — no email confirmation needed
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setLoading(false);
      return { error: signInError.message };
    }

    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();
      setUser(userData);
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

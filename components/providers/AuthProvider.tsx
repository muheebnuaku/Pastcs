'use client';

import { createContext, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore, useSubscriptionStore } from '@/lib/store';
import { triggerNotifications } from '@/lib/hooks/useNotifications';
import type { User } from '@/types';

// Program/student ID are now collected on the registration form itself
// (see app/register/page.tsx) instead of a separate post-signup step —
// programId is set when an existing program was picked from the list,
// customProgram when the student typed their own because it wasn't
// listed (see the register API route for how each is stored).
interface SignUpOptions {
  referralCode?: string;
  studentId?: string;
  programId?: string;
  customProgram?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string, options?: SignUpOptions) => Promise<{ error?: string; needsConfirmation?: boolean; emailSent?: boolean }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Deliberately generic — never confirms to whoever's logging in that
// this specific account was flagged as suspended, which would just tell
// a bad actor to go make another one instead.
const SUSPENDED_MESSAGE = 'Account not found or invalid credentials.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, setUser, isLoading, setLoading } = useAuthStore();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  // signInWithPassword's own success triggers a SIGNED_IN auth-state
  // event, which the onAuthStateChange listener below ALSO handles
  // (needed for the "already logged-in session gets suspended
  // mid-use" case). Both signIn() and that listener independently call
  // fetchOrCreateUser() + check is_suspended for the exact same event —
  // a real race: whichever finishes first "wins", and the listener
  // signing the session back out mid-flight could make signIn()'s own
  // getSession() call come back empty, silently skipping its
  // suspension check and returning success. This flag makes signIn()
  // the sole authority while it's actively running; the listener still
  // covers every other case (page load, token refresh, another tab).
  const isSigningInRef = useRef(false);

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

  /** Fetch active subscriptions + semester access windows and sync into Zustand store */
  const fetchSubscriptions = useCallback(
    async (userId: string) => {
      const [{ data: subs }, { data: terms }] = await Promise.all([
        supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active'),
        // Small, platform-wide table (a couple of rows per program) —
        // fetching all of it is simpler than scoping to just this
        // student's program, and hasActiveSub already filters by
        // program_id when it looks a term up.
        supabase.from('semester_end_dates').select('*'),
      ]);
      useSubscriptionStore.getState().setSubscriptions(subs ?? []);
      useSubscriptionStore.getState().setSemesterEndDates(terms ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userData = await fetchOrCreateUser(session.user);
          // Covers a session that was already valid when the account got
          // suspended — caught here on next load, not just at the next
          // fresh login attempt.
          if (userData?.is_suspended) {
            await supabase.auth.signOut();
            setUser(null);
            useSubscriptionStore.getState().setSubscriptions([]);
            router.replace('/login?blocked=1');
            return;
          }
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
          // signIn() below is already handling this exact sign-in
          // (including its own suspension check) — deferring here
          // avoids the race described above.
          if (isSigningInRef.current) return;
          const current = useAuthStore.getState().user;
          if (!current || current.id !== session.user.id) {
            setLoading(true);
            const userData = await fetchOrCreateUser(session.user);
            if (userData?.is_suspended) {
              await supabase.auth.signOut();
              setUser(null);
              useSubscriptionStore.getState().setSubscriptions([]);
              setLoading(false);
              router.replace('/login?blocked=1');
              return;
            }
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
    isSigningInRef.current = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // GoTrue's own wording for this is already clear, but doesn't
        // mention that a confirmation email was sent — worth spelling
        // out since this is a brand-new check nobody's used to yet.
        if (error.message.toLowerCase().includes('email not confirmed')) {
          return { error: 'Please confirm your email first — check your inbox (and spam folder) for the link we sent when you signed up.' };
        }
        return { error: error.message };
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const userData = await fetchOrCreateUser(session.user);
        if (userData?.is_suspended) {
          await supabase.auth.signOut();
          return { error: SUSPENDED_MESSAGE };
        }
        setUser(userData);
        if (userData) await fetchSubscriptions(userData.id);
      }
      return {};
    } finally {
      isSigningInRef.current = false;
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, fullName: string, options?: SignUpOptions) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          fullName,
          referralCode: options?.referralCode,
          studentId: options?.studentId,
          programId: options?.programId,
          customProgram: options?.customProgram,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        return { error: resData.error ?? 'Registration failed' };
      }

      // The account is created but unconfirmed — signing in now would
      // just fail with "Email not confirmed" (or worse, silently succeed
      // if confirmation isn't actually enforced, defeating the whole
      // point). Confirming the address is what happens next, via the
      // link the register route just asked Supabase to send.
      return { needsConfirmation: true, emailSent: resData.emailSent !== false };
    } finally {
      setLoading(false);
    }
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

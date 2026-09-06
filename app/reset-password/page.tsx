'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';
import { Home, KeyRound, CheckCircle, AlertTriangle } from 'lucide-react';

// Shared ssr-backed browser client — same one AuthProvider uses. A raw
// @supabase/supabase-js client here would read/write a different storage
// backend (localStorage) than the app's cookie-backed session, so a
// recovery session detected elsewhere (e.g. AuthProvider catching the
// PASSWORD_RECOVERY event on another page) wouldn't be visible here.
const supabase = createClient();
// The installed @supabase/ssr (0.1.0) re-exports type paths from an old
// @supabase/supabase-js layout that no longer exists in the installed
// 2.x, which corrupts its own generic return type and hides real methods
// (updateUser included) from TS. It exists at runtime — this narrows
// just the `.auth` surface this page needs to call it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auth = supabase.auth as any;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setSessionReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
    } else {
      setDone(true);
      setTimeout(() => router.replace('/login'), 3000);
    }
    setSubmitting(false);
  };

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#16140f] px-4">
        <div className="w-full max-w-md text-center">
          <div className="bg-white dark:bg-white/[0.04] rounded-2xl shadow-sm border border-gray-200 dark:border-white/10 p-8 space-y-4">
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-500/15 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">Invalid or expired link</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This reset link is invalid or has expired. Please request a new one.
            </p>
            <Link href="/forgot-password" className="inline-block text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
              Request new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#16140f] px-4">
      <Link
        href="/"
        className="fixed top-4 left-4 z-50 flex items-center gap-2 bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 rounded-full px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
      >
        <Home className="w-4 h-4" />
        Home
      </Link>

      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Set new password</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Choose a strong password for your account</p>
        </div>

        <div className="bg-white dark:bg-white/[0.04] rounded-2xl shadow-sm border border-gray-200 dark:border-white/10 p-8">
          {done ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">Password updated!</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Redirecting you to login…</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                autoComplete="new-password"
              />
              <Input
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                required
                autoComplete="new-password"
              />

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" isLoading={submitting} disabled={submitting}>
                Update Password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { CheckCircle, AlertTriangle, Loader2, Home } from 'lucide-react';

// Where the confirmation email's link (see app/api/auth/register/route.ts's
// emailRedirectTo) actually lands — without this, clicking "Confirm your
// mail" silently dropped straight into /dashboard with no acknowledgement
// that anything just happened. The session itself gets established the
// same way password recovery already does (an implicit-flow #access_token
// fragment picked up by the same global Supabase client AuthProvider uses)
// — this page just waits for that and shows something for it.
export default function EmailConfirmedPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isLoading && user) {
      const t = setTimeout(() => router.replace('/dashboard'), 1800);
      return () => clearTimeout(t);
    }
  }, [user, isLoading, router]);

  const failed = !isLoading && !user && timedOut;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#16140f] px-4">
      <Link
        href="/"
        className="fixed top-4 left-4 z-50 flex items-center gap-2 bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 rounded-full px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 shadow-sm hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
      >
        <Home className="w-4 h-4" />
        Home
      </Link>

      <div className="w-full max-w-md text-center">
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl shadow-sm border border-gray-200 dark:border-white/10 p-8 space-y-4">
          {failed ? (
            <>
              <div className="w-14 h-14 bg-amber-100 dark:bg-amber-500/15 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Link invalid or expired</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This confirmation link didn&rsquo;t work — it may have already been used, or it&rsquo;s expired. Try signing in directly; if your account still isn&rsquo;t confirmed, contact support.
              </p>
              <Link href="/login" className="inline-block text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
                Go to sign in
              </Link>
            </>
          ) : !isLoading && user ? (
            <>
              <div className="w-14 h-14 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Email confirmed!</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Your account is active. Taking you to your dashboard…
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-gray-100 dark:bg-white/10 rounded-full flex items-center justify-center mx-auto">
                <Loader2 className="w-7 h-7 text-gray-400 dark:text-gray-500 animate-spin" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Confirming your email…</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">This should only take a moment.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

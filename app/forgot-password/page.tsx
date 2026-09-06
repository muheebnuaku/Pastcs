'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { Button, Input } from '@/components/ui';
import { Home, Mail, ArrowLeft, CheckCircle } from 'lucide-react';

// Deliberately NOT the shared ssr/cookie client: that one is configured
// for the PKCE flow (see lib/supabase/client.ts), which ties the reset
// link's code_verifier to this browser's storage — breaking the very
// common case of requesting a reset here and opening the email on a
// different device. The plain client below defaults to the implicit
// flow, whose link is a self-contained token any device can open.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const origin = window.location.hostname === 'localhost'
      ? 'https://www.pastcs.com'
      : window.location.origin;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });

    if (resetError) {
      const msg = resetError.message.toLowerCase();
      if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('exceeded')) {
        setError('Too many reset requests. Please wait a few minutes before trying again.');
      } else {
        setError(resetError.message);
      }
    } else {
      setSent(true);
    }
    setSubmitting(false);
  };

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
            <Mail className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Forgot your password?</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Enter your email and we&apos;ll send a reset link</p>
        </div>

        <div className="bg-white dark:bg-white/[0.04] rounded-2xl shadow-sm border border-gray-200 dark:border-white/10 p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">Check your inbox</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  We sent a password reset link to <strong>{email}</strong>.
                  Check your spam folder if you don&apos;t see it.
                </p>
              </div>
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                required
                autoComplete="email"
              />

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" isLoading={submitting} disabled={submitting}>
                Send Reset Link
              </Button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

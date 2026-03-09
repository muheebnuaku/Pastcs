'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { useAuthStore } from '@/lib/store';
import { Button, Input } from '@/components/ui';
import Image from 'next/image';
import { Home } from 'lucide-react';

// This email belongs to an admin account but should always land on the
// student dashboard rather than the admin panel.
const STUDENT_REDIRECT_EMAILS = ['kwabenacrys@gmail.com'];

function shouldGoToAdmin(email: string | undefined, role: string | undefined) {
  if (!email || !role) return false;
  return role === 'admin' && !STUDENT_REDIRECT_EMAILS.includes(email.toLowerCase());
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already logged in — redirect based on role (with email exception)
  useEffect(() => {
    if (!isLoading && user) {
      router.replace(shouldGoToAdmin(user.email, user.role) ? '/admin' : '/dashboard');
    }
  }, [user, isLoading, router]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const result = await signIn(email, password);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      const loggedInUser = useAuthStore.getState().user;
      router.replace(
        shouldGoToAdmin(loggedInUser?.email, loggedInUser?.role) ? '/admin' : '/dashboard'
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      {/* Floating home button */}
      <Link
        href="/"
        className="fixed top-4 left-4 z-50 flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Home</span>
      </Link>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/past.png" alt="PastCS" width={160} height={160} className="w-28 h-28 sm:w-36 sm:h-36 rounded-full object-contain mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
          <p className="text-gray-500 mt-1">Sign in to your PastCS account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
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

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              isLoading={submitting}
              disabled={submitting}
            >
              Sign In
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-blue-600 font-medium hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

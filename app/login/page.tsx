'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/providers';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui';
import { Home, Mail, Lock, Eye, EyeOff, ArrowRight, BookOpen, Target, Trophy } from 'lucide-react';
import { isAdminRole } from '@/lib/utils';

// This email belongs to an admin account but should always land on the
// student dashboard rather than the admin panel.
const STUDENT_REDIRECT_EMAILS = ['kwabenacrys@gmail.com'];

function shouldGoToAdmin(email: string | undefined, role: string | undefined) {
  if (!email || !role) return false;
  return isAdminRole(role) && !STUDENT_REDIRECT_EMAILS.includes(email.toLowerCase());
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already logged in — redirect based on role (with email exception)
  useEffect(() => {
    if (!isLoading && user) {
      router.replace(shouldGoToAdmin(user.email, user.role) ? '/admin' : '/dashboard');
    }
  }, [user, isLoading, router]);

  // AuthProvider lands here with ?blocked=1 when a session that was
  // already active gets suspended — same generic wording as a failed
  // login attempt, deliberately (see AuthProvider's SUSPENDED_MESSAGE).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('blocked')) {
      setError('Account not found or invalid credentials.');
    }
  }, []);

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
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] flex">
      {/* Floating home button */}
      <Link
        href="/"
        className="fixed top-4 left-4 z-50 flex items-center gap-2 bg-white border border-[#efe2d0] rounded-full px-3 py-2 text-sm font-medium text-[#8a7f6f] shadow-sm hover:bg-[#f7ede1] hover:text-[#2b2420] transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Home</span>
      </Link>

      {/* ── Brand panel — desktop only ── */}
      <div
        className="hidden lg:flex lg:w-[46%] relative overflow-hidden items-center justify-center p-12"
        style={{ background: 'linear-gradient(135deg, #e8603c 0%, #dba514 100%)' }}
      >
        {/* Floating decorative blobs */}
        <div className="animate-float absolute w-64 h-64 rounded-full bg-white/10 blur-2xl -top-10 -left-10" />
        <div className="animate-float delay-300 absolute w-80 h-80 rounded-full bg-[#2f9e8f]/25 blur-2xl -bottom-16 -right-10" />
        <div className="animate-float delay-500 absolute w-40 h-40 rounded-full bg-white/10 blur-xl top-1/3 right-10" />

        <div className="relative max-w-sm">
          <div className="animate-fade-in-up inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm px-3.5 py-1.5 rounded-full mb-6">
            <Image src="/past.png" alt="PastCS" width={20} height={20} className="rounded-full object-cover" />
            <span className="text-sm font-semibold text-white">PastCS</span>
          </div>

          <h2 className="animate-fade-in-up delay-100 text-3xl font-extrabold text-white leading-tight mb-4">
            Practice like the exam already happened.
          </h2>
          <p className="animate-fade-in-up delay-200 text-white/85 leading-relaxed mb-10">
            Sign back in to pick up your streak, review what you got wrong, and keep closing the gap before test day.
          </p>

          {/* Floating feature chips */}
          <div className="space-y-3">
            {[
              { icon: BookOpen, label: '1000+ practice questions', delay: 'delay-300' },
              { icon: Target, label: 'Timed exam simulations', delay: 'delay-400' },
              { icon: Trophy, label: 'Course leaderboards', delay: 'delay-500' },
            ].map(({ icon: Icon, label, delay }) => (
              <div
                key={label}
                className={`animate-fade-in-up ${delay} animate-float flex items-center gap-3 bg-white/12 backdrop-blur-sm border border-white/20 rounded-2xl px-4 py-3`}
              >
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-[18px] h-[18px] text-white" />
                </div>
                <span className="text-sm font-semibold text-white">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex-1 flex items-center justify-center px-4 py-16 sm:py-20">
        <div className="w-full max-w-md">
          <div className="animate-fade-in-up text-center mb-6 sm:mb-8">
            <Link href="/" className="inline-flex items-center gap-2 mb-5 sm:mb-6">
              <Image src="/past.png" alt="PastCS" width={40} height={40} className="w-10 h-10 rounded-full object-cover" />
              <span className="font-extrabold text-[#2b2420] text-xl">PastCS</span>
            </Link>
            <h1 className="text-2xl font-extrabold text-[#2b2420]">Welcome back</h1>
            <p className="text-[#8a7f6f] mt-1">Sign in to your PastCS account</p>
          </div>

          <div className="animate-fade-in-up delay-100 bg-[#fffdf9] rounded-[28px] shadow-xl border border-[#efe2d0] p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#2b2420] mb-1.5">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-2.5 text-base border border-[#e8dcc8] rounded-xl bg-white text-[#2b2420] placeholder:text-[#c2b5a0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e8603c] focus:border-[#e8603c]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-[#2b2420]">Password</label>
                  <Link href="/forgot-password" className="text-xs font-medium text-[#e8603c] hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full pl-10 pr-11 py-2.5 text-base border border-[#e8dcc8] rounded-xl bg-white text-[#2b2420] placeholder:text-[#c2b5a0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e8603c] focus:border-[#e8603c]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#a89a86] hover:text-[#2b2420] hover:bg-[#f7ede1] transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="animate-fade-in p-3 rounded-xl bg-[#fde3da] border border-[#f5c4b0]">
                  <p className="text-sm text-[#c94f2f] font-medium">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full rounded-2xl shadow-[0_10px_24px_-8px_rgba(232,96,60,0.45)]"
                isLoading={submitting}
                disabled={submitting}
              >
                {!submitting && (
                  <>
                    Sign In
                    <ArrowRight className="w-[18px] h-[18px] ml-2" />
                  </>
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-[#8a7f6f] mt-6">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-[#e8603c] font-semibold hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

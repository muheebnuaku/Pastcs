'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui';
import { Home, User, Mail, Lock, Eye, EyeOff, Gift, Check, ArrowRight, BookOpen, Target, Trophy } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const { signUp, user, isLoading } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already logged in — go to dashboard
  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  // Pick up a shared referral link, e.g. pastcs.com/register?ref=A3F9C21B
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReferralCode(ref.toUpperCase());
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const result = await signUp(email, password, fullName, referralCode.trim() || undefined);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      router.replace('/dashboard');
    }
  };

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

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
            Join students already using a growing question bank, timed mock exams, and an AI tutor that explains what you got wrong.
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
            <h1 className="text-2xl font-extrabold text-[#2b2420]">Create your account</h1>
            <p className="text-[#8a7f6f] mt-1">Join PastCS and start practising</p>
          </div>

          <div className="animate-fade-in-up delay-100 bg-[#fffdf9] rounded-[28px] shadow-xl border border-[#efe2d0] p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#2b2420] mb-1.5">Full name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Kwame Mensah"
                    required
                    autoComplete="name"
                    className="w-full pl-10 pr-4 py-2.5 text-base border border-[#e8dcc8] rounded-xl bg-white text-[#2b2420] placeholder:text-[#c2b5a0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e8603c] focus:border-[#e8603c]"
                  />
                </div>
              </div>

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
                <label className="block text-sm font-semibold text-[#2b2420] mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                    autoComplete="new-password"
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

              <div>
                <label className="block text-sm font-semibold text-[#2b2420] mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="new-password"
                    className="w-full pl-10 pr-11 py-2.5 text-base border border-[#e8dcc8] rounded-xl bg-white text-[#2b2420] placeholder:text-[#c2b5a0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e8603c] focus:border-[#e8603c]"
                  />
                  {passwordsMatch ? (
                    <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#2f9e8f]" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      tabIndex={-1}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#a89a86] hover:text-[#2b2420] hover:bg-[#f7ede1] transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#2b2420] mb-1.5">Referral code <span className="font-normal text-[#a89a86]">(optional)</span></label>
                <div className="relative">
                  <Gift className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#a89a86]" />
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A3F9C21B"
                    className="w-full pl-10 pr-4 py-2.5 text-base border border-[#e8dcc8] rounded-xl bg-white text-[#2b2420] placeholder:text-[#c2b5a0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#e8603c] focus:border-[#e8603c]"
                  />
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
                    Create Account
                    <ArrowRight className="w-[18px] h-[18px] ml-2" />
                  </>
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-[#8a7f6f] mt-6">
              Already have an account?{' '}
              <Link href="/login" className="text-[#e8603c] font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

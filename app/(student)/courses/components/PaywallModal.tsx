'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Button } from '@/components/ui';
import { Lock, X, CheckCircle, XCircle, Loader2, ShieldCheck, Users } from 'lucide-react';
import type { Subscription } from '@/types';

interface Props {
  courseName: string;
  courseCode: string;
  totalCourses: number;
  onClose: () => void;
  onSuccess: () => void;
  /** What to unlock, when it isn't the student's own selected level (e.g. a classroom's course). */
  level?: number;
  semester?: number;
  /** Replaces the default heading/blurb, e.g. "Unlock to join Kenny's classroom". */
  heading?: string;
  blurb?: string;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PaystackPop: any;
  }
}

interface Quote {
  amount: number;
  fullAmount: number;
  deal: { classroomName: string; paidCount: number; needed: number; percent: number; active: boolean } | null;
}

function ghc(pesewas: number): string {
  const cedis = pesewas / 100;
  return `GHC ${Number.isInteger(cedis) ? cedis : cedis.toFixed(2)}`;
}

export function PaywallModal({ totalCourses, onClose, onSuccess, level: levelProp, semester: semesterProp, heading, blurb }: Props) {
  const { user } = useAuth();
  const level = levelProp ?? user?.selected_level ?? undefined;
  const semester = semesterProp ?? user?.selected_semester ?? undefined;
  const { addSubscription } = useSubscriptionStore();
  const [isVerifying, setIsVerifying] = useState(false);
  const [paymentClosed, setPaymentClosed] = useState(false);
  const [error, setError] = useState('');
  const { amountPesewas: listAmount } = usePricing(level, user?.program_id);

  // The exact amount to charge comes from the server (/api/payments/quote),
  // which also applies any class deal — and verification checks the charge
  // against the same rule, so the two can never disagree.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(levelProp && semesterProp ? `/api/payments/quote?level=${levelProp}&semester=${semesterProp}` : '/api/payments/quote')
      .then(async r => ({ ok: r.ok, data: await r.json() as Quote & { error?: string } }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok && typeof data.amount === 'number') setQuote(data);
        else setQuoteError(data.error || 'Could not load the price. Please try again.');
      })
      .catch(() => { if (!cancelled) setQuoteError('Could not load the price. Check your connection.'); });
    return () => { cancelled = true; };
  }, [levelProp, semesterProp]);
  const priceAmount = quote?.amount ?? listAmount;
  const priceLabel = ghc(priceAmount);

  // Portal to <body> — see Modal.tsx: rendering inline under a page that
  // uses .animate-fade-in breaks `position: fixed` (its `both` fill-mode
  // leaves a transform applied forever, which makes that ancestor the
  // containing block for fixed descendants instead of the viewport).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Load Paystack script on mount
  useEffect(() => {
    if (window.PaystackPop) return;
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.head.appendChild(script);
    return () => {
      // leave the script in DOM so it's available throughout the session
    };
  }, []);

  const handlePaymentSuccess = async (reference: string) => {
    setIsVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference,
          level,
          semester,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const newSub: Subscription = {
          id: Date.now().toString(),
          user_id: user!.id,
          level: level!,
          semester: semester!,
          program_id: user?.program_id ?? null,
          payment_reference: reference,
          amount: priceAmount,
          status: 'active',
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        addSubscription(newSub);
        onSuccess();
        onClose();
      } else {
        setError(data.error ?? 'Payment verification failed. Please contact support.');
      }
    } catch {
      setError('Could not verify payment. Please contact support.');
    } finally {
      setIsVerifying(false);
    }
  };

  const openPaystack = () => {
    if (!user || !quote) return;
    setPaymentClosed(false);
    setError('');

    const trigger = () => {
      const ref = `pastcs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: quote.amount,
        currency: 'GHS',
        ref,
        metadata: {
          userId: user.id,
          level,
          semester,
        },
        callback: (response: { reference: string }) => {
          handlePaymentSuccess(response.reference);
        },
        onClose: () => {
          setPaymentClosed(true);
        },
      });
      handler.openIframe();
    };

    if (window.PaystackPop) {
      trigger();
    } else {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.onload = trigger;
      document.head.appendChild(script);
    }
  };

  const lockedCount = Math.max(0, totalCourses - 1);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 py-8 sm:py-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto dark:bg-[#1c1a15] dark:border dark:border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-0">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-500/15 rounded-xl flex items-center justify-center">
            <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors dark:hover:bg-white/10"
          >
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1 dark:text-gray-100">{heading ?? 'Unlock every course'}</h2>
          <p className="text-gray-500 text-sm mb-5 dark:text-gray-400">
            {blurb ?? `One payment opens ${totalCourses > 0 ? `all ${totalCourses}` : 'every'} Level ${level} course${totalCourses > 1 ? 's' : ''} for this semester.`}
          </p>

          {/* Comparison */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 dark:bg-white/[0.03] dark:border-white/10">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 dark:text-gray-400">Free</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  1 course
                </li>
                <li className="flex items-start gap-2 text-gray-400 dark:text-gray-500">
                  <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {totalCourses > 0 ? `${lockedCount} other course${lockedCount === 1 ? '' : 's'}` : 'Every other course'}
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-500/10 rounded-2xl p-4 border-2 border-blue-200 dark:border-blue-500/30">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">Full access</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  {totalCourses > 0 ? `All ${totalCourses} courses` : 'Every course'}
                </li>
                <li className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  Mock exams in each
                </li>
                <li className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  Whole semester
                </li>
              </ul>
            </div>
          </div>

          {/* Price */}
          <div className="text-center bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 mb-3">
            {quote?.deal?.active && (
              <p className="text-blue-200 text-sm line-through">{ghc(quote.fullAmount)}</p>
            )}
            <p className="text-3xl font-bold text-white">{quote ? priceLabel : '…'}</p>
            <p className="text-blue-100 text-sm mt-1">one payment · this semester · all courses</p>
          </div>

          {quote?.deal && (
            <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 mb-3 text-sm ${
              quote.deal.active
                ? 'bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
            }`}>
              <Users className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {quote.deal.active
                  ? <>Class deal: <strong>{quote.deal.percent}% off</strong>, because {quote.deal.paidCount} classmates in {quote.deal.classroomName} have unlocked.</>
                  : <>Class deal: when <strong>{quote.deal.needed} more</strong> {quote.deal.needed === 1 ? 'classmate' : 'classmates'} in {quote.deal.classroomName} unlock, everyone else gets {quote.deal.percent}% off.</>}
              </span>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-5 dark:text-gray-400">
            <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
            <span>Secure checkout by Paystack — Mobile Money or card</span>
          </div>

          {(error || quoteError) && (
            <p className="text-sm text-red-500 dark:text-red-400 mb-4 text-center">{error || quoteError}</p>
          )}

          {paymentClosed && !error && (
            <p className="text-xs text-gray-400 text-center mb-3 dark:text-gray-500">
              You can unlock anytime — your progress in the free course is always saved.
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={openPaystack}
            disabled={isVerifying || !quote}
          >
            {!quote && !quoteError ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading price…
              </>
            ) : isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying payment…
              </>
            ) : (
              `Pay ${priceLabel} & unlock`
            )}
          </Button>

          <button
            onClick={onClose}
            className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-400"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

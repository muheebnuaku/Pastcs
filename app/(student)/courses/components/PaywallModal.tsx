'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { Button } from '@/components/ui';
import { Lock, X, CheckCircle, XCircle, Loader2, Users } from 'lucide-react';
import type { Subscription } from '@/types';

interface Props {
  courseName: string;
  courseCode: string;
  totalCourses: number;
  onClose: () => void;
  onSuccess: () => void;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PaystackPop: any;
  }
}

export function PaywallModal({ courseName, courseCode, totalCourses, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const { addSubscription } = useSubscriptionStore();
  const [isVerifying, setIsVerifying] = useState(false);
  const [paymentClosed, setPaymentClosed] = useState(false);
  const [error, setError] = useState('');
  const { amountPesewas: priceAmount, label: priceLabel } = usePricing(user?.selected_level);

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
          level: user?.selected_level,
          semester: user?.selected_semester,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const newSub: Subscription = {
          id: Date.now().toString(),
          user_id: user!.id,
          level: user!.selected_level!,
          semester: user!.selected_semester!,
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
    if (!user) return;
    setPaymentClosed(false);
    setError('');

    const trigger = () => {
      const ref = `pastcs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: priceAmount,
        currency: 'GHS',
        ref,
        metadata: {
          userId: user.id,
          level: user.selected_level,
          semester: user.selected_semester,
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

  const freeCount = 1;
  const lockedCount = totalCourses - freeCount;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 py-8 sm:py-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto dark:bg-white/[0.04]">
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
          <h2 className="text-xl font-bold text-gray-900 mb-1 dark:text-gray-100">Unlock Full Access</h2>
          <p className="text-gray-500 text-sm mb-6 dark:text-gray-400">
            You&rsquo;re trying to open <strong className="text-gray-800 dark:text-gray-200">{courseCode} — {courseName}</strong>
          </p>

          {/* Comparison table */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 dark:bg-white/[0.03] dark:border-white/10">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 dark:text-gray-400">Free</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  1 course
                </li>
                <li className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {lockedCount} more courses
                </li>
                <li className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  Exam practice
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-500/10 rounded-2xl p-4 border-2 border-blue-200 dark:border-blue-500/30">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-3">Full Access</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  All {totalCourses} courses
                </li>
                <li className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  Exam simulations
                </li>
                <li className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  Progress tracking
                </li>
              </ul>
            </div>
          </div>

          {/* Price + anchoring */}
          <div className="text-center bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-center gap-2">
              <p className="text-3xl font-bold text-white">{priceLabel}</p>
            </div>
            <p className="text-blue-200 text-sm mt-1">this semester — invest in your grades</p>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-5 dark:text-gray-400">
            <Users className="w-4 h-4 text-blue-500" />
            <span>200+ students already unlocked Level {user?.selected_level} access</span>
          </div>

          {error && (
            <p className="text-sm text-red-500 mb-4 text-center">{error}</p>
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
            disabled={isVerifying}
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying payment…
              </>
            ) : (
              `Unlock Now — ${priceLabel}`
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

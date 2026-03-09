'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
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
          payment_reference: reference,
          amount: 5000,
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
        amount: 5000, // GHC 50 = 5000 pesewas
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-0">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Lock className="w-5 h-5 text-blue-600" />
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Unlock Full Access</h2>
          <p className="text-gray-500 text-sm mb-6">
            You&rsquo;re trying to open <strong className="text-gray-800">{courseCode} — {courseName}</strong>
          </p>

          {/* Comparison table */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Free</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-gray-700">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  1 course
                </li>
                <li className="flex items-center gap-2 text-gray-400">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {lockedCount} more courses
                </li>
                <li className="flex items-center gap-2 text-gray-400">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  Exam practice
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 rounded-2xl p-4 border-2 border-blue-200">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">Full Access</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-gray-700">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  All {totalCourses} courses
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  Exam simulations
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  Progress tracking
                </li>
              </ul>
            </div>
          </div>

          {/* Price + anchoring */}
          <div className="text-center bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 mb-4">
            <p className="text-3xl font-bold text-white mb-1">GHC 50</p>
            <p className="text-blue-200 text-sm">this semester — invest in your grades</p>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-5">
            <Users className="w-4 h-4 text-blue-500" />
            <span>200+ students already unlocked Level {user?.selected_level} access</span>
          </div>

          {error && (
            <p className="text-sm text-red-500 mb-4 text-center">{error}</p>
          )}

          {paymentClosed && !error && (
            <p className="text-xs text-gray-400 text-center mb-3">
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
              'Unlock Now — GHC 50'
            )}
          </Button>

          <button
            onClick={onClose}
            className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

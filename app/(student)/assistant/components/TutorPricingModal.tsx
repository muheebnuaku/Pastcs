'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/providers';
import { Loader2, X, Zap, Star, Rocket, CheckCircle } from 'lucide-react';
import type { TutorCreditPlan } from '@/app/api/tutor-pricing/route';

interface Props {
  usedCredits: number;
  purchasedCredits: number;
  onClose: () => void;
  onSuccess: (newCredits: number) => void;
}

// Presentational-only — icon/color/badge/copy per plan id. The numbers
// that actually matter (name, credits, price) are admin-editable in
// /admin/pricing and fetched below, never hardcoded here.
const PLAN_META: Record<string, { icon: React.ReactNode; badge: string | null; color: string; btnColor: string }> = {
  starter:  { icon: <Zap className="w-5 h-5" />,    badge: null,          color: 'border-gray-200 dark:border-white/10',   btnColor: 'bg-gray-900 hover:bg-gray-800' },
  pack_50:  { icon: <Star className="w-5 h-5" />,   badge: 'Popular',     color: 'border-blue-500 ring-2 ring-blue-200',   btnColor: 'bg-blue-600 hover:bg-blue-700' },
  pack_100: { icon: <Rocket className="w-5 h-5" />, badge: 'Best value',  color: 'border-purple-400 ring-2 ring-purple-100', btnColor: 'bg-purple-600 hover:bg-purple-700' },
};
const PLAN_ORDER = ['starter', 'pack_50', 'pack_100'];

// Shown for an instant before the real prices load — same numbers this
// modal always shipped with, just no longer the source of truth.
const FALLBACK_PLANS: TutorCreditPlan[] = [
  { id: 'starter', name: 'Starter', credits: 30, amount: 3000 },
  { id: 'pack_50', name: 'Standard', credits: 50, amount: 5000 },
  { id: 'pack_100', name: 'Pro', credits: 100, amount: 10000 },
];

export function TutorPricingModal({ usedCredits, purchasedCredits, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const [plans, setPlans] = useState<TutorCreditPlan[]>(FALLBACK_PLANS);
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [paystackReady, setPaystackReady] = useState(false);

  // Portal to <body> — see Modal.tsx: rendering inline under a page that
  // uses .animate-fade-in breaks `position: fixed` (its `both` fill-mode
  // leaves a transform applied forever, which makes that ancestor the
  // containing block for fixed descendants instead of the viewport).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch('/api/tutor-pricing')
      .then(r => r.json())
      .then((data: { plans?: TutorCreditPlan[] }) => {
        if (data.plans?.length) {
          setPlans([...data.plans].sort((a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id)));
        }
      })
      .catch(() => {}); // keep the fallback numbers
  }, []);

  const isTopUp = purchasedCredits > 0;
  const remaining = Math.max(0, purchasedCredits - usedCredits);

  // Ensure Paystack script is loaded
  useEffect(() => {
    if (window.PaystackPop) {
      setPaystackReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => setPaystackReady(true);
    script.onerror = () => setError('Could not load payment gateway. Check your connection.');
    document.head.appendChild(script);
  }, []);

  const handleVerify = (reference: string, plan: TutorCreditPlan) => {
    setIsVerifying(true);
    fetch('/api/payments/tutor-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, plan: plan.id }),
    })
      .then(r => r.json())
      .then((data: { success?: boolean; error?: string }) => {
        if (data.success) {
          onSuccess(plan.credits);
        } else {
          setError(data.error ?? 'Payment verification failed. Please contact support.');
        }
      })
      .catch(() => setError('Could not verify payment. Please contact support.'))
      .finally(() => {
        setIsVerifying(false);
        setPayingPlan(null);
      });
  };

  const handlePay = (plan: TutorCreditPlan) => {
    if (!user || !paystackReady) return;
    setError('');
    setPayingPlan(plan.id);

    const ref = `tutor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: plan.amount,
        currency: 'GHS',
        ref,
        metadata: { userId: user.id, plan: plan.id, product: 'ai_tutor' },
        callback: (response: { reference: string }) => {
          handleVerify(response.reference, plan);
        },
        onClose: () => setPayingPlan(null),
      });
      handler.openIframe();
    } catch {
      setError('Could not open payment gateway. Please try again.');
      setPayingPlan(null);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 py-8 sm:py-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto dark:bg-white/[0.04]">

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {isTopUp ? 'Top up your AI Tutor credits' : 'Get AI Tutor Access'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5 dark:text-gray-400">
              {isTopUp
                ? `You have ${remaining} upload${remaining !== 1 ? 's' : ''} remaining — choose a top-up pack`
                : 'Upload your lecture notes, slides, or textbooks and let AI teach you'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 ml-4 flex-shrink-0 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </button>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-6 pb-4">
          {plans.map(plan => {
            const meta = PLAN_META[plan.id] ?? PLAN_META.starter;
            const perks = [`${plan.credits} document lessons`, 'AI voice reading', 'Word-level highlights'];
            return (
              <div key={plan.id} className={`relative rounded-2xl border-2 p-4 flex flex-col ${meta.color}`}>
                {meta.badge && (
                  <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                    plan.id === 'pack_50' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                  }`}>
                    {meta.badge}
                  </span>
                )}

                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                  plan.id === 'starter' ? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                  : plan.id === 'pack_50' ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                  : 'bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400'
                }`}>
                  {meta.icon}
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-gray-400">{plan.name}</p>
                <div className="flex items-baseline gap-0.5 mt-1 mb-3">
                  <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">GHC {plan.amount / 100}</span>
                </div>

                <p className="text-sm font-bold text-gray-800 mb-3 dark:text-gray-200">{plan.credits} uploads</p>

                <ul className="space-y-1.5 mb-4 flex-1">
                  {perks.map(perk => (
                    <li key={perk} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                      <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                      {perk}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePay(plan)}
                  disabled={isVerifying || payingPlan !== null || !paystackReady}
                  className={`w-full py-2 rounded-xl text-white text-xs font-semibold transition-colors disabled:opacity-50 ${meta.btnColor}`}
                >
                  {payingPlan === plan.id ? (
                    isVerifying
                      ? <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Verifying…</span>
                      : <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Opening…</span>
                  ) : !paystackReady ? (
                    <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading…</span>
                  ) : (
                    `Get ${plan.credits} uploads`
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {error && <p className="text-xs text-red-500 dark:text-red-400 text-center px-6 pb-2">{error}</p>}

        <div className="border-t border-gray-100 px-6 py-4 text-center dark:border-white/10">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Works for any course or department — not just IT students
          </p>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 mt-2 dark:text-gray-500 dark:hover:text-gray-400">
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

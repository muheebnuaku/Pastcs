'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { Loader2, X, Zap, Star, Rocket, CheckCircle } from 'lucide-react';

interface Props {
  usedCredits: number;
  purchasedCredits: number;
  onClose: () => void;
  onSuccess: (newCredits: number) => void;
}

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    icon: <Zap className="w-5 h-5" />,
    price: 30,
    pesewas: 3000,
    credits: 30,
    period: '/month',
    badge: null,
    color: 'border-gray-200',
    btnColor: 'bg-gray-900 hover:bg-gray-800',
    perks: ['30 document lessons', 'AI voice reading', 'Word-level highlights'],
  },
  {
    id: 'pack_50',
    name: 'Standard',
    icon: <Star className="w-5 h-5" />,
    price: 50,
    pesewas: 5000,
    credits: 50,
    period: '',
    badge: 'Popular',
    color: 'border-blue-500 ring-2 ring-blue-200',
    btnColor: 'bg-blue-600 hover:bg-blue-700',
    perks: ['50 document lessons', 'AI voice reading', 'Word-level highlights'],
  },
  {
    id: 'pack_100',
    name: 'Pro',
    icon: <Rocket className="w-5 h-5" />,
    price: 100,
    pesewas: 10000,
    credits: 100,
    period: '',
    badge: 'Best value',
    color: 'border-purple-400 ring-2 ring-purple-100',
    btnColor: 'bg-purple-600 hover:bg-purple-700',
    perks: ['100 document lessons', 'AI voice reading', 'Word-level highlights'],
  },
] as const;

type PlanId = typeof PLANS[number]['id'];

export function TutorPricingModal({ usedCredits, purchasedCredits, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const [payingPlan, setPayingPlan] = useState<PlanId | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');

  const isTopUp = purchasedCredits > 0;
  const remaining = Math.max(0, purchasedCredits - usedCredits);

  useEffect(() => {
    if (window.PaystackPop) return;
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const handlePay = (plan: typeof PLANS[number]) => {
    if (!user) return;
    setError('');
    setPayingPlan(plan.id);

    const trigger = () => {
      const ref = `tutor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: plan.pesewas,
        currency: 'GHS',
        ref,
        metadata: { userId: user.id, plan: plan.id, product: 'ai_tutor' },
        callback: async (response: { reference: string }) => {
          setIsVerifying(true);
          try {
            const res = await fetch('/api/payments/tutor-credits', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reference: response.reference, plan: plan.id }),
            });
            const data = await res.json() as { success?: boolean; error?: string; credits?: number };
            if (data.success) {
              onSuccess(plan.credits);
            } else {
              setError(data.error ?? 'Payment verification failed. Please contact support.');
            }
          } catch {
            setError('Could not verify payment. Please contact support.');
          } finally {
            setIsVerifying(false);
            setPayingPlan(null);
          }
        },
        onClose: () => setPayingPlan(null),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl">

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {isTopUp ? 'Top up your AI Tutor credits' : 'Get AI Tutor Access'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {isTopUp
                ? `You have ${remaining} upload${remaining !== 1 ? 's' : ''} remaining — choose a top-up pack`
                : 'Upload your lecture notes, slides, or textbooks and let AI teach you'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 ml-4 flex-shrink-0">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-3 gap-3 px-6 pb-4">
          {PLANS.map(plan => (
            <div key={plan.id} className={`relative rounded-2xl border-2 p-4 flex flex-col ${plan.color}`}>
              {plan.badge && (
                <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                  plan.id === 'pack_50' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                }`}>
                  {plan.badge}
                </span>
              )}

              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                plan.id === 'starter' ? 'bg-gray-100 text-gray-600'
                : plan.id === 'pack_50' ? 'bg-blue-100 text-blue-600'
                : 'bg-purple-100 text-purple-600'
              }`}>
                {plan.icon}
              </div>

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{plan.name}</p>
              <div className="flex items-baseline gap-0.5 mt-1 mb-0.5">
                <span className="text-2xl font-bold text-gray-900">GHC {plan.price}</span>
              </div>
              {plan.period && (
                <p className="text-[11px] text-gray-400 mb-2">{plan.period}</p>
              )}

              <p className="text-sm font-bold text-gray-800 mb-3">{plan.credits} uploads</p>

              <ul className="space-y-1.5 mb-4 flex-1">
                {plan.perks.map(perk => (
                  <li key={perk} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                    {perk}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handlePay(plan)}
                disabled={isVerifying || payingPlan !== null}
                className={`w-full py-2 rounded-xl text-white text-xs font-semibold transition-colors disabled:opacity-50 ${plan.btnColor}`}
              >
                {payingPlan === plan.id
                  ? isVerifying
                    ? <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Verifying…</span>
                    : <span className="flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Opening…</span>
                  : `Get ${plan.credits} uploads`
                }
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-red-500 text-center px-6 pb-2">{error}</p>}

        <div className="border-t border-gray-100 px-6 py-4 text-center">
          <p className="text-xs text-gray-400">
            Works for any course or department — not just IT students
          </p>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 mt-2">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

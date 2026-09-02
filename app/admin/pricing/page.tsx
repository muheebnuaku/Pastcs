'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Button } from '@/components/ui';
import { invalidatePricingCache } from '@/lib/hooks/usePricing';
import type { TutorCreditPlan } from '@/app/api/tutor-pricing/route';
import { DollarSign, Save, RefreshCw, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';

const LEVELS = [100, 200, 300, 400] as const;
const PLAN_ORDER = ['starter', 'pack_50', 'pack_100'];

export default function AdminPricingPage() {
  const [prices, setPrices] = useState<Record<number, string>>({
    100: '50',
    200: '50',
    300: '50',
    400: '50',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // AI Tutor credit packs — each plan's name, credit count, and GHC price
  // are all admin-editable (kept as strings while typing, same pattern as
  // the course prices above).
  const [plans, setPlans] = useState<{ id: string; name: string; credits: string; price: string }[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [isSavingPlans, setIsSavingPlans] = useState(false);
  const [plansSuccess, setPlansSuccess] = useState('');
  const [plansError, setPlansError] = useState('');

  useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.json())
      .then(data => {
        if (data.prices) {
          const display: Record<number, string> = {};
          for (const level of LEVELS) {
            // Convert from pesewas to GHC
            display[level] = String((data.prices[level] ?? 5000) / 100);
          }
          setPrices(display);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));

    fetch('/api/tutor-pricing')
      .then(r => r.json())
      .then((data: { plans?: TutorCreditPlan[] }) => {
        if (data.plans?.length) {
          const sorted = [...data.plans].sort((a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id));
          setPlans(sorted.map(p => ({ id: p.id, name: p.name, credits: String(p.credits), price: String(p.amount / 100) })));
        }
      })
      .catch(() => {})
      .finally(() => setPlansLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSuccess('');

    // Validate inputs
    for (const level of LEVELS) {
      const val = parseFloat(prices[level]);
      if (isNaN(val) || val <= 0) {
        setError(`Invalid price for Level ${level}`);
        setIsSaving(false);
        return;
      }
    }

    try {
      // Convert GHC → pesewas (multiply by 100)
      const pesewas: Record<number, number> = {};
      for (const level of LEVELS) {
        pesewas[level] = Math.round(parseFloat(prices[level]) * 100);
      }

      const res = await fetch('/api/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: pesewas }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      invalidatePricingCache();
      setSuccess('Prices updated successfully!');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save prices');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePlans = async () => {
    setIsSavingPlans(true);
    setPlansError('');
    setPlansSuccess('');

    for (const plan of plans) {
      const credits = parseInt(plan.credits, 10);
      const price = parseFloat(plan.price);
      if (!plan.name.trim() || isNaN(credits) || credits <= 0 || isNaN(price) || price <= 0) {
        setPlansError(`Invalid values for ${plan.name || plan.id}`);
        setIsSavingPlans(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/tutor-pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plans: plans.map(p => ({
            id: p.id,
            name: p.name.trim(),
            credits: parseInt(p.credits, 10),
            amount: Math.round(parseFloat(p.price) * 100),
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setPlansSuccess('AI Tutor pricing updated successfully!');
    } catch (err: unknown) {
      setPlansError(err instanceof Error ? err.message : 'Failed to save AI Tutor pricing');
    } finally {
      setIsSavingPlans(false);
    }
  };

  const updatePlan = (id: string, field: 'name' | 'credits' | 'price', value: string) => {
    setPlans(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pricing</h1>
        <p className="text-gray-600">Everything students pay for, in one place — course access and AI Tutor credits.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-600" />
              Course Access — Price Per Level (GHC)
            </h2>
          </div>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading prices...
              </div>
            ) : (
              <>
                {LEVELS.map(level => (
                  <div key={level} className="flex items-center gap-4">
                    <div className="w-28 flex-shrink-0">
                      <span className="font-semibold text-gray-800">Level {level}</span>
                      <p className="text-xs text-gray-400">Semester 1 &amp; 2</p>
                    </div>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">
                        GHC
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={prices[level]}
                        onChange={e => setPrices(prev => ({ ...prev, [level]: e.target.value }))}
                        className="w-full pl-12 pr-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                ))}

                {error && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {success && (
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg p-3 text-sm">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    {success}
                  </div>
                )}

                <Button onClick={handleSave} disabled={isSaving} className="w-full">
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Prices
                    </>
                  )}
                </Button>

                <p className="text-xs text-gray-400 text-center">
                  Changes take effect immediately for new payments.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              AI Tutor — Credit Pack Pricing
            </h2>
          </div>
          <CardContent className="space-y-5">
            {plansLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading prices...
              </div>
            ) : (
              <>
                {plans.map(plan => (
                  <div key={plan.id} className="p-3 border border-gray-100 rounded-xl space-y-2.5">
                    <input
                      type="text"
                      value={plan.name}
                      onChange={e => updatePlan(plan.id, 'name', e.target.value)}
                      placeholder="Plan name"
                      className="w-full font-semibold text-gray-800 text-sm border-0 border-b border-transparent hover:border-gray-200 focus:border-purple-400 focus:outline-none pb-1 bg-transparent"
                    />
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">
                          GHC
                        </span>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={plan.price}
                          onChange={e => updatePlan(plan.id, 'price', e.target.value)}
                          className="w-full pl-11 pr-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          min="1"
                          value={plan.credits}
                          onChange={e => updatePlan(plan.id, 'credits', e.target.value)}
                          className="w-full pl-3 pr-20 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">uploads</span>
                      </div>
                    </div>
                  </div>
                ))}

                {plansError && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {plansError}
                  </div>
                )}

                {plansSuccess && (
                  <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg p-3 text-sm">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    {plansSuccess}
                  </div>
                )}

                <Button onClick={handleSavePlans} disabled={isSavingPlans} className="w-full bg-purple-600 hover:bg-purple-700">
                  {isSavingPlans ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save AI Tutor Pricing
                    </>
                  )}
                </Button>

                <p className="text-xs text-gray-400 text-center">
                  Changes apply to new purchases only — students who already bought a pack keep the credits they paid for.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

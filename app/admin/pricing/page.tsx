'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Button, Select } from '@/components/ui';
import { invalidatePricingCache } from '@/lib/hooks/usePricing';
import type { TutorCreditPlan } from '@/app/api/tutor-pricing/route';
import type { Program } from '@/types';
import { DollarSign, Save, RefreshCw, CheckCircle, AlertCircle, Sparkles, CalendarClock } from 'lucide-react';

const LEVELS = [100, 200, 300, 400] as const;
const PLAN_ORDER = ['starter', 'pack_50', 'pack_100'];

export default function AdminPricingPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgram, setSelectedProgram] = useState('');
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

  // Semester access windows — when each semester ends (per program) and
  // how many extra days of access after that before it's cut off. Kept
  // as strings while typing, same pattern as the sections above.
  const emptyTerms = { start_date: '', end_date: '', grace_days: '3' };
  const [terms, setTerms] = useState<Record<1 | 2, { start_date: string; end_date: string; grace_days: string }>>({
    1: { ...emptyTerms },
    2: { ...emptyTerms },
  });
  const [termsLoading, setTermsLoading] = useState(true);
  const [isSavingTerms, setIsSavingTerms] = useState(false);
  const [termsSuccess, setTermsSuccess] = useState('');
  const [termsError, setTermsError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.from('programs').select('*').order('name')
      .then(({ data }: { data: Program[] | null }) => {
        setPrograms(data ?? []);
        if (data && data.length > 0) setSelectedProgram(data[0].id);
      });

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

  // Course-access prices are program-scoped — refetched whenever the
  // selected program changes.
  useEffect(() => {
    if (!selectedProgram) return;
    setIsLoading(true);
    setSuccess('');
    setError('');
    fetch(`/api/pricing?programId=${encodeURIComponent(selectedProgram)}`)
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
  }, [selectedProgram]);

  // Semester access windows are program-scoped too — same refetch
  // pattern as course-access prices above.
  useEffect(() => {
    if (!selectedProgram) return;
    setTermsLoading(true);
    setTermsSuccess('');
    setTermsError('');
    fetch(`/api/semester-dates?programId=${encodeURIComponent(selectedProgram)}`)
      .then(r => r.json())
      .then(data => {
        const next: Record<1 | 2, { start_date: string; end_date: string; grace_days: string }> = {
          1: { ...emptyTerms },
          2: { ...emptyTerms },
        };
        for (const t of (data.terms ?? []) as { semester: 1 | 2; start_date: string | null; end_date: string; grace_days: number }[]) {
          next[t.semester] = {
            start_date: t.start_date ?? '',
            end_date: t.end_date,
            grace_days: String(t.grace_days),
          };
        }
        setTerms(next);
      })
      .catch(() => {})
      .finally(() => setTermsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProgram]);

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
        body: JSON.stringify({ prices: pesewas, programId: selectedProgram }),
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

  const updateTerm = (sem: 1 | 2, field: 'start_date' | 'end_date' | 'grace_days', value: string) => {
    setTerms(prev => ({ ...prev, [sem]: { ...prev[sem], [field]: value } }));
  };

  const handleSaveTerms = async () => {
    setIsSavingTerms(true);
    setTermsError('');
    setTermsSuccess('');

    // A semester with no end date is simply left unconfigured (no expiry
    // enforced for it) — only semesters where an end date was actually
    // entered get sent.
    const payloadTerms: { semester: 1 | 2; start_date: string | null; end_date: string; grace_days: number }[] = [];
    for (const sem of [1, 2] as const) {
      const t = terms[sem];
      if (!t.end_date) continue;
      const grace = parseInt(t.grace_days, 10);
      if (isNaN(grace) || grace < 0) {
        setTermsError(`Invalid grace period for Semester ${sem}`);
        setIsSavingTerms(false);
        return;
      }
      payloadTerms.push({ semester: sem, start_date: t.start_date || null, end_date: t.end_date, grace_days: grace });
    }

    if (payloadTerms.length === 0) {
      setTermsError("Set at least one semester's end date before saving.");
      setIsSavingTerms(false);
      return;
    }

    try {
      const res = await fetch('/api/semester-dates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId: selectedProgram, terms: payloadTerms }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setTermsSuccess('Access window updated successfully!');
    } catch (err: unknown) {
      setTermsError(err instanceof Error ? err.message : 'Failed to save access window');
    } finally {
      setIsSavingTerms(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pricing</h1>
        <p className="text-gray-600 dark:text-gray-400">Everything students pay for, in one place — course access and AI Tutor credits.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <DollarSign className="w-5 h-5 text-blue-600" />
              Course Access — Price Per Level (GHC)
            </h2>
            {programs.length > 1 && (
              <Select
                value={selectedProgram}
                onChange={e => setSelectedProgram(e.target.value)}
                className="sm:w-56"
              >
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
          </div>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading prices...
              </div>
            ) : (
              <>
                {LEVELS.map(level => (
                  <div key={level} className="flex items-center gap-4">
                    <div className="w-28 flex-shrink-0">
                      <span className="font-semibold text-gray-800 dark:text-gray-200">Level {level}</span>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Semester 1 &amp; 2</p>
                    </div>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm dark:text-gray-400">
                        GHC
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={prices[level]}
                        onChange={e => setPrices(prev => ({ ...prev, [level]: e.target.value }))}
                        className="w-full pl-12 pr-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                    </div>
                  </div>
                ))}

                {error && (
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {success && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 rounded-lg p-3 text-sm">
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

                <p className="text-xs text-gray-400 text-center dark:text-gray-500">
                  Changes take effect immediately for new payments.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <Sparkles className="w-5 h-5 text-purple-600" />
              AI Tutor — Credit Pack Pricing
            </h2>
          </div>
          <CardContent className="space-y-5">
            {plansLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading prices...
              </div>
            ) : (
              <>
                {plans.map(plan => (
                  <div key={plan.id} className="p-3 border border-gray-100 rounded-xl space-y-2.5 dark:border-white/10">
                    <input
                      type="text"
                      value={plan.name}
                      onChange={e => updatePlan(plan.id, 'name', e.target.value)}
                      placeholder="Plan name"
                      className="w-full font-semibold text-gray-800 text-sm border-0 border-b border-transparent hover:border-gray-200 focus:border-purple-400 focus:outline-none pb-1 bg-transparent dark:text-gray-200 dark:hover:border-white/10"
                    />
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs dark:text-gray-400">
                          GHC
                        </span>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={plan.price}
                          onChange={e => updatePlan(plan.id, 'price', e.target.value)}
                          className="w-full pl-11 pr-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                        />
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          min="1"
                          value={plan.credits}
                          onChange={e => updatePlan(plan.id, 'credits', e.target.value)}
                          className="w-full pl-3 pr-20 py-2 text-sm border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs dark:text-gray-500">uploads</span>
                      </div>
                    </div>
                  </div>
                ))}

                {plansError && (
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {plansError}
                  </div>
                )}

                {plansSuccess && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 rounded-lg p-3 text-sm">
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

                <p className="text-xs text-gray-400 text-center dark:text-gray-500">
                  Changes apply to new purchases only — students who already bought a pack keep the credits they paid for.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <CalendarClock className="w-5 h-5 text-amber-600" />
            Course Access — When Each Semester Ends
            {programs.length > 1 && (
              <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                — {programs.find(p => p.id === selectedProgram)?.name}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">
            Access to a paid course expires this many days after the semester it was bought for ends. Leave a semester&apos;s end date blank to leave its access open-ended.
          </p>
        </div>
        <CardContent className="space-y-5">
          {termsLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {([1, 2] as const).map(sem => (
                  <div key={sem} className="p-4 border border-gray-100 dark:border-white/10 rounded-xl space-y-3">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Semester {sem}</p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ends on</label>
                      <input
                        type="date"
                        value={terms[sem].end_date}
                        onChange={e => updateTerm(sem, 'end_date', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Grace period (days)</label>
                      <input
                        type="number"
                        min="0"
                        value={terms[sem].grace_days}
                        onChange={e => updateTerm(sem, 'grace_days', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-500 mb-1">
                        Started on <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={terms[sem].start_date}
                        onChange={e => updateTerm(sem, 'start_date', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                        Only needed if you&apos;re reusing these same dates for a new term — protects students who paid for the previous one from being cut off early.
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {termsError && (
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-3 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {termsError}
                </div>
              )}

              {termsSuccess && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 rounded-lg p-3 text-sm">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  {termsSuccess}
                </div>
              )}

              <Button onClick={handleSaveTerms} disabled={isSavingTerms} className="w-full bg-amber-600 hover:bg-amber-700">
                {isSavingTerms ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Access Window
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

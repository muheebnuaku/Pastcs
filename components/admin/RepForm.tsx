'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { repErrorMessage } from '@/lib/levelReps';
import type { Program } from '@/types';

export interface RepFormValues {
  program_id: string | null;
  level: number;
  commission_pct: number;
  discount_pct: number;
  active: boolean;
}

// Make someone a Level Rep, or change a rep's level and rates. The
// database checks the admin and the 0–50% limits (admin_set_level_rep).
export function RepForm({ userId, programs, initial, onSaved, onCancel }: {
  userId: string;
  programs: Program[];
  initial: RepFormValues;
  onSaved: (values: RepFormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (values: RepFormValues) => {
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('admin_set_level_rep', {
      p_user: userId,
      p_program: values.program_id,
      p_level: values.level,
      p_commission: values.commission_pct,
      p_discount: values.discount_pct,
      p_active: values.active,
    });
    setBusy(false);
    if (err) { setError(repErrorMessage(err.message)); return; }
    onSaved(values);
  };

  const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100';
  const label = 'block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400';
  const rate = (n: number) => Math.min(50, Math.max(0, Number.isFinite(n) ? n : 0));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); save(v); }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`rep-program-${userId}`} className={label}>Programme</label>
          <select id={`rep-program-${userId}`} value={v.program_id ?? ''} onChange={e => setV({ ...v, program_id: e.target.value || null })} className={field}>
            <option value="">Any programme</option>
            {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`rep-level-${userId}`} className={label}>Level</label>
          <select id={`rep-level-${userId}`} value={v.level} onChange={e => setV({ ...v, level: Number(e.target.value) })} className={field}>
            {[100, 200, 300, 400].map(l => <option key={l} value={l}>Level {l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`rep-commission-${userId}`} className={label}>Commission (% of what their sign-ups pay)</label>
          <input id={`rep-commission-${userId}`} type="number" inputMode="decimal" min={0} max={50} step={0.5} value={v.commission_pct}
            onChange={e => setV({ ...v, commission_pct: rate(Number(e.target.value)) })} className={field} />
        </div>
        <div>
          <label htmlFor={`rep-discount-${userId}`} className={label}>Discount for their sign-ups (%)</label>
          <input id={`rep-discount-${userId}`} type="number" inputMode="decimal" min={0} max={50} step={0.5} value={v.discount_pct}
            onChange={e => setV({ ...v, discount_pct: rate(Number(e.target.value)) })} className={field} />
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Students who sign up with this rep’s code pay {100 - v.discount_pct}% of the price; the rep earns {v.commission_pct}% of that.
        On a GHC 50 unlock: student pays GHC {(50 * (100 - v.discount_pct) / 100).toFixed(2)}, rep earns GHC {(50 * (100 - v.discount_pct) / 100 * v.commission_pct / 100).toFixed(2)}.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={v.active} onChange={e => setV({ ...v, active: e.target.checked })} className="h-4 w-4" />
        Active (code gives the discount and earns commission)
      </label>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5">Cancel</button>
        )}
      </div>
    </form>
  );
}

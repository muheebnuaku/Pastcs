'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ghc } from '@/lib/groupPayments';
import { repErrorMessage, type LevelRepRow } from '@/lib/levelReps';
import { RepForm } from '@/components/admin/RepForm';
import type { Program } from '@/types';
import { ChevronDown, ChevronUp, Loader2, Megaphone, Wallet } from 'lucide-react';

// Level Reps (migration 047): how each level's reps are doing, their
// rates, and paying them. Reps are made from Users › Manage.

interface Signup { student_id: string; full_name: string | null; email: string | null; level: number | null; joined_at: string; paid: number; commission: number }
interface Payout { id: string; amount: number; note: string | null; paid_at: string; paid_by_name: string | null }

const LEVELS = [100, 200, 300, 400];
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminRepsPage() {
  const [reps, setReps] = useState<LevelRepRow[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [levelFilter, setLevelFilter] = useState<number | 'all'>('all');

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('admin_list_level_reps');
    if (err) setError(repErrorMessage(err.message));
    else { setReps((data ?? []) as LevelRepRow[]); setError(''); }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    createClient().from('programs').select('*').order('name')
      .then(({ data }: { data: Program[] | null }) => setPrograms(data ?? []));
  }, [load]);

  const byLevel = useMemo(() => LEVELS.map(level => {
    const rs = reps.filter(r => r.level === level);
    return {
      level,
      reps: rs.length,
      signups: rs.reduce((a, r) => a + r.signups, 0),
      paying: rs.reduce((a, r) => a + r.paying, 0),
      revenue: rs.reduce((a, r) => a + Number(r.revenue), 0),
      earned: rs.reduce((a, r) => a + Number(r.earned), 0),
      unpaid: rs.reduce((a, r) => a + Number(r.unpaid), 0),
    };
  }), [reps]);

  const shown = reps
    .filter(r => levelFilter === 'all' || r.level === levelFilter)
    .sort((a, b) => a.level - b.level || b.paying - a.paying || b.signups - a.signups);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Level Reps</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Reps earn commission on what their sign-ups pay. Make someone a rep from{' '}
          <Link href="/admin/users" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Users</Link> › Manage.
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <section className="rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10">
        <h2 className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-gray-100">By level</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-y border-gray-100 text-left text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
                <th className="px-4 py-2 font-medium">Level</th>
                <th className="px-4 py-2 font-medium text-right">Reps</th>
                <th className="px-4 py-2 font-medium text-right">Sign-ups</th>
                <th className="px-4 py-2 font-medium text-right">Paying</th>
                <th className="px-4 py-2 font-medium text-right">Revenue</th>
                <th className="px-4 py-2 font-medium text-right">Commission</th>
                <th className="px-4 py-2 font-medium text-right">Owed</th>
              </tr>
            </thead>
            <tbody>
              {byLevel.map(l => (
                <tr key={l.level} className="border-b border-gray-50 last:border-0 dark:border-white/5">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">Level {l.level}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{l.reps}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{l.signups}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{l.paying}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{ghc(l.revenue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{ghc(l.earned)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{ghc(l.unpaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by level">
        {(['all', ...LEVELS] as const).map(l => (
          <button
            key={l}
            onClick={() => setLevelFilter(l)}
            aria-pressed={levelFilter === l}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${levelFilter === l
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300'}`}
          >
            {l === 'all' ? 'All levels' : `Level ${l}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center dark:border-white/15">
          <Megaphone className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No reps {levelFilter === 'all' ? 'yet' : `for Level ${levelFilter} yet`}. Open a student in Users › Manage and choose “Make Level Rep”.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(r => <RepCard key={r.user_id} rep={r} programs={programs} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}

function RepCard({ rep, programs, onChanged }: { rep: LevelRepRow; programs: Program[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'pay'>('view');
  const [open, setOpen] = useState(false);
  const [signups, setSignups] = useState<Signup[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const loadDetail = useCallback(async () => {
    const supabase = createClient();
    const [s, p] = await Promise.all([
      supabase.rpc('admin_rep_signups', { p_rep: rep.user_id }),
      supabase.rpc('admin_rep_payouts', { p_rep: rep.user_id }),
    ]);
    setSignups((s.data ?? []) as Signup[]);
    setPayouts((p.data ?? []) as Payout[]);
  }, [rep.user_id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !signups) loadDetail();
  };

  const pay = async () => {
    setBusy(true);
    setError('');
    const { data, error: err } = await createClient().rpc('admin_pay_level_rep', { p_rep: rep.user_id, p_note: note.trim() || null });
    setBusy(false);
    if (err) { setError(repErrorMessage(err.message)); return; }
    setDone(`Recorded ${ghc(Number(data))} paid to ${rep.full_name || 'this rep'}. They’ve been notified.`);
    setMode('view');
    setNote('');
    onChanged();
    if (open) loadDetail();
  };

  const figures: [string, string][] = [
    ['Sign-ups', String(rep.signups)],
    ['Paying', String(rep.paying)],
    ['Revenue', ghc(Number(rep.revenue))],
    ['Earned', ghc(Number(rep.earned))],
    ['Paid out', ghc(Number(rep.paid_out))],
    ['Owed', ghc(Number(rep.unpaid))],
  ];

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900 dark:text-gray-100">{rep.full_name || 'No name'}</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-white/5 dark:text-gray-300">Level {rep.level}</span>
            {!rep.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Paused</span>}
          </div>
          <p className="truncate text-sm text-gray-500 dark:text-gray-400">{rep.email}{rep.program_name ? ` · ${rep.program_name}` : ''}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Code <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">{rep.referral_code}</span> · {Number(rep.commission_pct)}% commission · {Number(rep.discount_pct)}% discount
          </p>
        </div>
        {mode === 'view' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setMode('edit'); setDone(''); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">Edit</button>
            <button
              onClick={() => { setMode('pay'); setDone(''); setError(''); }}
              disabled={Number(rep.unpaid) <= 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wallet className="h-4 w-4" />Mark as paid
            </button>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {figures.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
            <dt className="text-[11px] text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>

      {done && <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">{done}</p>}

      {mode === 'edit' && (
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-white/10">
          <RepForm
            userId={rep.user_id}
            programs={programs}
            initial={{ program_id: rep.program_id, level: rep.level, commission_pct: Number(rep.commission_pct), discount_pct: Number(rep.discount_pct), active: rep.active }}
            onCancel={() => setMode('view')}
            onSaved={() => { setMode('view'); setDone('Saved. New rates apply to payments from now on.'); onChanged(); }}
          />
        </div>
      )}

      {mode === 'pay' && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4 dark:border-white/10">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Record that you’ve sent <strong>{ghc(Number(rep.unpaid))}</strong> to {rep.full_name || 'this rep'}. Send the money first (for example by Mobile Money); this only records it.
          </p>
          <div>
            <label htmlFor={`note-${rep.user_id}`} className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Note (optional), e.g. MoMo reference</label>
            <input id={`note-${rep.user_id}`} value={note} maxLength={200} onChange={e => setNote(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100" />
          </div>
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={pay} disabled={busy} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60">
              {busy ? 'Recording…' : `Record ${ghc(Number(rep.unpaid))} paid`}
            </button>
            <button onClick={() => setMode('view')} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5">Cancel</button>
          </div>
        </div>
      )}

      <button onClick={toggle} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{open ? 'Hide' : 'Show'} sign-ups and payouts
      </button>

      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sign-ups</h4>
            {!signups ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : signups.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No sign-ups yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/10 dark:border-white/10">
                {signups.map(s => (
                  <li key={s.student_id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-900 dark:text-gray-100">{s.full_name || 'No name'}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{s.email} · {s.level ? `L${s.level} · ` : ''}{day(s.joined_at)}</p>
                    </div>
                    <span className="flex-shrink-0 text-right text-xs tabular-nums text-gray-600 dark:text-gray-400">
                      {Number(s.paid) > 0 ? <>Paid {ghc(Number(s.paid))}<br />Rep {ghc(Number(s.commission))}</> : 'Not paid'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Payouts</h4>
            {!payouts ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : payouts.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No payouts yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/10 dark:border-white/10">
                {payouts.map(p => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">{ghc(Number(p.amount))}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{p.note ?? 'No note'}{p.paid_by_name ? ` · by ${p.paid_by_name}` : ''}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">{day(p.paid_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

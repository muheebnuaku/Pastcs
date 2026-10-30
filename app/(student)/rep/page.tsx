'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ghc } from '@/lib/groupPayments';
import { Check, Copy, Loader2, Megaphone, Share2, Wallet } from 'lucide-react';

// A Level Rep's page (migration 047): their code, who signed up with it,
// what they've earned and what's been paid out. Everything comes from
// get_my_rep_dashboard, which only shows sign-ups' first names.

interface Signup {
  first_name: string;
  level: number | null;
  joined_at: string;
  paid: boolean;
  commission: number;
}

interface Dashboard {
  active: boolean;
  level: number;
  program_name: string | null;
  commission_pct: number;
  discount_pct: number;
  referral_code: string | null;
  signups: number;
  paying: number;
  earned: number;
  unpaid: number;
  paid_out: number;
  recent: Signup[];
  payouts: { amount: number; paid_at: string; note: string | null }[];
}

const pct = (n: number) => `${Number(n)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function RepPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not_rep' | 'error'>('loading');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createClient().rpc('get_my_rep_dashboard').then(({ data: d, error }: { data: Dashboard | null; error: unknown }) => {
      if (cancelled) return;
      if (error) setState('error');
      else if (!d) setState('not_rep');
      else { setData(d); setState('ready'); }
    });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (state !== 'ready' || !data) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3 dark:text-gray-600" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {state === 'error' ? 'Couldn’t load your Level Rep page' : 'This page is for Level Reps'}
        </h1>
        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">
          {state === 'error' ? 'Check your connection and try again.' : 'Want to be your level’s rep? Message the PastCS team.'}
        </p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm font-semibold text-[#e8603c]">Back to dashboard</Link>
      </div>
    );
  }

  const code = data.referral_code ?? '';
  const link = typeof window !== 'undefined' ? `${window.location.origin}/register?ref=${code}` : `https://www.pastcs.com/register?ref=${code}`;
  const shareText = Number(data.discount_pct) > 0
    ? `Join PastCS with my code ${code} and get ${pct(data.discount_pct)} off. Past questions, mock exams and an AI tutor for DCIT: ${link}`
    : `Join PastCS with my code ${code}. Past questions, mock exams and an AI tutor for DCIT: ${link}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };

  const stats: [string, string][] = [
    ['Signed up', String(data.signups)],
    ['Paying', String(data.paying)],
    ['Owed to you', ghc(Number(data.unpaid))],
    ['Paid to you', ghc(Number(data.paid_out))],
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Level Rep</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {data.program_name ? `${data.program_name} · ` : ''}Level {data.level}
        </p>
      </div>

      {!data.active && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          Your rep code is paused. New sign-ups won’t get a discount and new payments won’t earn commission. What you’ve already earned is still yours.
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:bg-white/[0.04] dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Your code</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider text-gray-900 dark:text-gray-100">{code}</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {Number(data.discount_pct) > 0 && <>Students who sign up with it get <strong>{pct(data.discount_pct)} off</strong> every payment. </>}
          You earn <strong>{pct(data.commission_pct)}</strong> of what they pay.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <code className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">{link.replace(/^https?:\/\//, '')}</code>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied' : 'Copy link'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5a]"
          >
            <Share2 className="w-4 h-4" />Share on WhatsApp
          </a>
        </div>
      </section>

      <section aria-label="Your numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-3.5 dark:bg-white/[0.04] dark:border-white/10">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          </div>
        ))}
      </section>
      <p className="-mt-2 text-xs text-gray-500 dark:text-gray-400">
        Earned in total: {ghc(Number(data.earned))}. PastCS pays out what’s owed to you and records it here.
      </p>

      <section className="rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10">
        <h2 className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-gray-100">Who signed up with your code</h2>
        {data.recent.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">No one yet. Share your link in your class group to get started.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-white/10">
            {data.recent.map((s, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{s.first_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.level ? `Level ${s.level} · ` : ''}Joined {day(s.joined_at)}</p>
                </div>
                {s.paid ? (
                  <span className="flex-shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 dark:bg-green-500/10 dark:text-green-400">
                    Paid · you earned {ghc(Number(s.commission))}
                  </span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-white/5 dark:text-gray-400">Not paid yet</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10">
        <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-gray-100"><Wallet className="w-4 h-4 text-gray-400" />Payouts</h2>
        {data.payouts.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">No payouts yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-white/10">
            {data.payouts.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{ghc(Number(p.amount))}</p>
                  {p.note && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{p.note}</p>}
                </div>
                <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">{day(p.paid_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

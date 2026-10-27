'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { Avatar, Modal } from '@/components/ui';
import { ghc, type GroupPayQuote, type GroupPayReceipt } from '@/lib/groupPayments';
import { AlertTriangle, Check, ChevronRight, Clock, HandCoins, Loader2, Receipt, ShieldCheck } from 'lucide-react';

// Group payment through the class rep (migration 036). The rep picks
// classmates who haven't unlocked yet and pays once. The server prices the
// checkout, makes the Paystack reference and unlocks everyone on it after
// Paystack confirms; this screen only shows and starts it.

function loadPaystack(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('paystack'));
    document.head.appendChild(script);
  });
}

function paidDate(r: GroupPayReceipt): string {
  return new Date(r.paid_at ?? r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** On This week, for the owner and leaders. */
export function GroupPayCard({ classroomId, classroomName }: { classroomId: string; classroomName: string }) {
  const [receipts, setReceipts] = useState<GroupPayReceipt[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('get_my_group_payments', { p_classroom: classroomId });
    // Before migration 036 the function doesn't exist: show nothing.
    if (!error) setReceipts((data ?? []) as GroupPayReceipt[]);
  }, [classroomId]);
  useEffect(() => { load(); }, [load]);

  if (receipts === null) return null;
  const shown = receipts.find(r => r.reference === openReceipt);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
      <div className="flex flex-col min-[400px]:flex-row min-[400px]:items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 dark:text-gray-100">
            <HandCoins className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />Pay for classmates
          </p>
          <p className="text-sm text-gray-600 mt-0.5 dark:text-gray-400">Collected the money? Unlock everyone who hasn&rsquo;t paid yet in one checkout.</p>
        </div>
        <button onClick={() => setChoosing(true)} className="px-3.5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 flex-shrink-0">
          Choose classmates
        </button>
      </div>

      {receipts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/10">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 dark:text-gray-400">Your receipts</p>
          <ul className="divide-y divide-gray-100 dark:divide-white/10">
            {receipts.map(r => (
              <li key={r.id}>
                <button onClick={() => setOpenReceipt(r.reference)} className="w-full flex items-center gap-2 py-2 text-left text-sm hover:bg-gray-50 rounded-lg dark:hover:bg-white/5">
                  <Receipt className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                    {ghc(r.amount_paid ?? r.total)} · {r.students.length} {r.students.length === 1 ? 'classmate' : 'classmates'} · {paidDate(r)}
                  </span>
                  <ReceiptStatus status={r.status} />
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {choosing && (
        <GroupPayModal
          classroomId={classroomId}
          onClose={() => setChoosing(false)}
          onDone={async (reference) => { setChoosing(false); await load(); setOpenReceipt(reference); }}
        />
      )}
      {shown && <ReceiptModal receipt={shown} classroomName={classroomName} onClose={() => setOpenReceipt(null)} />}
    </div>
  );
}

function ReceiptStatus({ status }: { status: GroupPayReceipt['status'] }) {
  if (status === 'paid') return <span className="text-[11px] font-semibold px-1.5 py-px rounded-full bg-green-100 text-green-700 flex-shrink-0 dark:bg-green-500/15 dark:text-green-300">Paid</span>;
  if (status === 'pending') return <span className="text-[11px] font-semibold px-1.5 py-px rounded-full bg-amber-100 text-amber-700 flex-shrink-0 dark:bg-amber-500/15 dark:text-amber-300">Waiting</span>;
  return <span className="text-[11px] font-semibold px-1.5 py-px rounded-full bg-red-100 text-red-700 flex-shrink-0 dark:bg-red-500/15 dark:text-red-300">Problem</span>;
}

function GroupPayModal({ classroomId, onClose, onDone }: { classroomId: string; onClose: () => void; onDone: (reference: string) => void }) {
  const { user } = useAuth();
  const { addSubscription } = useSubscriptionStore();
  const [quote, setQuote] = useState<GroupPayQuote | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'choose' | 'starting' | 'paying' | 'verifying'>('choose');

  const loadQuote = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch(`/api/payments/group/quote?classroom=${classroomId}`);
      const data = await res.json();
      if (!res.ok) { setLoadError(data.error || 'Could not load your classmates. Please try again.'); return; }
      setQuote(data as GroupPayQuote);
      setSelected(prev => new Set([...prev].filter(id => (data as GroupPayQuote).candidates.some(c => c.user_id === id && !c.pending))));
    } catch {
      setLoadError('Could not load your classmates. Check your connection.');
    }
  }, [classroomId]);
  useEffect(() => { loadQuote(); }, [loadQuote]);

  const selectable = useMemo(() => quote?.candidates.filter(c => !c.pending) ?? [], [quote]);
  const allOn = selectable.length > 0 && selectable.every(c => selected.has(c.user_id));
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const count = selected.size;
  const busy = stage !== 'choose';

  const verify = async (reference: string) => {
    setStage('verifying');
    try {
      const res = await fetch('/api/payments/group/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Still waiting on Paystack: the receipt shows it as waiting.
        if (data.waiting) { onDone(reference); return; }
        setError(data.error || 'Could not confirm the payment. Please contact support.');
        setStage('choose');
        return;
      }
      if (user && quote && (data.covered as string[]).includes(user.id)) {
        addSubscription({
          id: reference,
          user_id: user.id,
          level: quote.level,
          semester: quote.semester,
          program_id: user.program_id ?? null,
          payment_reference: `${reference}:${user.id}`,
          amount: quote.unitAmount,
          status: 'active',
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
      }
      onDone(reference);
    } catch {
      setError(`Could not confirm the payment. If you were charged, your classmates unlock shortly. Reference ${reference}.`);
      setStage('choose');
    }
  };

  const pay = async () => {
    if (!user || !quote || count === 0) return;
    setError('');
    setStage('starting');
    try {
      const res = await fetch('/api/payments/group/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId, studentIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not start the checkout. Please try again.');
        setStage('choose');
        if (res.status === 409) loadQuote();
        return;
      }
      await loadPaystack();
      setStage('paying');
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: data.amount,
        currency: 'GHS',
        ref: data.reference,
        metadata: { userId: user.id, product: 'group_unlock', classroomId, students: data.count },
        callback: (response: { reference: string }) => { verify(response.reference); },
        onClose: () => { setStage(s => (s === 'paying' ? 'choose' : s)); },
      });
      handler.openIframe();
    } catch {
      setError('Could not open the checkout. Check your connection and try again.');
      setStage('choose');
    }
  };

  const total = quote ? quote.unitAmount * count : 0;

  return (
    <Modal isOpen onClose={busy ? () => {} : onClose} title="Pay for classmates" size="md">
      {!quote ? (
        loadError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button onClick={loadQuote} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 dark:border-white/15 dark:text-gray-200">Try again</button>
          </div>
        ) : (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        )
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Classmates in your programme who haven&rsquo;t unlocked Level {quote.level} yet. Each one gets every Level {quote.level} course for this semester.
          </p>

          {quote.candidates.length === 0 ? (
            <div className="text-center rounded-xl border border-dashed border-gray-300 p-6 dark:border-white/15">
              <Check className="w-8 h-8 text-green-500 mx-auto mb-1" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Everyone has unlocked</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">There&rsquo;s nobody left to pay for.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-white/10">
              <label className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-800 cursor-pointer dark:border-white/10 dark:text-gray-200">
                <input type="checkbox" checked={allOn} disabled={busy || selectable.length === 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(selectable.map(c => c.user_id)))}
                  className="w-4 h-4 rounded accent-green-600" />
                Select all ({selectable.length})
              </label>
              <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-white/10">
                {quote.candidates.map(c => (
                  <li key={c.user_id}>
                    <label className={`flex items-center gap-3 px-3 py-2 text-sm ${c.pending ? 'opacity-60' : 'cursor-pointer'}`}>
                      <input type="checkbox" aria-label={`Pay for ${c.full_name || 'classmate'}`} checked={selected.has(c.user_id)} disabled={busy || c.pending}
                        onChange={() => toggle(c.user_id)} className="w-4 h-4 rounded accent-green-600 flex-shrink-0" />
                      <Avatar src={c.avatar_url} name={c.full_name || 'Classmate'} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{c.full_name || 'Classmate'}{c.is_me && ' (you)'}</span>
                      {c.pending && <span className="text-xs text-amber-700 flex items-center gap-1 flex-shrink-0 dark:text-amber-300"><Clock className="w-3.5 h-3.5" />Being paid for</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl bg-gray-50 p-3 text-sm space-y-1 dark:bg-white/[0.04]">
            <div className="flex justify-between gap-3 text-gray-600 dark:text-gray-400">
              <span>{count} × {ghc(quote.unitAmount)}</span>
              <span className="tabular-nums">{ghc(total)}</span>
            </div>
            <div className="flex justify-between gap-3 font-bold text-gray-900 pt-1 border-t border-gray-200 dark:text-gray-100 dark:border-white/10">
              <span>Total</span><span className="tabular-nums">{ghc(total)}</span>
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
            <span>One checkout by Paystack, Mobile Money or card. You&rsquo;ll get a receipt.</span>
          </div>

          <button onClick={pay} disabled={busy || count === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {stage === 'starting' ? 'Opening checkout…'
              : stage === 'paying' ? 'Waiting for Paystack…'
              : stage === 'verifying' ? 'Unlocking your classmates…'
              : count === 0 ? 'Choose classmates to pay for'
              : `Pay ${ghc(total)} for ${count} ${count === 1 ? 'classmate' : 'classmates'}`}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ReceiptModal({ receipt: r, classroomName, onClose }: { receipt: GroupPayReceipt; classroomName: string; onClose: () => void }) {
  const covered = r.students.filter(s => s.state === 'covered').length;
  return (
    <Modal isOpen onClose={onClose} title="Receipt" size="md">
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate dark:text-gray-100">{classroomName}</p>
            <p className="text-gray-500 dark:text-gray-400">Level {r.level} unlock · Semester {r.semester} · {paidDate(r)}</p>
          </div>
          <ReceiptStatus status={r.status} />
        </div>

        {r.status === 'pending' && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />Waiting for Paystack to confirm. Everyone below unlocks as soon as it does. If you closed the checkout without paying, nothing was charged.
          </p>
        )}
        {r.status === 'problem' && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-500/10 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />The amount paid didn&rsquo;t match the total, so nobody was unlocked. Contact support with the reference below and we&rsquo;ll sort it out.
          </p>
        )}

        <ul className="rounded-xl border border-gray-200 divide-y divide-gray-100 dark:border-white/10 dark:divide-white/10">
          {r.students.map(s => (
            <li key={s.user_id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{s.full_name || 'Former member'}</span>
              {s.state === 'covered' && <span className="text-green-700 flex items-center gap-1 flex-shrink-0 dark:text-green-300"><Check className="w-3.5 h-3.5" />Unlocked</span>}
              {s.state === 'already_paid' && <span className="text-amber-700 flex-shrink-0 dark:text-amber-300">Had already paid, refund due</span>}
              {s.state === 'waiting' && <span className="text-gray-500 flex-shrink-0 dark:text-gray-400">Waiting</span>}
            </li>
          ))}
        </ul>

        <dl className="rounded-xl bg-gray-50 p-3 space-y-1 dark:bg-white/[0.04]">
          <div className="flex justify-between gap-3"><dt className="text-gray-600 dark:text-gray-400">Price each</dt>
            <dd className="tabular-nums text-gray-900 dark:text-gray-100">{ghc(r.unit_amount)}{r.deal && <span className="line-through ml-1.5 text-gray-400">{ghc(r.full_unit_amount)}</span>}</dd></div>
          {r.deal && <div className="flex justify-between gap-3"><dt className="text-gray-600 dark:text-gray-400">Class deal</dt><dd className="text-green-700 dark:text-green-300">Applied</dd></div>}
          <div className="flex justify-between gap-3"><dt className="text-gray-600 dark:text-gray-400">Total</dt><dd className="tabular-nums text-gray-900 dark:text-gray-100">{ghc(r.total)}</dd></div>
          {r.amount_paid !== null && <div className="flex justify-between gap-3 font-semibold"><dt className="text-gray-900 dark:text-gray-100">Paid</dt><dd className="tabular-nums text-gray-900 dark:text-gray-100">{ghc(r.amount_paid)}</dd></div>}
          {r.status === 'paid' && <div className="flex justify-between gap-3"><dt className="text-gray-600 dark:text-gray-400">Unlocked</dt><dd className="text-gray-900 dark:text-gray-100">{covered} of {r.students.length}</dd></div>}
        </dl>

        {r.students.some(s => s.state === 'already_paid') && (
          <p className="text-amber-800 dark:text-amber-300">Someone on this receipt unlocked on their own before your payment arrived. Support has been alerted. Contact us with the reference to get their share back.</p>
        )}

        <p className="text-xs text-gray-500 break-all dark:text-gray-400">Reference: <span className="font-mono">{r.reference}</span></p>
      </div>
    </Modal>
  );
}

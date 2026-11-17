'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { ghc } from '@/lib/groupPayments';
import { PENDING_SKILL_KEY, skillDate, weeksLabel, type MySkillEnrolment, type SkillCourse } from '@/lib/skills';
import { CalendarDays, CheckCircle2, ExternalLink, Loader2, Lock, MessagesSquare, ShieldCheck } from 'lucide-react';

function loadPaystack(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
}

export function EnrolPanel({ course }: { course: SkillCourse }) {
  const { user, isLoading } = useAuth();
  const [mine, setMine] = useState<MySkillEnrolment | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<'' | 'opening' | 'verifying'>('');
  const [error, setError] = useState('');
  const [justPaid, setJustPaid] = useState(false);

  const loadMine = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('get_my_skill_enrolments');
    if (!err) {
      const row = ((data ?? []) as MySkillEnrolment[]).find(e => e.slug === course.slug) ?? null;
      setMine(row);
    }
    setChecked(true);
    return !err;
  }, [course.slug]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { setChecked(true); return; }
    loadMine();
  }, [user, isLoading, loadMine]);

  // Back here after signing in: the pending course is done with.
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem(PENDING_SKILL_KEY) === course.slug) localStorage.removeItem(PENDING_SKILL_KEY);
    } catch { /* storage unavailable */ }
  }, [user, course.slug]);

  const rememberCourse = () => {
    try { localStorage.setItem(PENDING_SKILL_KEY, course.slug); } catch { /* storage unavailable */ }
  };

  const verify = (reference: string) => {
    setBusy('verifying');
    fetch('/api/payments/skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, slug: course.slug }),
    })
      .then(r => r.json())
      .then(async (d: { success?: boolean; error?: string }) => {
        if (d.success) {
          setJustPaid(true);
          await loadMine();
        } else {
          // Paystack's own notice may still record it: look again shortly.
          setError(d.error ?? 'We couldn’t confirm your payment yet. Refresh in a minute.');
          setTimeout(() => { loadMine(); }, 6000);
        }
      })
      .catch(() => {
        setError('We couldn’t confirm your payment yet. Refresh in a minute; if you were charged, your place is kept.');
        setTimeout(() => { loadMine(); }, 6000);
      })
      .finally(() => setBusy(''));
  };

  const pay = async () => {
    if (!user || busy) return;
    setError('');
    setBusy('opening');
    try {
      await loadPaystack();
    } catch {
      setError('Couldn’t load the payment window. Check your connection and try again.');
      setBusy('');
      return;
    }
    const ref = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: course.price,
        currency: 'GHS',
        ref,
        metadata: { userId: user.id, product: 'skill', skill: course.slug },
        callback: (response: { reference: string }) => verify(response.reference),
        onClose: () => setBusy(b => (b === 'opening' ? '' : b)),
      });
      handler.openIframe();
    } catch {
      setError('Couldn’t open the payment window. Please try again.');
      setBusy('');
    }
  };

  const active = !!mine?.is_active;

  return (
    <aside className="bg-[#fffdf9] border border-[#efe2d0] rounded-[24px] p-6 shadow-[0_18px_40px_-24px_rgba(43,36,32,0.35)]">
      {active && mine ? (
        <div>
          <div className="flex items-center gap-2 text-[#2f9e8f] mb-3">
            <CheckCircle2 className="w-5 h-5" />
            <p className="font-extrabold">{justPaid ? 'Payment received. You’re in!' : 'You’re enrolled'}</p>
          </div>
          <p className="text-sm text-[#4a4038] mb-1 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[#a89a86] flex-shrink-0" />
            <span>Teaching runs until <strong>{skillDate(mine.ends_at)}</strong></span>
          </p>
          {mine.cohort_note && <p className="text-sm text-[#8a7f6f] mb-4 ml-6">{mine.cohort_note}</p>}
          {mine.class_link ? (
            <a
              href={mine.class_link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#25a366] hover:bg-[#1e8a56] text-white font-bold py-3.5 transition-colors"
            >
              <MessagesSquare className="w-5 h-5" /> Join the class
              <ExternalLink className="w-4 h-4 opacity-80" />
            </a>
          ) : (
            <p className="mt-4 rounded-2xl bg-[#f7ede1] p-4 text-sm text-[#6b5d4f]">
              Your class link will appear here before the first lesson. Check back on this page.
            </p>
          )}
          <p className="mt-5 pt-4 border-t border-[#f3e9db] text-xs text-[#a89a86]">
            Want more time? Paying again adds another {weeksLabel(course.duration_days)} after this one ends.
          </p>
          <button
            onClick={pay}
            disabled={!!busy}
            className="mt-2 text-sm font-bold text-[#e8603c] hover:underline disabled:opacity-50"
          >
            {busy ? 'Opening…' : `Add ${weeksLabel(course.duration_days)} for ${ghc(course.price)}`}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a89a86]">One payment</p>
          <p className="text-4xl font-extrabold text-[#2b2420] leading-tight mb-1">{ghc(course.price)}</p>
          <p className="text-sm text-[#8a7f6f] mb-5">{weeksLabel(course.duration_days)} of live teaching and support</p>

          <ul className="space-y-2.5 mb-6 text-sm text-[#4a4038]">
            <li className="flex gap-2.5"><MessagesSquare className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Your class link as soon as you pay</li>
            <li className="flex gap-2.5"><CalendarDays className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Live lessons and help with your project</li>
            <li className="flex gap-2.5"><ShieldCheck className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Mobile Money or card, through Paystack</li>
          </ul>

          {course.cohort_note && (
            <p className="mb-5 rounded-2xl bg-[#fbe9b8]/60 px-4 py-3 text-sm font-semibold text-[#7a5a10]">{course.cohort_note}</p>
          )}

          {mine && !mine.is_active && (
            <p className="mb-4 text-sm text-[#8a7f6f]">Your last enrolment ended on {skillDate(mine.ends_at)}. Enrol again for another {weeksLabel(course.duration_days)}.</p>
          )}

          {isLoading || (user && !checked) ? (
            <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-[#a89a86]" /></div>
          ) : user ? (
            <button
              onClick={pay}
              disabled={!!busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] text-white font-bold py-3.5 shadow-[0_10px_24px_-8px_rgba(232,96,60,0.55)] transition-colors disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
              {busy === 'verifying' ? 'Confirming payment…' : busy === 'opening' ? 'Opening payment…' : `Enrol for ${ghc(course.price)}`}
            </button>
          ) : (
            <div className="space-y-2.5">
              <Link
                href="/register"
                onClick={rememberCourse}
                className="w-full inline-flex items-center justify-center rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] text-white font-bold py-3.5 transition-colors"
              >
                Create a free account to enrol
              </Link>
              <Link
                href="/login"
                onClick={rememberCourse}
                className="w-full inline-flex items-center justify-center rounded-2xl border border-[#efe2d0] text-[#2b2420] font-semibold py-3 hover:bg-[#f7ede1] transition-colors"
              >
                I have an account: sign in
              </Link>
              <p className="text-xs text-center text-[#a89a86] pt-1">You’ll come straight back here.</p>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>}
    </aside>
  );
}

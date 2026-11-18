'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { ghc } from '@/lib/groupPayments';
import {
  ACCESS_TOKEN, accessLink, savedAccessToken, saveAccessToken, skillDate, weeksLabel,
  type MySkillEnrolment, type SkillAccess, type SkillCourse,
} from '@/lib/skills';
import {
  CalendarDays, CheckCircle2, Copy, Download, ExternalLink, Link2, Loader2, Lock, MessagesSquare, Share2, ShieldCheck,
} from 'lucide-react';

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneDigits = (p: string) => p.replace(/[^\d]/g, '');

type Enrolled = { ends_at: string; is_active: boolean; class_link: string | null; cohort_note: string | null };

export function EnrolPanel({ course }: { course: SkillCourse }) {
  const { user, isLoading } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [viaLink, setViaLink] = useState<SkillAccess | null>(null);
  const [mine, setMine] = useState<MySkillEnrolment | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<'' | 'opening' | 'verifying'>('');
  const [error, setError] = useState('');
  const [justPaid, setJustPaid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [origin, setOrigin] = useState('');

  // The access link (?access=…) or one remembered on this device.
  useEffect(() => {
    setOrigin(window.location.origin);
    const fromUrl = new URLSearchParams(window.location.search).get('access');
    if (fromUrl && ACCESS_TOKEN.test(fromUrl)) {
      saveAccessToken(course.slug, fromUrl);
      setToken(fromUrl);
    } else {
      setToken(savedAccessToken(course.slug));
    }
  }, [course.slug]);

  const loadAccess = useCallback(async (t: string) => {
    const { data } = await createClient().rpc('get_skill_access', { p_token: t });
    const row = ((data ?? []) as SkillAccess[]).find(r => r.slug === course.slug) ?? null;
    setViaLink(row);
  }, [course.slug]);

  const loadMine = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('get_my_skill_enrolments');
    if (!err) setMine(((data ?? []) as MySkillEnrolment[]).find(e => e.slug === course.slug) ?? null);
  }, [course.slug]);

  useEffect(() => {
    if (isLoading) return;
    Promise.all([token ? loadAccess(token) : null, user ? loadMine() : null]).finally(() => setChecked(true));
  }, [token, user, isLoading, loadAccess, loadMine]);

  useEffect(() => {
    if (user) {
      setName(n => n || user.full_name || '');
      setEmail(user.email ?? '');
    }
  }, [user]);

  // The better of what the account and the link say.
  const candidates: Enrolled[] = [mine, viaLink].filter((x): x is MySkillEnrolment | SkillAccess => !!x);
  const enrolled = candidates.sort((x, y) => Number(y.is_active) - Number(x.is_active) || +new Date(y.ends_at) - +new Date(x.ends_at))[0] ?? null;
  const active = !!enrolled?.is_active;
  const canDownload = course.has_sample_file && (course.sample_file_public || !!enrolled);
  const downloadHref = `/api/skills/file?slug=${course.slug}${token ? `&access=${token}` : ''}`;
  const myLink = token && origin ? accessLink(origin, course.slug, token) : '';

  const verify = (reference: string, claim: string) => {
    setBusy('verifying');
    fetch('/api/payments/skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, slug: course.slug, claim }),
    })
      .then(r => r.json())
      .then(async (d: { success?: boolean; error?: string; access_token?: string }) => {
        if (d.success && d.access_token) {
          setJustPaid(true);
          saveAccessToken(course.slug, d.access_token);
          setToken(d.access_token);
          window.history.replaceState(null, '', `/skills/${course.slug}?access=${d.access_token}`);
          await loadAccess(d.access_token);
          if (user) await loadMine();
        } else {
          setError(d.error ?? `We couldn’t confirm your payment yet. Please contact support with reference ${reference}.`);
        }
      })
      .catch(() => setError(`We couldn’t confirm your payment yet. If you were charged, contact support with reference ${reference}: your place is kept.`))
      .finally(() => setBusy(''));
  };

  const pay = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const n = name.trim(), m = email.trim().toLowerCase(), digits = phoneDigits(phone);
    if (n.length < 2) { setError('Enter your name.'); return; }
    if (!EMAIL.test(m)) { setError('Enter a valid email address.'); return; }
    if (digits.length < 9 || digits.length > 15) { setError('Enter your WhatsApp number, like 024 000 0000.'); return; }
    setError('');
    setBusy('opening');
    try {
      await loadPaystack();
    } catch {
      setError('Couldn’t load the payment window. Check your connection and try again.');
      setBusy('');
      return;
    }
    const rand = () => Math.random().toString(36).slice(2, 10);
    const claim = `${rand()}${rand()}${rand()}`;
    const ref = `skill_${Date.now()}_${rand()}`;
    try {
      const handler = window.PaystackPop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: m,
        amount: course.price,
        currency: 'GHS',
        ref,
        metadata: {
          product: 'skill', skill: course.slug, claim,
          userId: user?.id ?? null, buyerName: n, buyerEmail: m, buyerPhone: phone.trim(),
        },
        callback: (response: { reference: string }) => verify(response.reference, claim),
        onClose: () => setBusy(b => (b === 'opening' ? '' : b)),
      });
      handler.openIframe();
    } catch {
      setError('Couldn’t open the payment window. Please try again.');
      setBusy('');
    }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(myLink); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  };

  const input = 'w-full rounded-xl border border-[#e7d9c6] bg-white px-3.5 py-2.5 text-[15px] text-[#2b2420] placeholder:text-[#b9ab97] focus:outline-none focus:ring-2 focus:ring-[#e8603c]/40 focus:border-[#e8603c] disabled:bg-[#f7ede1] disabled:text-[#8a7f6f]';

  const downloadButton = canDownload && (
    <a
      href={downloadHref}
      className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-[#efe2d0] bg-white py-3 text-sm font-bold text-[#2b2420] hover:bg-[#f7ede1] transition-colors"
    >
      <Download className="w-4 h-4" /> Download the sample project
    </a>
  );

  return (
    <>
      <aside id="enrol" className="scroll-mt-24 bg-[#fffdf9] border border-[#efe2d0] rounded-[24px] p-6 shadow-[0_18px_40px_-24px_rgba(43,36,32,0.35)]">
        {active && enrolled ? (
          <div>
            <div className="flex items-center gap-2 text-[#2f9e8f] mb-3">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-extrabold">{justPaid ? 'Payment received. You’re in!' : 'You’re enrolled'}</p>
            </div>
            <p className="text-sm text-[#4a4038] mb-1 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#a89a86] flex-shrink-0" />
              <span>Teaching runs until <strong>{skillDate(enrolled.ends_at)}</strong></span>
            </p>
            {enrolled.cohort_note && <p className="text-sm text-[#8a7f6f] ml-6">{enrolled.cohort_note}</p>}
            {enrolled.class_link ? (
              <a
                href={enrolled.class_link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#25a366] hover:bg-[#1e8a56] text-white font-bold py-3.5 transition-colors"
              >
                <MessagesSquare className="w-5 h-5" /> Join the class
                <ExternalLink className="w-4 h-4 opacity-80" />
              </a>
            ) : (
              <p className="mt-4 rounded-2xl bg-[#f7ede1] p-4 text-sm text-[#6b5d4f]">
                Your class link will appear here before the first lesson. We’ll also add you on WhatsApp.
              </p>
            )}
            {downloadButton}

            {myLink && (
              <div className="mt-5 rounded-2xl border border-dashed border-[#e3d3bd] p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold text-[#2b2420] mb-1"><Link2 className="w-4 h-4 text-[#e8603c]" /> Your access link</p>
                <p className="text-xs text-[#8a7f6f] mb-3">Save it: it opens this page with your class link on any phone or laptop.</p>
                <p className="text-[11px] text-[#6b5d4f] bg-[#f7ede1] rounded-lg px-2.5 py-2 break-all mb-3">{myLink}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={copyLink} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#efe2d0] bg-white py-2 text-xs font-bold text-[#2b2420] hover:bg-[#f7ede1]">
                    <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`My ${course.title} class on PastCS: ${myLink}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25a366] py-2 text-xs font-bold text-white hover:bg-[#1e8a56]"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Send to me
                  </a>
                </div>
              </div>
            )}

            <p className="mt-5 pt-4 border-t border-[#f3e9db] text-xs text-[#a89a86]">
              Want more time? Paying again adds another {weeksLabel(course.duration_days)} after this one ends: use the same email.
            </p>
          </div>
        ) : (
          <form onSubmit={pay} noValidate>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a89a86]">One payment</p>
            <p className="text-4xl font-extrabold text-[#2b2420] leading-tight mb-1">{ghc(course.price)}</p>
            <p className="text-sm text-[#8a7f6f] mb-5">{weeksLabel(course.duration_days)} of live teaching and support</p>

            <ul className="space-y-2.5 mb-5 text-sm text-[#4a4038]">
              <li className="flex gap-2.5"><MessagesSquare className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Your class link as soon as you pay</li>
              <li className="flex gap-2.5"><CalendarDays className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Live lessons and help with your project</li>
              {course.has_sample_file && !course.sample_file_public && (
                <li className="flex gap-2.5"><Download className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />The full sample project to download</li>
              )}
              <li className="flex gap-2.5"><ShieldCheck className="w-4 h-4 text-[#e8603c] flex-shrink-0 mt-0.5" />Mobile Money or card. No account needed</li>
            </ul>

            {course.cohort_note && (
              <p className="mb-5 rounded-2xl bg-[#fbe9b8]/60 px-4 py-3 text-sm font-semibold text-[#7a5a10]">{course.cohort_note}</p>
            )}

            {enrolled && !enrolled.is_active && (
              <p className="mb-4 text-sm text-[#8a7f6f]">Your last enrolment ended on {skillDate(enrolled.ends_at)}. Enrol again for another {weeksLabel(course.duration_days)}.</p>
            )}

            {!checked ? (
              <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-[#a89a86]" /></div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="sk-name" className="block text-xs font-semibold text-[#6b5d4f] mb-1">Your name</label>
                  <input id="sk-name" className={input} value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Ama Mensah" />
                </div>
                <div>
                  <label htmlFor="sk-email" className="block text-xs font-semibold text-[#6b5d4f] mb-1">Email</label>
                  <input id="sk-email" className={input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" disabled={!!user} />
                </div>
                <div>
                  <label htmlFor="sk-phone" className="block text-xs font-semibold text-[#6b5d4f] mb-1">WhatsApp number</label>
                  <input id="sk-phone" className={input} type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" placeholder="024 000 0000" />
                  <p className="text-[11px] text-[#a89a86] mt-1">We add you to the class group on this number.</p>
                </div>
                <button
                  type="submit"
                  disabled={!!busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] text-white font-bold py-3.5 shadow-[0_10px_24px_-8px_rgba(232,96,60,0.55)] transition-colors disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {busy === 'verifying' ? 'Confirming payment…' : busy === 'opening' ? 'Opening payment…' : `Pay ${ghc(course.price)}`}
                </button>
              </div>
            )}
            {downloadButton}
          </form>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>}
      </aside>

      {/* Phones: the price and a way to the form, without scrolling past everything. */}
      {!active && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#efe2d0] bg-[#fffdf9]/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="min-w-0">
            <p className="text-xs text-[#8a7f6f] truncate">{course.title}</p>
            <p className="text-lg font-extrabold text-[#2b2420] leading-tight">{ghc(course.price)}</p>
          </div>
          <a href="#enrol" className="flex-shrink-0 rounded-2xl bg-[#e8603c] px-5 py-3 text-sm font-bold text-white">Enrol now</a>
        </div>
      )}
    </>
  );
}

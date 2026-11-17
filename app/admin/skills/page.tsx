'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ghc } from '@/lib/groupPayments';
import { skillErrorMessage, weeksLabel, type AdminSkillCourse, type AdminSkillEnrolment } from '@/lib/skills';
import { ExternalLink, Loader2, Pencil, Plus, Rocket } from 'lucide-react';

// Skills (migration 052): the paid practical courses, their class links,
// and who has paid.

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-100';
const label = 'block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400';

export default function AdminSkillsPage() {
  const [courses, setCourses] = useState<AdminSkillCourse[]>([]);
  const [enrolments, setEnrolments] = useState<AdminSkillEnrolment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [filter, setFilter] = useState<'running' | 'all'>('running');

  const load = useCallback(async () => {
    const supabase = createClient();
    const [c, e] = await Promise.all([
      supabase.rpc('admin_list_skill_courses'),
      supabase.rpc('admin_list_skill_enrolments'),
    ]);
    if (c.error || e.error) {
      const msg = (c.error ?? e.error)!.message;
      setError(/function .* does not exist|schema cache/i.test(msg)
        ? 'Run migration 052_skill_courses.sql in Supabase to turn on Skills.'
        : skillErrorMessage(msg));
    } else {
      setCourses(((c.data ?? []) as AdminSkillCourse[]).map(x => ({ ...x, outcomes: x.outcomes ?? [] })));
      setEnrolments((e.data ?? []) as AdminSkillEnrolment[]);
      setError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = enrolments.filter(e => filter === 'all' || e.is_active);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Skills</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Paid courses on the <Link href="/skills" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Skills page</Link>.
            Students see the class link only after paying, and only while their teaching runs.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
        >
          <Plus className="w-4 h-4" /> New course
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {editing === 'new' && (
            <CourseForm course={null} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {courses.map(c => editing === c.id ? (
              <div key={c.id} className="xl:col-span-2">
                <CourseForm course={c} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
              </div>
            ) : (
              <section key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{c.title}</h2>
                      {!c.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">Hidden</span>}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">/skills/{c.slug}</p>
                  </div>
                  <button
                    onClick={() => setEditing(c.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 flex-shrink-0 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
                <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Price</dt><dd className="font-semibold text-gray-900 dark:text-gray-100">{ghc(c.price)}</dd></div>
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Teaching</dt><dd className="font-semibold text-gray-900 dark:text-gray-100">{weeksLabel(c.duration_days)}</dd></div>
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Running / all</dt><dd className="font-semibold text-gray-900 dark:text-gray-100">{c.running} / {c.students}</dd></div>
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Revenue</dt><dd className="font-semibold text-gray-900 dark:text-gray-100">{ghc(Number(c.revenue))}</dd></div>
                </dl>
                <p className="mt-3 text-sm">
                  {c.class_link ? (
                    <a href={c.class_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400 break-all">
                      Class link <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                    </a>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">No class link yet: paid students are told it’s coming.</span>
                  )}
                </p>
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Students</h2>
              <div className="flex gap-2" role="group" aria-label="Which students">
                {(['running', 'all'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${filter === f
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-300'}`}
                  >
                    {f === 'running' ? 'Being taught now' : 'All payments'}
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="border-t border-gray-100 p-10 text-center dark:border-white/10">
                <Rocket className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{filter === 'running' ? 'No one is being taught right now.' : 'No payments yet.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-y border-gray-100 text-left text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">
                      <th className="px-4 py-2 font-medium">Student</th>
                      <th className="px-4 py-2 font-medium">Course</th>
                      <th className="px-4 py-2 font-medium text-right">Paid</th>
                      <th className="px-4 py-2 font-medium">Paid on</th>
                      <th className="px-4 py-2 font-medium">Teaching until</th>
                      <th className="px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(e => <EnrolmentRow key={e.id} row={e} onChanged={load} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function EnrolmentRow({ row, onChanged }: { row: AdminSkillEnrolment; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const extend = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('admin_extend_skill_enrolment', { p_id: row.id, p_days: 7 });
    setBusy(false);
    if (err) setError(skillErrorMessage(err.message));
    else onChanged();
  };
  return (
    <tr className="border-b border-gray-50 last:border-0 align-top dark:border-white/5">
      <td className="px-4 py-2.5">
        <p className="font-medium text-gray-900 dark:text-gray-100">{row.full_name || 'No name'}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{row.email}</p>
      </td>
      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{row.course_title}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{ghc(row.amount)}</td>
      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{day(row.paid_at)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className={row.is_active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}>{day(row.ends_at)}</span>
        {!row.is_active && <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">ended</span>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          onClick={extend}
          disabled={busy}
          title="Add 7 days to this student's teaching"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
        >
          {busy ? 'Adding…' : '+7 days'}
        </button>
      </td>
    </tr>
  );
}

function CourseForm({ course, onDone, onCancel }: { course: AdminSkillCourse | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(course?.title ?? '');
  const [slug, setSlug] = useState(course?.slug ?? '');
  const [tagline, setTagline] = useState(course?.tagline ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [outcomes, setOutcomes] = useState((course?.outcomes ?? []).join('\n'));
  const [price, setPrice] = useState(course ? String(course.price / 100) : '');
  const [days, setDays] = useState(String(course?.duration_days ?? 14));
  const [link, setLink] = useState(course?.class_link ?? '');
  const [note, setNote] = useState(course?.cohort_note ?? '');
  const [active, setActive] = useState(course?.is_active ?? true);
  const [order, setOrder] = useState(String(course?.sort_order ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const autoSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const pesewas = Math.round(Number(price) * 100);
    if (!Number.isFinite(pesewas) || pesewas < 100) { setError('The price must be at least GHC 1.'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('admin_save_skill_course', {
      p_id: course?.id ?? null,
      p_slug: slug.trim(),
      p_title: title,
      p_tagline: tagline,
      p_description: description,
      p_outcomes: outcomes.split('\n'),
      p_price: pesewas,
      p_duration_days: Math.round(Number(days)),
      p_class_link: link,
      p_cohort_note: note,
      p_active: active,
      p_sort_order: Math.round(Number(order) || 0),
    });
    setBusy(false);
    if (err) setError(skillErrorMessage(err.message));
    else onDone();
  };

  return (
    <form onSubmit={save} className="rounded-2xl border border-blue-200 bg-white p-4 space-y-4 dark:bg-white/[0.04] dark:border-blue-500/30">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{course ? `Edit ${course.title}` : 'New course'}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="sk-title">Name</label>
          <input id="sk-title" className={input} value={title} required
            onChange={e => { setTitle(e.target.value); if (!course) setSlug(autoSlug(e.target.value)); }} />
        </div>
        <div>
          <label className={label} htmlFor="sk-slug">Web address: /skills/…</label>
          <input id="sk-slug" className={input} value={slug} required onChange={e => setSlug(e.target.value.toLowerCase())} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="sk-tag">One-line summary</label>
          <input id="sk-tag" className={input} value={tagline} onChange={e => setTagline(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="sk-desc">Description (a blank line starts a new paragraph)</label>
          <textarea id="sk-desc" className={input} rows={4} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="sk-out">What they’ll be able to do (one per line)</label>
          <textarea id="sk-out" className={input} rows={4} value={outcomes} onChange={e => setOutcomes(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="sk-price">Price (GHC)</label>
          <input id="sk-price" className={input} type="number" min="1" step="0.01" inputMode="decimal" value={price} required onChange={e => setPrice(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="sk-days">Days of teaching per payment</label>
          <input id="sk-days" className={input} type="number" min="1" max="365" value={days} required onChange={e => setDays(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="sk-link">Class link (WhatsApp group or meeting). Only paid students see it.</label>
          <input id="sk-link" className={input} type="url" placeholder="https://chat.whatsapp.com/…" value={link} onChange={e => setLink(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="sk-note">Next class note (shown to everyone)</label>
          <input id="sk-note" className={input} placeholder="Next class starts Monday 1 December" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="sk-order">Order on the page (lower first)</label>
          <input id="sk-order" className={input} type="number" value={order} onChange={e => setOrder(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-2 dark:text-gray-300">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 rounded" />
          Show on the Skills page
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5">Cancel</button>
        <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}

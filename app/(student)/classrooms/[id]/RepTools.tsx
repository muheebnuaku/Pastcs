'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar, Modal } from '@/components/ui';
import { classroomErrorMessage, daysUntil, shortDate, timeAgo, ymdFromToday, type ClassroomMemberProgress } from '@/lib/classrooms';
import { CalendarClock, Check, ListChecks, Loader2, Pin, Plus, Target, Trash2, X } from 'lucide-react';

// Tools for class reps (migration 035): pinned announcements, weekly
// goals and the exam countdown. Every write is an RPC that checks the
// caller is the owner or a leader; these components only hide buttons.

interface Announcement {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

/** Up to 3 pinned notices, at the top of the chat and This week. */
export function PinnedAnnouncements({ classroomId, canModerate, members, allowAdd }: {
  classroomId: string;
  canModerate: boolean;
  members: ClassroomMemberProgress[];
  allowAdd?: boolean;
}) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from('classroom_announcements')
      .select('id, author_id, body, created_at').eq('classroom_id', classroomId).order('created_at', { ascending: false });
    if (!err) setItems((data ?? []) as Announcement[]);
  }, [classroomId]);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`classroom-pins-${classroomId}-${allowAdd ? 'week' : 'chat'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_announcements', filter: `classroom_id=eq.${classroomId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [classroomId, allowAdd, load]);

  // Before migration 035 the table doesn't exist: show nothing.
  if (items === null) return null;
  const canAdd = allowAdd && canModerate && items.length < 3;
  if (items.length === 0 && !canAdd) return null;

  const pin = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('pin_classroom_announcement', { p_classroom: classroomId, p_body: draft });
    setBusy(false);
    if (err) { setError(classroomErrorMessage(err)); return; }
    setDraft('');
    setAdding(false);
    load();
  };
  const unpin = async (id: string) => {
    if (!window.confirm('Unpin this announcement for everyone?')) return;
    const { error: err } = await createClient().rpc('unpin_classroom_announcement', { p_announcement: id });
    if (err) { setError(classroomErrorMessage(err)); return; }
    load();
  };
  const author = (id: string | null) => members.find(m => m.user_id === id)?.full_name?.split(' ')[0] || 'A class leader';

  return (
    <section aria-label="Pinned announcements" className="space-y-2">
      {items.map(a => (
        <div key={a.id} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <Pin className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-amber-950 whitespace-pre-wrap [overflow-wrap:anywhere] dark:text-amber-100">{a.body}</p>
            <p className="text-[11px] text-amber-700 mt-0.5 dark:text-amber-300/80">{author(a.author_id)} · {timeAgo(a.created_at)}</p>
          </div>
          {canModerate && (
            <button onClick={() => unpin(a.id)} aria-label="Unpin announcement" className="p-1 -m-1 rounded-lg text-amber-600 hover:text-amber-800 flex-shrink-0 dark:text-amber-400 dark:hover:text-amber-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}

      {canAdd && (adding ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:bg-white/[0.04] dark:border-white/10">
          <label htmlFor="pin-draft" className="sr-only">Announcement</label>
          <textarea
            id="pin-draft"
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g. Mid-sem is Friday 9am in JQB 23. Bring your ID."
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/15 dark:text-gray-100"
          />
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-[11px] text-gray-400 tabular-nums dark:text-gray-500">{draft.length}/500</span>
            <div className="flex gap-2">
              <button onClick={() => { setAdding(false); setError(''); }} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10">Cancel</button>
              <button onClick={pin} disabled={busy || !draft.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Pin
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:underline dark:text-amber-300">
          <Pin className="w-4 h-4" />Pin an announcement{items.length > 0 && ` (${3 - items.length} left)`}
        </button>
      ))}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

interface Goal {
  id: string;
  topic_id: string | null;
  topic_name: string | null;
  target_questions: number;
  due_date: string;
  created_at: string;
  author_name: string | null;
  my_count: number;
  done_count: number;
  sharing_count: number;
}

interface GoalRow {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_me: boolean;
  answered: number | null;
  done: boolean | null;
}

function dueLabel(ymd: string): string {
  const d = daysUntil(ymd);
  if (d < 0) return `Ended ${shortDate(ymd)}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${shortDate(ymd)}`;
}

/** "Practise <topic> (N questions) by <date>", with real progress. */
export function ClassGoals({ classroomId, courseId, canModerate }: { classroomId: string; courseId: string; canModerate: boolean }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [topics, setTopics] = useState<{ id: string; topic_name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [topic, setTopic] = useState('');
  const [target, setTarget] = useState('20');
  const [due, setDue] = useState(() => ymdFromToday(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openList, setOpenList] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<GoalRow[] | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('get_classroom_goals', { p_classroom: classroomId });
    if (!err) setGoals((data ?? []) as Goal[]);
  }, [classroomId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canModerate) return;
    createClient().from('topics').select('id, topic_name').eq('course_id', courseId).order('topic_name')
      .then(({ data }: { data: { id: string; topic_name: string }[] | null }) => setTopics(data ?? []));
  }, [canModerate, courseId]);

  // Before migration 035: nothing to show.
  if (goals === null) return null;
  const current = goals.filter(g => daysUntil(g.due_date) >= 0);
  if (goals.length === 0 && !canModerate) return null;

  const create = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('create_classroom_goal', {
      p_classroom: classroomId, p_topic: topic || null, p_target: Number(target), p_due: due,
    });
    setBusy(false);
    if (err) { setError(classroomErrorMessage(err)); return; }
    setShowForm(false);
    load();
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this goal for everyone?')) return;
    const { error: err } = await createClient().rpc('delete_classroom_goal', { p_goal: id });
    if (err) { setError(classroomErrorMessage(err)); return; }
    load();
  };
  const toggleList = async (id: string) => {
    if (openList === id) { setOpenList(null); return; }
    setOpenList(id);
    setChecklist(null);
    const { data, error: err } = await createClient().rpc('get_classroom_goal_progress', { p_goal: id });
    if (err) { setError(classroomErrorMessage(err)); setOpenList(null); return; }
    setChecklist((data ?? []) as GoalRow[]);
  };

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/15 dark:text-gray-100';

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10" aria-label="Class goals">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 dark:text-gray-100">
          <Target className="w-4 h-4 text-green-600 dark:text-green-400" />Class goals
        </h2>
        {canModerate && !showForm && current.length < 5 && (
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:underline dark:text-green-400">
            <Plus className="w-4 h-4" />Set a goal
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-3 rounded-xl bg-gray-50 p-3 space-y-3 dark:bg-white/[0.03]">
          <div>
            <label htmlFor="goal-topic" className="text-xs font-semibold text-gray-600 dark:text-gray-400">Practise</label>
            <select id="goal-topic" value={topic} onChange={e => setTopic(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">Any topic in the course</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.topic_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <label htmlFor="goal-target" className="text-xs font-semibold text-gray-600 dark:text-gray-400">Questions each</label>
              <input id="goal-target" type="number" inputMode="numeric" min={1} max={500} value={target} onChange={e => setTarget(e.target.value)} className={`${inputClass} mt-1`} />
            </div>
            <div className="min-w-0">
              <label htmlFor="goal-due" className="text-xs font-semibold text-gray-600 dark:text-gray-400">By</label>
              <input id="goal-due" type="date" min={ymdFromToday(0)} max={ymdFromToday(60)} value={due} onChange={e => setDue(e.target.value)} className={`${inputClass} mt-1 min-w-0`} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setError(''); }} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10">Cancel</button>
            <button onClick={create} disabled={busy || !target || !due} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Set goal
            </button>
          </div>
        </div>
      )}

      {goals.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Give the class a target, like 20 questions on one topic by Friday. Everyone sees their own progress.</p>
      )}

      <ul className="mt-2 divide-y divide-gray-100 dark:divide-white/10">
        {goals.map(g => {
          const past = daysUntil(g.due_date) < 0;
          const mine = Math.min(g.my_count, g.target_questions);
          const done = g.my_count >= g.target_questions;
          return (
            <li key={g.id} className={`py-3 ${past ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere] dark:text-gray-100">
                    Practise {g.topic_name ?? 'any topic'} ({g.target_questions} {g.target_questions === 1 ? 'question' : 'questions'})
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {dueLabel(g.due_date)} · {g.done_count} of {g.sharing_count} done{g.author_name && ` · set by ${g.author_name.split(' ')[0]}`}
                  </p>
                </div>
                {canModerate && (
                  <button onClick={() => remove(g.id)} aria-label="Delete goal" className="p-1 -m-1 rounded-lg text-gray-400 hover:text-red-600 flex-shrink-0 dark:text-gray-500 dark:hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden dark:bg-white/10">
                  <div className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${(mine / g.target_questions) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold tabular-nums text-gray-700 flex-shrink-0 dark:text-gray-300">
                  {done ? <span className="inline-flex items-center gap-0.5 text-green-700 dark:text-green-400"><Check className="w-3.5 h-3.5" />Done</span> : `You: ${mine}/${g.target_questions}`}
                </span>
              </div>
              {canModerate && (
                <button onClick={() => toggleList(g.id)} aria-expanded={openList === g.id} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                  <ListChecks className="w-3.5 h-3.5" />{openList === g.id ? 'Hide checklist' : 'Checklist'}
                </button>
              )}
              {openList === g.id && (
                checklist === null ? <div className="h-16 mt-2 rounded-lg bg-gray-100 animate-pulse dark:bg-white/10" /> : (
                  <ul className="mt-2 space-y-1" aria-label="Goal checklist">
                    {checklist.map(r => (
                      <li key={r.user_id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/[0.03]">
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                          r.done ? 'bg-green-500 text-white' : 'border border-gray-300 dark:border-white/20'}`}>
                          {r.done && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <Avatar src={r.avatar_url} name={r.full_name || 'Classmate'} size="sm" />
                        <span className="min-w-0 flex-1 text-sm text-gray-900 truncate dark:text-gray-100">{r.full_name || 'Classmate'}{r.is_me && ' (you)'}</span>
                        <span className="text-xs tabular-nums text-gray-500 flex-shrink-0 dark:text-gray-400">
                          {r.answered === null ? 'Private' : `${Math.min(r.answered, g.target_questions)}/${g.target_questions}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

/** "Exam in 12 days" in the header. Leaders tap it to set the date. */
export function ExamCountdown({ examDate, canModerate, onEdit }: { examDate: string | null | undefined; canModerate: boolean; onEdit: () => void }) {
  const days = examDate ? daysUntil(examDate) : null;
  const live = days !== null && days >= 0;
  if (!live && !canModerate) return null;
  const label = !live ? 'Set exam date' : days === 0 ? 'Exam today' : days === 1 ? 'Exam tomorrow' : `Exam in ${days} days`;
  const cls = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
    live && days! <= 7 ? 'bg-amber-300 text-amber-950' : 'bg-white/20 text-white'}`;
  return canModerate ? (
    <button onClick={onEdit} className={`${cls} hover:bg-white/30`} title={examDate ? shortDate(examDate) : undefined}>
      <CalendarClock className="w-3 h-3" />{label}
    </button>
  ) : (
    <span className={cls} title={shortDate(examDate!)}><CalendarClock className="w-3 h-3" />{label}</span>
  );
}

export function ExamDateModal({ classroomId, examDate, onClose, onSaved }: { classroomId: string; examDate: string | null | undefined; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(examDate ?? ymdFromToday(30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (date: string | null) => {
    setBusy(true);
    setError('');
    const { error: err } = await createClient().rpc('set_classroom_exam_date', { p_classroom: classroomId, p_date: date });
    setBusy(false);
    if (err) { setError(classroomErrorMessage(err)); return; }
    onSaved();
    onClose();
  };
  return (
    <Modal isOpen onClose={onClose} title="Exam date" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Everyone in the class sees a countdown in the header.</p>
        <label htmlFor="exam-date" className="sr-only">Exam date</label>
        <input id="exam-date" type="date" min={ymdFromToday(0)} max={ymdFromToday(365)} value={value} onChange={e => setValue(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/15 dark:text-gray-100" />
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          {examDate ? (
            <button onClick={() => save(null)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">Remove</button>
          ) : (
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10">Cancel</button>
          )}
          <button onClick={() => save(value)} disabled={busy || !value} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

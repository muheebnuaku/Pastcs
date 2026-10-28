'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { coursesForProgram } from '@/lib/programs';
import { Avatar } from '@/components/ui';
import { BossOwl } from '@/components/boss/BossOwl';
import {
  FREE_FIGHTS_PER_DAY, bossErrorMessage, formatFightTime,
  type BossHome, type DailyBoardRow,
} from '@/lib/examBoss';
import type { Course } from '@/types';
import { CalendarDays, ChevronDown, Heart, Loader2, Lock, Swords, Trophy, Zap } from 'lucide-react';

// The Exam Boss hub: pick a course (and a topic), see your boss level,
// fight, today's Daily Boss and its board, and your trophies.

interface TopicRow { id: string; topic_name: string }

export default function BossHubPage() {
  return <Suspense fallback={null}><BossHub /></Suspense>;
}

function BossHub() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [courseId, setCourseId] = useState<string | null>(search.get('course'));
  const [home, setHome] = useState<BossHome | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [openTopics, setOpenTopics] = useState<string[] | null>(null);
  const [topicId, setTopicId] = useState('');
  const [board, setBoard] = useState<DailyBoardRow[]>([]);
  const [busy, setBusy] = useState<'fight' | 'daily' | null>(null);
  const [error, setError] = useState('');
  const [showHow, setShowHow] = useState(false);

  useEffect(() => {
    if (!user?.program_id || !user.selected_level || !user.selected_semester) { if (user) setCourses([]); return; }
    coursesForProgram(createClient(), user.program_id)
      .eq('level', user.selected_level).eq('semester', user.selected_semester).order('course_code')
      .then(({ data }: { data: Course[] | null }) => {
        const list = data ?? [];
        setCourses(list);
        setCourseId(prev => prev && list.some(c => c.id === prev) ? prev
          : list.find(c => c.course_code === user.free_course_code)?.id ?? list[0]?.id ?? null);
      });
  }, [user]);

  const load = useCallback(async () => {
    if (!courseId) return;
    const supabase = createClient();
    const [h, t, b, a] = await Promise.all([
      supabase.rpc('get_boss_home', { p_course: courseId }),
      supabase.from('topics').select('id, topic_name').eq('course_id', courseId).order('order_index', { ascending: true, nullsFirst: false }),
      supabase.rpc('get_daily_boss_board', { p_course: courseId }),
      supabase.rpc('get_course_access', { p_course: courseId }),
    ]);
    setHome(h.error ? { access: 'locked' } : (h.data as BossHome));
    setTopics((t.data as TopicRow[] | null) ?? []);
    setBoard((b.data as DailyBoardRow[] | null) ?? []);
    const access = a.data as { access: string; open_topic_ids: string[] } | null;
    setOpenTopics(access?.access === 'free' ? access.open_topic_ids ?? [] : null);
  }, [courseId]);

  useEffect(() => { setHome(null); setTopicId(''); setError(''); load(); }, [load]);

  const start = async (daily: boolean) => {
    if (!courseId) return;
    setBusy(daily ? 'daily' : 'fight');
    setError('');
    const { data, error: err } = await createClient().rpc('start_boss_fight', { p_course: courseId, p_topic: daily ? null : topicId || null, p_daily: daily });
    if (err || !data) { setError(bossErrorMessage(err)); setBusy(null); load(); return; }
    router.push(`/boss/${data as string}`);
  };

  const course = courses?.find(c => c.id === courseId) ?? null;
  const free = !!home?.free;
  const left = free ? Math.max(0, FREE_FIGHTS_PER_DAY - (home?.fights_today ?? 0)) : null;
  const levelFloor = 900 + ((home?.level ?? 1) - 2) * 100;
  const toNext = home?.level && home.level < 10 && home.rating !== undefined
    ? Math.min(100, Math.max(0, ((home.rating - levelFloor) / 100) * 100)) : 100;

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl mx-auto">
      <div className="-mt-12 lg:mt-0 pl-14 lg:pl-0 min-h-[2.5rem] flex flex-col justify-center">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Exam Boss</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Answer before the boss attacks. Win, and the next boss is tougher.</p>
      </div>

      {courses && courses.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1" role="tablist" aria-label="Course">
          {courses.map(c => (
            <button key={c.id} role="tab" aria-selected={c.id === courseId} onClick={() => setCourseId(c.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold border ${c.id === courseId
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-white/[0.04] dark:text-gray-300 dark:border-white/10'}`}>
              {c.course_code}
            </button>
          ))}
        </div>
      )}

      {courses && courses.length === 0 && (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-white/15 dark:text-gray-400">
          Choose your level and semester on the <Link href="/courses" className="font-semibold text-blue-600 underline dark:text-blue-400">Courses</Link> page to meet your bosses.
        </p>
      )}

      {courseId && !home && <div className="h-72 rounded-3xl bg-gray-900/90 animate-pulse" />}

      {home?.access === 'locked' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center dark:bg-white/[0.04] dark:border-white/10">
          <Lock className="w-6 h-6 mx-auto text-gray-400" />
          <p className="mt-2 font-semibold text-gray-900 dark:text-gray-100">{course?.course_code} is locked</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Unlock this course to fight its boss.</p>
          <Link href="/courses" className="mt-3 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">See unlock options</Link>
        </div>
      )}

      {home?.access === 'ok' && (
        <>
          {/* Your boss */}
          <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#0b0f14] via-[#10161d] to-[#0b0f14] p-4 sm:p-5 text-white">
            <div className="flex items-center gap-3 sm:gap-5">
              <BossOwl mood={home.level && home.level >= 7 ? 'enraged' : 'idle'} className="w-24 sm:w-36 flex-shrink-0" label={`${home.boss_name}, your level ${home.level} boss`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{course?.course_code} · Your boss</p>
                <p className="text-lg sm:text-2xl font-black leading-tight truncate">{home.boss_name}</p>
                <p className="text-sm text-gray-300">Level {home.level} of 10 · rating {home.rating}</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400" style={{ width: `${toNext}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  {home.level && home.level < 10 ? 'Keep winning to face a tougher boss.' : 'The toughest boss there is.'}
                  {home.wins ? ` ${home.wins} KO${home.wins === 1 ? '' : 's'} so far.` : ''}
                </p>
              </div>
            </div>

            {(home.pool ?? 0) < 15 ? (
              <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-gray-300">
                There aren&rsquo;t enough multiple choice questions {free ? 'in your open topics ' : ''}for a fight in {course?.course_code} yet.
              </p>
            ) : (
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <label className="relative flex-1 min-w-0">
                  <span className="sr-only">Topic</span>
                  <select value={topicId} onChange={e => setTopicId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-white/10 border border-white/15 pl-3 pr-9 py-2.5 text-sm font-medium text-white [&>option]:text-gray-900">
                    <option value="">{free ? 'All open topics' : 'The whole course'}</option>
                    {topics.map(t => {
                      const locked = openTopics !== null && !openTopics.includes(t.id);
                      return <option key={t.id} value={t.id} disabled={locked}>{locked ? `🔒 ${t.topic_name}` : t.topic_name}</option>;
                    })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                </label>
                <button onClick={() => start(false)} disabled={!!busy || left === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 font-bold text-white hover:bg-orange-500 disabled:opacity-60">
                  {busy === 'fight' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}Fight
                </button>
              </div>
            )}
            {left !== null && (
              <p className="mt-2 text-xs text-gray-400">
                {left > 0 ? `${left} of ${FREE_FIGHTS_PER_DAY} free fights left today.` : 'That’s your free fights for today. More tomorrow, or '}
                {left === 0 && <Link href="/courses" className="font-semibold text-orange-300 underline">unlock all courses</Link>}
                {left === 0 && ' for unlimited fights.'}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {error}{/Unlock all courses/.test(error) && <> <Link href="/courses" className="font-semibold underline">See unlock options</Link></>}
              </p>
            )}
          </section>

          {/* The Daily Boss */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10" aria-label="The Daily Boss">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0 dark:bg-orange-500/15 dark:text-orange-300"><CalendarDays className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">The Daily Boss</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">The same 12 questions for everyone in {course?.course_code} today. One try. Fastest KO tops the board.</p>
              </div>
            </div>
            <div className="mt-3">
              {free ? (
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                  <Lock className="w-4 h-4" />For students who&rsquo;ve unlocked all courses.
                  <Link href="/courses" className="font-semibold text-blue-600 underline dark:text-blue-400">Unlock</Link>
                </p>
              ) : home.daily?.status === 'open' ? (
                <button onClick={() => start(true)} disabled={!!busy}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900">
                  {busy === 'daily' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}Fight today&rsquo;s Daily Boss
                </button>
              ) : (
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {home.daily?.status === 'won' ? `You knocked it out in ${formatFightTime(home.daily.time_ms)}.` : 'Done for today. A new Daily Boss arrives tomorrow.'}
                </p>
              )}
            </div>
            {board.length > 0 ? (
              <ol className="mt-3 divide-y divide-gray-100 dark:divide-white/10" aria-label="Today’s fastest knockouts">
                {board.map(r => (
                  <li key={r.user_id} className={`flex items-center gap-3 py-2 ${r.is_me ? 'bg-orange-50/70 -mx-2 px-2 rounded-lg dark:bg-orange-500/10' : ''}`}>
                    <span className="w-7 text-center font-bold text-gray-500 tabular-nums flex-shrink-0 dark:text-gray-400">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
                    <Avatar src={r.avatar_url} name={r.first_name} size="sm" />
                    <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{r.first_name}{r.is_me && <span className="text-orange-600 dark:text-orange-400"> (you)</span>}</p>
                    <span className="flex items-center gap-0.5 text-xs text-gray-500 flex-shrink-0 dark:text-gray-400" aria-label={`${r.hearts} hearts left`}><Heart className="w-3.5 h-3.5 fill-red-500 text-red-500" />{r.hearts}</span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0 dark:text-gray-100">{formatFightTime(r.time_ms)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">No knockouts yet today. Be the first on the board.</p>
            )}
          </section>

          {/* Trophies */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10" aria-label="Your trophies">
            <p className="font-semibold text-gray-900 dark:text-gray-100">Your {course?.course_code} trophies</p>
            {home.trophies && home.trophies.length > 0 ? (
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {home.trophies.map(t => (
                  <li key={t.topic_id ?? 'course'} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 min-w-0 dark:bg-white/[0.04]">
                    <Trophy className={`w-5 h-5 flex-shrink-0 ${t.gold ? 'text-amber-500' : 'text-gray-400'}`} />
                    <span className="min-w-0 flex-1 text-sm text-gray-900 truncate dark:text-gray-100">{t.topic_name ?? 'Whole course'}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0 dark:text-gray-400">{t.gold ? 'Gold · ' : ''}{formatFightTime(t.best_time_ms)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Knock out a boss to win its trophy. Win without losing a heart for gold.</p>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10">
            <button onClick={() => setShowHow(v => !v)} aria-expanded={showHow} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              How it works<ChevronDown className={`w-4 h-4 transition-transform ${showHow ? 'rotate-180' : ''}`} />
            </button>
            {showHow && (
              <ul className="px-4 pb-4 space-y-1.5 text-sm text-gray-600 list-disc pl-8 dark:text-gray-400">
                <li>You have 20 seconds to answer each question (24 for multiple choice) before the boss&rsquo;s attack bar fills. A right answer hits the boss; a quick one hits harder.</li>
                <li>Three right in a row charges a power strike: your next hit does double damage.</li>
                <li>A wrong answer or a time-out costs one of your 3 hearts, and you&rsquo;ll see the right answer.</li>
                <li>At half health the boss is enraged: less time to answer.</li>
                <li>The boss learns how good you are. Win more and you face a higher level: harder questions and a boss that takes more hits. Struggle and it eases off.</li>
                <li>Fights earn XP and trophies. They don&rsquo;t change your course grade.</li>
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

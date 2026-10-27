'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Card, Avatar } from '@/components/ui';
import { coursesForProgram } from '@/lib/programs';
import { AchievementsPanel } from './Achievements';
import { Trophy, Medal, Award, Crown, BookOpen, Layers, Globe, Eye, EyeOff, Loader2 } from 'lucide-react';

// Leaderboards and achievements in one place (migration 040). Three
// boards — one course, the student's level, everyone — ranked by correct
// answers this week or all time, plus the achievements grid.

type Tab = 'course' | 'level' | 'general' | 'achievements';
type Period = 'week' | 'all';

interface BoardRow {
  rank: number;
  user_id: string;
  first_name: string;
  avatar_url: string | null;
  points: number;
  tests: number;
  accuracy: number | string | null;
  is_me: boolean;
}

const TABS: { key: Tab; label: string; icon: typeof Trophy }[] = [
  { key: 'course', label: 'My course', icon: BookOpen },
  { key: 'level', label: 'My level', icon: Layers },
  { key: 'general', label: 'General', icon: Globe },
  { key: 'achievements', label: 'Achievements', icon: Award },
];

const BOARD_LIMIT = 25;

function rankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-6 h-6 text-yellow-500" aria-label="1st" />;
  if (rank === 2) return <Medal className="w-6 h-6 text-gray-400 dark:text-gray-500" aria-label="2nd" />;
  if (rank === 3) return <Award className="w-6 h-6 text-amber-600" aria-label="3rd" />;
  return <span className="font-semibold text-gray-500 tabular-nums dark:text-gray-400">#{rank}</span>;
}

function LeaderboardInner() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some(t => t.key === tabParam) ? (tabParam as Tab) : 'course';
  const [period, setPeriod] = useState<Period>('week');
  const [courses, setCourses] = useState<{ id: string; course_code: string; course_name: string }[] | null>(null);
  const [courseId, setCourseId] = useState<string>('');
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState<boolean | null>(null);
  const [savingVisible, setSavingVisible] = useState(false);

  const setTab = (next: Tab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });

  // The student's courses at their level, for the course picker; their
  // free course first if it's one of them.
  useEffect(() => {
    if (!user?.program_id || !user.selected_level || !user.selected_semester) { setCourses([]); return; }
    coursesForProgram(createClient(), user.program_id)
      .eq('level', user.selected_level).eq('semester', user.selected_semester).order('course_code')
      .then(({ data }: { data: { id: string; course_code: string; course_name: string }[] | null }) => {
        const list = data ?? [];
        setCourses(list);
        const free = list.find(c => c.course_code.toUpperCase() === user.free_course_code?.toUpperCase());
        setCourseId(prev => prev || free?.id || list[0]?.id || '');
      });
  }, [user?.program_id, user?.selected_level, user?.selected_semester, user?.free_course_code]);

  // "Show me on leaderboards" (absent before migration 040).
  useEffect(() => {
    if (!user?.id) return;
    createClient().from('users').select('leaderboard_visible').eq('id', user.id).maybeSingle()
      .then(({ data, error: err }: { data: { leaderboard_visible?: boolean } | null; error: unknown }) => {
        if (!err && data && typeof data.leaderboard_visible === 'boolean') setVisible(data.leaderboard_visible);
      });
  }, [user?.id]);

  const load = useCallback(async () => {
    if (tab === 'achievements') return;
    if (tab === 'course' && !courseId) { setRows([]); return; }
    setRows(null);
    setError('');
    const { data, error: err } = await createClient().rpc('get_leaderboard_board', {
      p_scope: tab, p_course: tab === 'course' ? courseId : null, p_period: period, p_limit: BOARD_LIMIT,
    });
    if (err) { setError('Couldn’t load the leaderboard. Please try again.'); setRows([]); return; }
    setRows((data ?? []) as BoardRow[]);
  }, [tab, courseId, period]);
  useEffect(() => { load(); }, [load]);

  const toggleVisible = async () => {
    if (visible === null) return;
    setSavingVisible(true);
    const { error: err } = await createClient().rpc('set_leaderboard_visible', { p_visible: !visible });
    setSavingVisible(false);
    if (!err) { setVisible(!visible); load(); }
  };

  const top = (rows ?? []).filter(r => r.rank <= BOARD_LIMIT);
  const me = (rows ?? []).find(r => r.is_me);
  const meOutside = me && me.rank > BOARD_LIMIT;
  const scopeLabel = tab === 'course'
    ? courses?.find(c => c.id === courseId)?.course_code ?? 'this course'
    : tab === 'level' ? `Level ${user?.selected_level ?? ''}` : 'everyone';

  const row = (r: BoardRow) => (
    <div key={r.user_id} className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3.5 ${r.is_me ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}>
      <div className="w-9 flex justify-center flex-shrink-0">{rankIcon(r.rank)}</div>
      <Avatar src={r.avatar_url} name={r.first_name} size="md" />
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${r.is_me ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
          {r.first_name}{r.is_me && ' (you)'}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{r.tests} {Number(r.tests) === 1 ? 'test' : 'tests'}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="font-bold text-gray-900 tabular-nums dark:text-gray-100">{r.points} pts</p>
        {r.accuracy !== null && <p className="text-sm text-gray-500 tabular-nums dark:text-gray-400">{Math.round(Number(r.accuracy))}% right</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Leaderboard</h1>
        <p className="text-gray-600 dark:text-gray-400">See how you rank, and the badges you&rsquo;ve earned</p>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-white/10" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'achievements' ? (
        user && <AchievementsPanel userId={user.id} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {tab === 'course' && (
              <>
                <label htmlFor="board-course" className="sr-only">Course</label>
                <select
                  id="board-course"
                  value={courseId}
                  onChange={e => setCourseId(e.target.value)}
                  disabled={!courses?.length}
                  className="w-full sm:w-auto sm:min-w-[16rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/15 dark:text-gray-100"
                >
                  {(courses ?? []).map(c => <option key={c.id} value={c.id}>{c.course_code} · {c.course_name}</option>)}
                </select>
              </>
            )}
            <div className="inline-flex self-start sm:ml-auto rounded-lg bg-gray-100 p-0.5 dark:bg-white/10">
              {(['week', 'all'] as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  aria-pressed={period === p}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold ${period === p ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {p === 'week' ? 'This week' : 'All time'}
                </button>
              ))}
            </div>
          </div>

          {me && (
            <div className="flex items-center gap-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-500/20 dark:bg-blue-500/10">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0">#{me.rank}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">Your rank in {scopeLabel}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {me.rank === 1 ? 'You’re leading!' : `${me.points} pts ${period === 'week' ? 'this week' : 'so far'}. Keep practising to climb.`}
                </p>
              </div>
            </div>
          )}

          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center gap-2 dark:border-white/10">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                Top in {scopeLabel} · {period === 'week' ? 'this week' : 'all time'}
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/10">
              {rows === null ? (
                <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : error ? (
                <p className="p-8 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : top.length === 0 ? (
                <div className="p-10 text-center text-gray-500 dark:text-gray-400">
                  <Trophy className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-white/10" />
                  <p>No one is on this board {period === 'week' ? 'this week' : 'yet'}.</p>
                  <p className="text-sm mt-1">Take a quiz to be first.</p>
                </div>
              ) : (
                <>
                  {top.map(row)}
                  {meOutside && me && (
                    <>
                      <p className="px-6 py-1.5 text-center text-xs text-gray-400 dark:text-gray-500">…</p>
                      {row(me)}
                    </>
                  )}
                </>
              )}
            </div>
          </Card>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Points are correct answers in quizzes, mock exams and class battles. Boards show first names only.
          </p>

          {visible !== null && (
            <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
              {visible ? <Eye className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" /> : <EyeOff className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Show me on leaderboards</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {visible ? 'Other students can see your first name and points.' : 'You’re hidden. Only you can see your position.'}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={visible}
                aria-label="Show me on leaderboards"
                onClick={toggleVisible}
                disabled={savingVisible}
                className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-60 ${visible ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={null}>
      <LeaderboardInner />
    </Suspense>
  );
}

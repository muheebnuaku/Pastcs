'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { usePricing } from '@/lib/hooks/usePricing';
import { useCountdown } from '@/lib/hooks/useCountdown';
import { createClient } from '@/lib/supabase/client';
import { coursesForProgram } from '@/lib/programs';
import { Card, CardContent, Badge, Button } from '@/components/ui';
import { COURSE_ICONS, getStreakMessage, formatPercentage, getExamMotivation, getPerformanceNote, type ExamUrgency } from '@/lib/utils';
import { LevelSemesterModal } from '../courses/components/LevelSemesterModal';
import { PaywallModal } from '../courses/components/PaywallModal';
import type { Course, Test, WeakTopic, UserAchievement } from '@/types';
import {
  Flame,
  Trophy,
  Target,
  BookOpen,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Lock,
  GraduationCap,
  Zap,
  ShieldCheck,
  Sparkles,
  CalendarClock,
  Pencil,
} from 'lucide-react';

// Colors the Exam Countdown card's motivation banner by urgency — calm
// blue far out, escalating to red right before the exam.
const URGENCY_STYLES: Record<ExamUrgency, string> = {
  unset:   'bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-400',
  calm:    'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300',
  steady:  'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300',
  focused: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
  urgent:  'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300',
  today:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
  passed:  'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400',
};

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const [courses, setCourses] = useState<Course[]>([]);
  const [recentTests, setRecentTests] = useState<Test[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [stats, setStats] = useState({ totalTests: 0, avgScore: 0, coursesCount: 0 });
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  // Exam countdown
  const [editingExamDate, setEditingExamDate] = useState(false);
  const [examDateInput, setExamDateInput] = useState('');
  const [savingExamDate, setSavingExamDate] = useState(false);

  const daysUntilExam = user?.exam_date
    ? Math.ceil((new Date(user.exam_date + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null;
  const examMotivation = getExamMotivation(daysUntilExam);

  // Live-ticking down to midnight of the exam date — exam_date has no
  // time of day, so once "today" arrives there's nothing meaningful left
  // to count down to; the card falls back to a plain "Exam is today!"
  // message for that case (see below).
  const examTargetDate = user?.exam_date ? new Date(user.exam_date + 'T00:00:00') : null;
  const countdown = useCountdown(examTargetDate);

  const saveExamDate = async () => {
    if (!user?.id || !examDateInput) return;
    setSavingExamDate(true);
    const supabase = createClient();
    await supabase.from('users').update({ exam_date: examDateInput }).eq('id', user.id);
    await refreshUser();
    setSavingExamDate(false);
    setEditingExamDate(false);
  };

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const isPaid = hasActiveSub(level, semester);
  const { label: priceLabel } = usePricing(level);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const supabase = createClient();

      let coursesQuery = user?.program_id
        ? coursesForProgram(supabase, user.program_id).order('course_code')
        : supabase.from('courses').select('*').order('course_code');
      if (level && semester) {
        coursesQuery = coursesQuery.eq('level', level).eq('semester', semester);
      }
      const { data: coursesData } = await coursesQuery;

      const { data: testsData } = await supabase
        .from('tests')
        .select('*, course:courses(*)')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: weakTopicsData } = await supabase
        .rpc('get_weak_topics', { p_user_id: user?.id, p_limit: 5 });

      const { data: achievementsData } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(*)')
        .eq('user_id', user?.id)
        .order('earned_at', { ascending: false })
        .limit(4);

      const { data: statsData } = await supabase
        .from('tests')
        .select('score, percentage, course_id')
        .eq('user_id', user?.id);

      if (coursesData) setCourses(coursesData);
      if (testsData) setRecentTests(testsData);
      if (weakTopicsData) setWeakTopics(weakTopicsData);
      if (achievementsData) setAchievements(achievementsData);

      if (statsData) {
        // Scoped to the current level/semester's courses — otherwise a
        // test taken before switching semester (or in a course outside
        // the current one) skews "Avg. Score" and "Tests Taken" for
        // courses the student isn't even practising anymore. Uses the
        // just-fetched coursesData (already filtered), not the courses
        // state var, since state hasn't updated within this same call.
        const currentCourseIds = level && semester
          ? new Set((coursesData ?? []).map((c: Course) => c.id))
          : null; // no level/semester selected yet — show everything
        const typedStats = (statsData as { course_id: string; percentage?: number }[])
          .filter(t => !currentCourseIds || currentCourseIds.has(t.course_id));
        const uniqueCourses = new Set(typedStats.map(t => t.course_id));
        setStats({
          totalTests: typedStats.length,
          avgScore: typedStats.length > 0
            ? typedStats.reduce((acc, t) => acc + (t.percentage || 0), 0) / typedStats.length
            : 0,
          coursesCount: uniqueCourses.size,
        });
      }
    };

    if (user) fetchDashboardData();
  }, [user, level, semester]);

  const lockedCourseCount = !isPaid && user?.free_course_code
    ? Math.max(0, courses.length - 1)
    : 0;

  return (
    <div className="space-y-5 sm:space-y-8 animate-fade-in">
      {showLevelModal && (
        <LevelSemesterModal onSuccess={() => setShowLevelModal(false)} />
      )}
      {showPaywall && courses.length > 0 && (
        <PaywallModal
          courseName={courses.find(c => c.course_code !== user?.free_course_code)?.course_name ?? 'this course'}
          courseCode={courses.find(c => c.course_code !== user?.free_course_code)?.course_code ?? ''}
          totalCourses={courses.length}
          onClose={() => setShowPaywall(false)}
          onSuccess={() => setShowPaywall(false)}
        />
      )}

      {/* ── Welcome Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}!
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-0.5">
            {getStreakMessage(user?.practice_streak || 0)}
          </p>
        </div>
        <Link href="/courses" className="self-start sm:self-auto">
          <Button size="sm" className="sm:size-auto">
            Start Practice
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      {/* ── No level selected ── */}
      {!level && (
        <div className="bg-[#fde3da] dark:bg-[#e8603c]/10 border border-[#f5c3ae] dark:border-[#e8603c]/20 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/70 dark:bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-[#e8603c]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#a13f22] dark:text-[#f0906f] text-sm sm:text-base">
                Set your level to get started
              </p>
              <p className="text-xs sm:text-sm text-[#c14f2c] dark:text-[#e8603c] mt-0.5">
                Tell us which level you&rsquo;re in and we&rsquo;ll load the right courses for you.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLevelModal(true)}
            className="mt-3 w-full bg-[#e8603c] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#c94f2f] transition-colors sm:hidden"
          >
            Select Level
          </button>
          <button
            onClick={() => setShowLevelModal(true)}
            className="hidden sm:block mt-3 bg-[#e8603c] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#c94f2f] transition-colors"
          >
            Select Level
          </button>
        </div>
      )}

      {/* ── Upgrade prompt ── */}
      {level && lockedCourseCount > 0 && (
        <div className="rounded-2xl border border-[#f5c3ae] dark:border-[#e8603c]/20 bg-gradient-to-r from-[#fde3da] to-[#fbe9b8] dark:from-[#e8603c]/10 dark:to-[#dba514]/10 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 bg-white/70 dark:bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                <Lock className="w-5 h-5 text-[#e8603c]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">
                  {lockedCourseCount} course{lockedCourseCount > 1 ? 's' : ''} locked — unlock all for {priceLabel}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {[
                    { icon: Zap, text: `All ${courses.length} courses` },
                    { icon: ShieldCheck, text: 'Exam simulation' },
                    { icon: Sparkles, text: 'AI explanations' },
                  ].map(({ icon: Icon, text }) => (
                    <span key={text} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                      <Icon className="w-3.5 h-3.5 text-[#e8603c] flex-shrink-0" />
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowPaywall(true)}
              className="flex-shrink-0 bg-[#e8603c] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#c94f2f] transition-colors whitespace-nowrap w-full sm:w-auto"
            >
              Unlock All — {priceLabel}
            </button>
          </div>
        </div>
      )}

      {/* ── Stats Cards — 2×2 on mobile, 4-col on lg ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Streak */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 sm:p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="w-9 h-9 bg-[#fde3da] dark:bg-[#e8603c]/15 rounded-xl flex items-center justify-center mb-3">
            <Flame className="w-5 h-5 text-[#e8603c]" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {user?.practice_streak || 0}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">Day Streak</p>
        </div>

        {/* Tests Taken */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 sm:p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="w-9 h-9 bg-[#dcf1ee] dark:bg-[#2f9e8f]/15 rounded-xl flex items-center justify-center mb-3">
            <Target className="w-5 h-5 text-[#2f9e8f]" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {stats.totalTests}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">Tests Taken</p>
        </div>

        {/* Avg Score */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 sm:p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="w-9 h-9 bg-green-100 dark:bg-green-500/15 rounded-xl flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {formatPercentage(stats.avgScore)}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">Avg. Score</p>
        </div>

        {/* Courses Practiced */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 sm:p-5 border border-gray-100 dark:border-white/10 shadow-sm">
          <div className="w-9 h-9 bg-[#fbe9b8] dark:bg-[#dba514]/15 rounded-xl flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5 text-[#b0842a] dark:text-[#dba514]" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {stats.coursesCount}/{courses.length || '—'}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">Courses Practiced</p>
        </div>
      </div>

      {/* ── Main grid: Courses + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-8">
        {/* Courses list */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">
                {level ? `Level ${level} Courses` : 'Your Courses'}
              </h2>
              <Link href="/courses" className="text-xs sm:text-sm text-[#e8603c] hover:underline">
                View All
              </Link>
            </div>
            <CardContent className="space-y-1 sm:space-y-2 px-2 sm:px-4">
              {courses.slice(0, 4).map((course) => {
                const isLocked = !isPaid && course.course_code !== user?.free_course_code && !!user?.free_course_code;
                return (
                  <Link
                    key={course.id}
                    href={`/courses/${course.course_code.toLowerCase()}`}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 dark:bg-white/10 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                      {isLocked
                        ? <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 dark:text-gray-500" />
                        : course.icon || COURSE_ICONS[course.course_code] || '📚'
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className={`font-medium text-sm sm:text-base truncate ${isLocked ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                          {course.course_code}
                        </p>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{course.total_questions}q</span>
                      </div>
                      <p className={`text-xs sm:text-sm truncate ${isLocked ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
                        {course.course_name}
                      </p>
                    </div>
                    {isLocked && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                        Locked
                      </span>
                    )}
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5 sm:space-y-6">
          {/* Exam Countdown & Study Plan */}
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                Exam Countdown
              </h2>
              {user?.exam_date && !editingExamDate && (
                <button
                  onClick={() => { setExamDateInput(user.exam_date ?? ''); setEditingExamDate(true); }}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Change exam date"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <CardContent className="px-3 sm:px-6">
              {!user?.exam_date || editingExamDate ? (
                <div className="space-y-3 py-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Set your exam date for a countdown and a focused study list.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={examDateInput}
                      onChange={e => setExamDateInput(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-base border border-gray-300 dark:border-white/15 dark:bg-white/5 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                    <Button size="sm" onClick={saveExamDate} isLoading={savingExamDate} disabled={!examDateInput}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-1">
                  <div className="p-4 bg-violet-50 dark:bg-violet-500/10 rounded-xl">
                    {countdown && daysUntilExam !== null && daysUntilExam > 0 ? (
                      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                        {([
                          ['Days', countdown.days],
                          ['Hrs', countdown.hours],
                          ['Min', countdown.minutes],
                          ['Sec', countdown.seconds],
                        ] as const).map(([label, value]) => (
                          <div key={label} className="text-center">
                            <p className="text-xl sm:text-3xl font-bold text-violet-900 dark:text-violet-300 tabular-nums">
                              {String(value).padStart(2, '0')}
                            </p>
                            <p className="text-[9px] sm:text-[10px] text-violet-500 dark:text-violet-400 font-semibold uppercase tracking-wide mt-0.5">
                              {label}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-3xl font-bold text-violet-900 dark:text-violet-300 tabular-nums">
                          {daysUntilExam !== null && daysUntilExam >= 0 ? daysUntilExam : 0}
                        </p>
                        <p className="text-sm text-violet-600 dark:text-violet-400 font-medium mt-0.5">
                          {daysUntilExam !== null && daysUntilExam < 0
                            ? 'Exam date has passed'
                            : 'Exam is today!'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Motivation — escalates in tone as the exam gets closer */}
                  <div className={`rounded-xl px-3 py-2.5 text-sm leading-relaxed ${URGENCY_STYLES[examMotivation.urgency]}`}>
                    {examMotivation.text}
                  </div>

                  {/* Performance — what the countdown's urgency is measured against */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    {getPerformanceNote(stats.avgScore, stats.totalTests)}
                  </p>

                  {weakTopics.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        Focus on
                      </p>
                      <ul className="space-y-1.5">
                        {weakTopics.slice(0, 3).map(topic => (
                          <li key={topic.topic_id}>
                            <Link
                              href={`/practice/${topic.course_code.toLowerCase()}?topic=${topic.topic_id}`}
                              className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-violet-700 dark:hover:text-violet-300 group"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                              <span className="truncate flex-1 group-hover:underline">{topic.topic_name}</span>
                              <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0 tabular-nums">
                                {Math.round(topic.accuracy)}%
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{topic.course_code}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Weak Topics */}
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Topics to Review
              </h2>
            </div>
            <CardContent className="px-3 sm:px-6">
              {weakTopics.length > 0 ? (
                <div className="space-y-2">
                  {weakTopics.map((topic) => (
                    <Link
                      key={topic.topic_id}
                      href={`/practice/${topic.course_code.toLowerCase()}?topic=${topic.topic_id}`}
                      className="block p-3 bg-yellow-50 dark:bg-yellow-500/10 rounded-xl hover:bg-yellow-100 dark:hover:bg-yellow-500/15 transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate pr-2 group-hover:underline">{topic.topic_name}</p>
                        <Badge variant="warning" size="sm">
                          {formatPercentage(topic.accuracy)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{topic.course_code}</p>
                        <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          Practice this →
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  Take some tests to see your weak topics
                </p>
              )}
            </CardContent>
          </Card>

          {/* Achievements */}
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                Achievements
              </h2>
            </div>
            <CardContent className="px-3 sm:px-6">
              {achievements.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {achievements.map((ua) => (
                    <div
                      key={ua.id}
                      className="p-3 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-500/10 dark:to-orange-500/10 rounded-xl text-center"
                    >
                      <p className="text-2xl mb-1">
                        {ua.achievement?.icon === 'trophy' ? '🏆'
                          : ua.achievement?.icon === 'medal' ? '🥇'
                          : ua.achievement?.icon === 'star' ? '⭐' : '🔥'}
                      </p>
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight">
                        {ua.achievement?.name}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                  Complete tests to earn achievements!
                </p>
              )}
              <Link
                href="/achievements"
                className="block text-center text-xs sm:text-sm text-[#e8603c] hover:underline mt-4"
              >
                View All Achievements
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Recent Tests ── */}
      <Card>
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">Recent Tests</h2>
        </div>

        {recentTests.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">
            No tests taken yet — start practising to see your results here!
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="divide-y divide-gray-100 dark:divide-white/10 md:hidden">
              {recentTests.map((test) => (
                <div key={test.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{test.course?.icon || COURSE_ICONS[test.course?.course_code || ''] || '📚'}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{test.course?.course_code}</span>
                      <Badge variant={test.test_type === 'exam_simulation' ? 'info' : 'default'} size="sm">
                        {test.test_type === 'exam_simulation' ? 'Exam' : 'Practice'}
                      </Badge>
                    </div>
                    <span className={`text-sm font-semibold ${
                      test.percentage >= 70 ? 'text-green-600 dark:text-green-400'
                      : test.percentage >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {formatPercentage(test.percentage)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {test.score}/{test.total_questions} &middot; {new Date(test.created_at).toLocaleDateString()}
                    </span>
                    <Link href={`/results/${test.id}`} className="text-xs text-[#e8603c] hover:underline font-medium">
                      View Details
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-white/[0.03]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Course</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {recentTests.map((test) => (
                    <tr key={test.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{test.course?.icon || COURSE_ICONS[test.course?.course_code || ''] || '📚'}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{test.course?.course_code}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={test.test_type === 'exam_simulation' ? 'info' : 'default'}>
                          {test.test_type === 'exam_simulation' ? 'Exam' : 'Practice'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-semibold ${
                          test.percentage >= 70 ? 'text-green-600 dark:text-green-400'
                          : test.percentage >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {test.score}/{test.total_questions} ({formatPercentage(test.percentage)})
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                        {new Date(test.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/results/${test.id}`} className="text-[#e8603c] hover:underline text-sm">
                          View Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

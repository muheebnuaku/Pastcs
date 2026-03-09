'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { useSubscriptionStore } from '@/lib/store';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Badge, Button } from '@/components/ui';
import { COURSE_ICONS, getStreakMessage, formatPercentage } from '@/lib/utils';
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
} from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();
  const { hasActiveSub } = useSubscriptionStore();

  const [courses, setCourses] = useState<Course[]>([]);
  const [recentTests, setRecentTests] = useState<Test[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [stats, setStats] = useState({ totalTests: 0, avgScore: 0, coursesCount: 0 });
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const isPaid = hasActiveSub(level, semester);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const supabase = createClient();

      let coursesQuery = supabase.from('courses').select('*').order('course_code');
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
        const typedStats = statsData as { course_id: string; percentage?: number }[];
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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}!
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-0.5">
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
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-blue-900 text-sm sm:text-base">
                Set your level to get started
              </p>
              <p className="text-xs sm:text-sm text-blue-600 mt-0.5">
                Tell us which level you&rsquo;re in and we&rsquo;ll load the right courses for you.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLevelModal(true)}
            className="mt-3 w-full bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors sm:hidden"
          >
            Select Level
          </button>
          <button
            onClick={() => setShowLevelModal(true)}
            className="hidden sm:block mt-3 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Select Level
          </button>
        </div>
      )}

      {/* ── Upgrade prompt ── */}
      {level && lockedCourseCount > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm sm:text-base">
                {lockedCourseCount} course{lockedCourseCount > 1 ? 's' : ''} locked this semester
              </p>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                You&rsquo;re using 1 of {courses.length} courses free. Unlock everything for just GHC 50.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowPaywall(true)}
            className="mt-3 w-full bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors sm:hidden"
          >
            Unlock All — GHC 50
          </button>
          <button
            onClick={() => setShowPaywall(true)}
            className="hidden sm:block mt-3 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Unlock All — GHC 50
          </button>
        </div>
      )}

      {/* ── Stats Cards — 2×2 on mobile, 4-col on lg ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Streak */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center mb-3">
            <Flame className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none">
            {user?.practice_streak || 0}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Day Streak</p>
        </div>

        {/* Tests Taken */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center mb-3">
            <Target className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none">
            {stats.totalTests}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Tests Taken</p>
        </div>

        {/* Avg Score */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none">
            {formatPercentage(stats.avgScore)}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Avg. Score</p>
        </div>

        {/* Courses Practiced */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm">
          <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none">
            {stats.coursesCount}/{courses.length || '—'}
          </p>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Courses Practiced</p>
        </div>
      </div>

      {/* ── Main grid: Courses + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-8">
        {/* Courses list */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm sm:text-base">
                {level ? `Level ${level} Courses` : 'Your Courses'}
              </h2>
              <Link href="/courses" className="text-xs sm:text-sm text-blue-600 hover:underline">
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
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                      {isLocked
                        ? <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                        : COURSE_ICONS[course.course_code]
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className={`font-medium text-sm sm:text-base truncate ${isLocked ? 'text-gray-400' : 'text-gray-900'}`}>
                          {course.course_code}
                        </p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{course.total_questions}q</span>
                      </div>
                      <p className={`text-xs sm:text-sm truncate ${isLocked ? 'text-gray-400' : 'text-gray-500'}`}>
                        {course.course_name}
                      </p>
                    </div>
                    {isLocked && (
                      <span className="text-xs text-gray-400 flex-shrink-0 bg-gray-100 px-2 py-0.5 rounded-full">
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
          {/* Weak Topics */}
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Topics to Review
              </h2>
            </div>
            <CardContent className="px-3 sm:px-6">
              {weakTopics.length > 0 ? (
                <div className="space-y-2">
                  {weakTopics.map((topic) => (
                    <div key={topic.topic_id} className="p-3 bg-yellow-50 rounded-xl">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-medium text-gray-900 text-sm truncate pr-2">{topic.topic_name}</p>
                        <Badge variant="warning" size="sm">
                          {formatPercentage(topic.accuracy)}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">{topic.course_code}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  Take some tests to see your weak topics
                </p>
              )}
            </CardContent>
          </Card>

          {/* Achievements */}
          <Card>
            <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
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
                      className="p-3 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl text-center"
                    >
                      <p className="text-2xl mb-1">
                        {ua.achievement?.icon === 'trophy' ? '🏆'
                          : ua.achievement?.icon === 'medal' ? '🥇'
                          : ua.achievement?.icon === 'star' ? '⭐' : '🔥'}
                      </p>
                      <p className="text-xs font-medium text-gray-900 leading-tight">
                        {ua.achievement?.name}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  Complete tests to earn achievements!
                </p>
              )}
              <Link
                href="/achievements"
                className="block text-center text-xs sm:text-sm text-blue-600 hover:underline mt-4"
              >
                View All Achievements
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Recent Tests ── */}
      <Card>
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm sm:text-base">Recent Tests</h2>
        </div>

        {recentTests.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-500 text-sm">
            No tests taken yet — start practising to see your results here!
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="divide-y divide-gray-100 md:hidden">
              {recentTests.map((test) => (
                <div key={test.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{COURSE_ICONS[test.course?.course_code || '']}</span>
                      <span className="font-medium text-gray-900 text-sm">{test.course?.course_code}</span>
                      <Badge variant={test.test_type === 'exam_simulation' ? 'info' : 'default'} size="sm">
                        {test.test_type === 'exam_simulation' ? 'Exam' : 'Practice'}
                      </Badge>
                    </div>
                    <span className={`text-sm font-semibold ${
                      test.percentage >= 70 ? 'text-green-600'
                      : test.percentage >= 50 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {formatPercentage(test.percentage)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {test.score}/{test.total_questions} &middot; {new Date(test.created_at).toLocaleDateString()}
                    </span>
                    <Link href={`/results/${test.id}`} className="text-xs text-blue-600 hover:underline font-medium">
                      View Details
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Course</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentTests.map((test) => (
                    <tr key={test.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{COURSE_ICONS[test.course?.course_code || '']}</span>
                          <span className="font-medium text-gray-900">{test.course?.course_code}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={test.test_type === 'exam_simulation' ? 'info' : 'default'}>
                          {test.test_type === 'exam_simulation' ? 'Exam' : 'Practice'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-semibold ${
                          test.percentage >= 70 ? 'text-green-600'
                          : test.percentage >= 50 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {test.score}/{test.total_questions} ({formatPercentage(test.percentage)})
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {new Date(test.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/results/${test.id}`} className="text-blue-600 hover:underline text-sm">
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

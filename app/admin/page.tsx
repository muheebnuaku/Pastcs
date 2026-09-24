'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui';
import { COURSE_ICONS, formatPercentage, needsQuestionReview } from '@/lib/utils';
import type { AdminStats, CourseStats, Course, Program } from '@/types';
import {
  Users,
  FileQuestion,
  Target,
  BookOpen,
  AlertTriangle,
  Layers,
  MessageSquareQuote,
  ArrowRight,
  UserPlus,
  Clock,
} from 'lucide-react';

interface ProgramSummary {
  id: string;
  name: string;
  short_code: string;
  courseCount: number;
  studentCount: number;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [newStudentsThisWeek, setNewStudentsThisWeek] = useState(0);
  const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
  const [programSummaries, setProgramSummaries] = useState<ProgramSummary[]>([]);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [pendingQuestions, setPendingQuestions] = useState(0);
  const [pendingTestimonials, setPendingTestimonials] = useState(0);
  const [recentActivity, setRecentActivity] = useState<{
    id: string;
    score: number;
    total_questions: number;
    percentage: number;
    test_type: string;
    created_at: string;
    user?: { full_name: string | null; email: string };
    course?: { course_code: string };
  }[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      const supabase = createClient();
      // Calendar week (Monday 00:00 local time), not a rolling 7×24h
      // window — a rolling window looks "this week" but actually drops
      // students as they age past exactly 7 days, so the count can visibly
      // fall even on a day with new signups. A calendar week only grows
      // until it resets at the next Monday, matching what the label promises.
      const now = new Date();
      const daysSinceMonday = (now.getDay() + 6) % 7;
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
      const startOfWeekIso = startOfWeek.toISOString();

      // Fetch counts
      const [
        { count: studentsCount },
        { count: newStudentsCount },
        { count: questionsCount },
        { count: testsCount },
        { data: courseProgramRows },
        { data: programsData },
        { data: questionRows },
        { count: pendingTestimonialsCount },
      ] = await Promise.all([
        supabase.from('user_public').select('*', { count: 'exact', head: true }).eq('role', 'student'),
        supabase.from('user_public').select('*', { count: 'exact', head: true }).eq('role', 'student').gte('created_at', startOfWeekIso),
        supabase.from('questions').select('*', { count: 'exact', head: true }),
        supabase.from('tests').select('*', { count: 'exact', head: true }),
        supabase.from('course_programs').select('course_id, program_id'),
        supabase.from('programs').select('*').order('name'),
        supabase.from('questions').select('times_answered, times_correct, is_approved'),
        supabase.from('testimonials').select('*', { count: 'exact', head: true }).eq('is_approved', false),
      ]);

      setNewStudentsThisWeek(newStudentsCount || 0);
      setFlaggedCount((questionRows ?? []).filter(needsQuestionReview).length);
      setPendingQuestions((questionRows ?? []).filter((q: { is_approved: boolean }) => !q.is_approved).length);
      setPendingTestimonials(pendingTestimonialsCount || 0);

      // "Active" = actually assigned to at least one program — a course
      // with zero program assignments is invisible to every student, so
      // counting/listing it here alongside real, live courses is
      // misleading rather than just harmlessly extra.
      const activeCourseIds = [...new Set((courseProgramRows ?? []).map((r: { course_id: string }) => r.course_id))];

      if (activeCourseIds.length > 0) {
        const { data: courses } = await supabase
          .from('courses')
          .select('*')
          .in('id', activeCourseIds);

        if (courses) {
          const statsPromises = courses.map(async (course: Course) => {
            const { count: questionCount } = await supabase
              .from('questions')
              .select('*', { count: 'exact', head: true })
              .eq('course_id', course.id);

            const { data: tests } = await supabase
              .from('tests')
              .select('percentage')
              .eq('course_id', course.id);

            const avgScore = tests && tests.length > 0
              ? tests.reduce((acc: number, t: { percentage: number | null }) => acc + (t.percentage || 0), 0) / tests.length
              : 0;

            return {
              course_id: course.id,
              course_code: course.course_code,
              course_name: course.course_name,
              course_icon: course.icon || '',
              total_questions: questionCount || 0,
              total_tests: tests?.length || 0,
              avg_score: avgScore,
            };
          });

          setCourseStats(await Promise.all(statsPromises));
        }
      } else {
        setCourseStats([]);
      }

      // Programs summary — course + student count per program, so it's
      // obvious at a glance whether a program is actually populated or
      // just created and forgotten.
      if (programsData) {
        const courseCountByProgram = new Map<string, number>();
        for (const row of (courseProgramRows ?? []) as { program_id: string }[]) {
          courseCountByProgram.set(row.program_id, (courseCountByProgram.get(row.program_id) ?? 0) + 1);
        }

        const { data: studentProgramRows } = await supabase
          .from('user_public')
          .select('program_id')
          .eq('role', 'student')
          .not('program_id', 'is', null);
        const studentCountByProgram = new Map<string, number>();
        for (const row of (studentProgramRows ?? []) as { program_id: string }[]) {
          studentCountByProgram.set(row.program_id, (studentCountByProgram.get(row.program_id) ?? 0) + 1);
        }

        setProgramSummaries((programsData as Program[]).map(p => ({
          id: p.id,
          name: p.name,
          short_code: p.short_code,
          courseCount: courseCountByProgram.get(p.id) ?? 0,
          studentCount: studentCountByProgram.get(p.id) ?? 0,
        })));
      }

      // Fetch recent tests
      const { data: recentTests } = await supabase
        .from('tests')
        .select('*, user:users(full_name, email), course:courses(course_code)')
        .order('created_at', { ascending: false })
        .limit(5);

      if (recentTests) setRecentActivity(recentTests);

      setStats({
        total_students: studentsCount || 0,
        total_questions: questionsCount || 0,
        total_tests: testsCount || 0,
        most_difficult_topics: [],
      });
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400">Overview of the platform statistics</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-blue-100 dark:bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 sm:w-7 sm:h-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none dark:text-gray-100">{stats?.total_students ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">
                Total Students
                {newStudentsThisWeek > 0 && (
                  <span className="text-green-600 dark:text-green-400 font-medium"> · +{newStudentsThisWeek} this week</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-green-100 dark:bg-green-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileQuestion className="w-5 h-5 sm:w-7 sm:h-7 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none dark:text-gray-100">{stats?.total_questions ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Total Questions</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-purple-100 dark:bg-purple-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Target className="w-5 h-5 sm:w-7 sm:h-7 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none dark:text-gray-100">{stats?.total_tests ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Tests Taken</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-orange-100 dark:bg-orange-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 sm:w-7 sm:h-7 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none dark:text-gray-100">{courseStats.length}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Active Courses</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Needs Attention */}
      {(pendingQuestions > 0 || flaggedCount > 0 || pendingTestimonials > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingQuestions > 0 && (
            <Link href="/admin/questions" className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{pendingQuestions} question{pendingQuestions !== 1 ? 's' : ''} pending review</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Not visible to students until approved</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          )}
          {flaggedCount > 0 && (
            <Link href="/admin/questions" className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 dark:bg-red-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{flaggedCount} question{flaggedCount !== 1 ? 's' : ''} flagged for review</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Low accuracy over many attempts — likely ambiguous or mis-keyed</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          )}
          {pendingTestimonials > 0 && (
            <Link href="/admin/testimonials" className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                    <MessageSquareQuote className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{pendingTestimonials} testimonial{pendingTestimonials !== 1 ? 's' : ''} awaiting approval</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Review and publish, or dismiss</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Course Statistics */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Course Statistics</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {courseStats.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                No active courses yet — assign a course to a program on the Courses page.
              </div>
            ) : courseStats.map((course) => (
              <div key={course.course_id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{course.course_icon || COURSE_ICONS[course.course_code] || '📚'}</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{course.course_code}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{course.course_name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{formatPercentage(course.avg_score)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">avg score</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>{course.total_questions} questions</span>
                  <span>•</span>
                  <span>{course.total_tests} tests taken</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Activity */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h2>
            <Link href="/admin/analytics?tab=engagement" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {recentActivity.length > 0 ? (
              recentActivity.map((activity) => (
                <div key={activity.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {activity.user?.full_name || activity.user?.email}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Completed {activity.course?.course_code} {activity.test_type === 'exam_simulation' ? 'exam' : 'practice'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${
                        activity.percentage >= 70 ? 'text-green-600 dark:text-green-400' :
                        activity.percentage >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatPercentage(activity.percentage)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(activity.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                No recent activity
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Programs */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Programs
          </h2>
          <Link href="/admin/courses?tab=programs" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            Manage <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/10">
          {programSummaries.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">No programs yet</div>
          ) : programSummaries.map(p => (
            <div key={p.id} className="px-6 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{p.short_code}</span>
                </div>
                {p.courseCount === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3" /> No courses assigned yet
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 flex-shrink-0 text-sm">
                <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                  <BookOpen className="w-3.5 h-3.5" />{p.courseCount}
                </span>
                <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                  <UserPlus className="w-3.5 h-3.5" />{p.studentCount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui';
import { COURSE_ICONS, formatPercentage } from '@/lib/utils';
import type { AdminStats, CourseStats, Course } from '@/types';
import {
  Users,
  FileQuestion,
  Target,
  TrendingUp,
  BookOpen,
  AlertTriangle,
} from 'lucide-react';

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
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

      // Fetch counts
      const { count: studentsCount } = await supabase
        .from('user_public')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'student');

      const { count: questionsCount } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true });

      const { count: testsCount } = await supabase
        .from('tests')
        .select('*', { count: 'exact', head: true });

      // Fetch course stats
      const { data: courses } = await supabase
        .from('courses')
        .select('*');

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

        const courseStatsData = await Promise.all(statsPromises);
        setCourseStats(courseStatsData);
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
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600">Overview of the platform statistics</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 sm:w-7 sm:h-7 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none">{stats?.total_students ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Total Students</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileQuestion className="w-5 h-5 sm:w-7 sm:h-7 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none">{stats?.total_questions ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Total Questions</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Target className="w-5 h-5 sm:w-7 sm:h-7 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none">{stats?.total_tests ?? '—'}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Tests Taken</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-14 sm:h-14 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 sm:w-7 sm:h-7 text-orange-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-3xl font-bold text-gray-900 leading-none">{courseStats.length}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Active Courses</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Course Statistics */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Course Statistics</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {courseStats.map((course) => (
              <div key={course.course_id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{course.course_icon || COURSE_ICONS[course.course_code] || '📚'}</span>
                    <div>
                      <p className="font-medium text-gray-900">{course.course_code}</p>
                      <p className="text-xs text-gray-500">{course.course_name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatPercentage(course.avg_score)}</p>
                    <p className="text-xs text-gray-500">avg score</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
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
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentActivity.length > 0 ? (
              recentActivity.map((activity) => (
                <div key={activity.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {activity.user?.full_name || activity.user?.email}
                      </p>
                      <p className="text-sm text-gray-600">
                        Completed {activity.course?.course_code} {activity.test_type === 'exam_simulation' ? 'exam' : 'practice'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${
                        activity.percentage >= 70 ? 'text-green-600' : 
                        activity.percentage >= 50 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {formatPercentage(activity.percentage)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center text-gray-500">
                No recent activity
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

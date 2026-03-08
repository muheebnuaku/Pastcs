'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Badge, Button } from '@/components/ui';
import { COURSE_ICONS, getStreakMessage, formatPercentage } from '@/lib/utils';
import type { Course, Test, WeakTopic, UserAchievement } from '@/types';
import {
  Flame,
  Trophy,
  Target,
  BookOpen,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [recentTests, setRecentTests] = useState<Test[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [stats, setStats] = useState({ totalTests: 0, avgScore: 0, coursesCount: 0 });
  useEffect(() => {
    const fetchDashboardData = async () => {
      const supabase = createClient();

      // Fetch courses
      const { data: coursesData } = await supabase
        .from('courses')
        .select('*')
        .order('course_code');
      
      // Fetch recent tests
      const { data: testsData } = await supabase
        .from('tests')
        .select('*, course:courses(*)')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(5);

      // Fetch weak topics
      const { data: weakTopicsData } = await supabase
        .rpc('get_weak_topics', { p_user_id: user?.id, p_limit: 5 });

      // Fetch user achievements
      const { data: achievementsData } = await supabase
        .from('user_achievements')
        .select('*, achievement:achievements(*)')
        .eq('user_id', user?.id)
        .order('earned_at', { ascending: false })
        .limit(4);

      // Calculate stats
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

    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.full_name?.split(' ')[0] || 'Student'}! 👋
          </h1>
          <p className="text-gray-600">{getStreakMessage(user?.practice_streak || 0)}</p>
        </div>
        <Link href="/courses">
          <Button>
            Start Practice
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <Flame className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{user?.practice_streak || 0}</p>
              <p className="text-sm text-gray-600">Day Streak</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Target className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.totalTests}</p>
              <p className="text-sm text-gray-600">Tests Taken</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{formatPercentage(stats.avgScore)}</p>
              <p className="text-sm text-gray-600">Avg. Score</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.coursesCount}/6</p>
              <p className="text-sm text-gray-600">Courses Practiced</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Courses Progress */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Your Courses</h2>
              <Link href="/courses" className="text-sm text-blue-600 hover:underline">
                View All
              </Link>
            </div>
            <CardContent className="space-y-4">
              {courses.slice(0, 4).map((course) => (
                <Link 
                  key={course.id} 
                  href={`/courses/${course.course_code.toLowerCase()}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                    {COURSE_ICONS[course.course_code]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-gray-900">{course.course_code}</p>
                      <span className="text-sm text-gray-500">{course.total_questions} questions</span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{course.course_name}</p>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Weak Topics & Recommendations */}
        <div className="space-y-6">
          {/* Weak Topics */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Topics to Review
              </h2>
            </div>
            <CardContent>
              {weakTopics.length > 0 ? (
                <div className="space-y-3">
                  {weakTopics.map((topic) => (
                    <div key={topic.topic_id} className="p-3 bg-yellow-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-gray-900 text-sm">{topic.topic_name}</p>
                        <Badge variant="warning" size="sm">
                          {formatPercentage(topic.accuracy)}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-600">{topic.course_code}</p>
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

          {/* Recent Achievements */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                Achievements
              </h2>
            </div>
            <CardContent>
              {achievements.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {achievements.map((ua) => (
                    <div 
                      key={ua.id} 
                      className="p-3 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-lg text-center"
                    >
                      <p className="text-2xl mb-1">{ua.achievement?.icon === 'trophy' ? '🏆' : ua.achievement?.icon === 'medal' ? '🥇' : ua.achievement?.icon === 'star' ? '⭐' : '🔥'}</p>
                      <p className="text-xs font-medium text-gray-900">{ua.achievement?.name}</p>
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
                className="block text-center text-sm text-blue-600 hover:underline mt-4"
              >
                View All Achievements
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Tests */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Tests</h2>
        </div>
        <div className="overflow-x-auto">
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
              {recentTests.length > 0 ? (
                recentTests.map((test) => (
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
                        test.percentage >= 70 ? 'text-green-600' : 
                        test.percentage >= 50 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {test.score}/{test.total_questions} ({formatPercentage(test.percentage)})
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(test.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <Link 
                        href={`/results/${test.id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No tests taken yet. Start practicing to see your results here!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

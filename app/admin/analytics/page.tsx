'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Select } from '@/components/ui';
import { COURSE_ICONS, formatPercentage } from '@/lib/utils';
import type { Course, Topic } from '@/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  Users,
  Target,
  Activity,
  Sparkles,
  Coins,
} from 'lucide-react';

interface TestTrend {
  date: string;
  tests: number;
  avg_score: number;
}

interface TopicPerformance {
  topic_name: string;
  avg_score: number;
  total_questions: number;
}

interface DifficultyCounts {
  easy: number;
  medium: number;
  hard: number;
}

interface TestData {
  created_at: string;
  user_id: string;
  percentage: number;
}

interface FeatureUsage {
  feature: string;
  calls: number;
  totalTokens: number;
}

const COLORS = ['#22c55e', '#eab308', '#ef4444'];

const FEATURE_LABELS: Record<string, string> = {
  assistant_chat: 'AI Tutor Chat',
  generate_lesson: 'Lesson Generator',
  generate_questions: 'Question Generator',
  check_answer: 'Answer Grading',
  parse_pdf_topic: 'Topic Detection',
  parse_pdf_vision_ocr: 'Scanned-PDF OCR',
  lesson_images: 'Lesson Images',
};

export default function AdminAnalyticsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');

  const [testTrends, setTestTrends] = useState<TestTrend[]>([]);
  const [topicPerformance, setTopicPerformance] = useState<TopicPerformance[]>([]);
  const [difficultyCounts, setDifficultyCounts] = useState<DifficultyCounts>({ easy: 0, medium: 0, hard: 0 });
  const [overallStats, setOverallStats] = useState({
    totalTests: 0,
    avgScore: 0,
    activeStudents: 0,
    passRate: 0,
  });

  const [aiUsage, setAiUsage] = useState<FeatureUsage[]>([]);
  const [aiUsageTotal, setAiUsageTotal] = useState({ calls: 0, tokens: 0 });

  // Platform-wide, not course-scoped — how much the 6 AI features have
  // actually cost, previously invisible anywhere.
  useEffect(() => {
    const fetchAiUsage = async () => {
      const supabase = createClient();
      const since = new Date();
      since.setDate(since.getDate() - 30);

      try {
        const { data } = await supabase
          .from('ai_usage_log')
          .select('feature, total_tokens')
          .gte('created_at', since.toISOString())
          .limit(10000);

        const rows = (data ?? []) as { feature: string; total_tokens: number }[];
        const byFeature = new Map<string, FeatureUsage>();
        for (const row of rows) {
          const existing = byFeature.get(row.feature) ?? { feature: row.feature, calls: 0, totalTokens: 0 };
          existing.calls += 1;
          existing.totalTokens += row.total_tokens ?? 0;
          byFeature.set(row.feature, existing);
        }
        const grouped = [...byFeature.values()].sort((a, b) => b.totalTokens - a.totalTokens);
        setAiUsage(grouped);
        setAiUsageTotal({
          calls: rows.length,
          tokens: rows.reduce((sum, r) => sum + (r.total_tokens ?? 0), 0),
        });
      } catch {
        // ai_usage_log not migrated on this environment yet
      }
    };
    fetchAiUsage();
  }, []);

  useEffect(() => {
    const fetchCourses = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('courses')
        .select('*')
        .order('course_code');
      
      if (data) {
        setCourses(data);
        if (data.length > 0) {
          setSelectedCourse(data[0].id);
        }
      }
    };

    fetchCourses();
  }, []);

  useEffect(() => {
    if (!selectedCourse) return;

    const fetchAnalytics = async () => {
      const supabase = createClient();

      // Fetch tests for selected course
      const { data: tests } = await supabase
        .from('tests')
        .select('*')
        .eq('course_id', selectedCourse)
        .order('created_at', { ascending: true });

      const typedTests = (tests || []) as TestData[];

      if (typedTests.length > 0) {
        // Calculate test trends (last 7 days)
        const today = new Date();
        const trends: TestTrend[] = [];
        
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          
          const dayTests = typedTests.filter(t => 
            t.created_at.startsWith(dateStr)
          );
          
          trends.push({
            date: date.toLocaleDateString('en', { weekday: 'short' }),
            tests: dayTests.length,
            avg_score: dayTests.length > 0
              ? dayTests.reduce((acc, t) => acc + (t.percentage || 0), 0) / dayTests.length
              : 0,
          });
        }
        setTestTrends(trends);

        // Calculate overall stats
        const uniqueUsers = new Set(typedTests.map(t => t.user_id));
        const avgScore = typedTests.length > 0
          ? typedTests.reduce((acc, t) => acc + (t.percentage || 0), 0) / typedTests.length
          : 0;
        const passedTests = typedTests.filter(t => t.percentage >= 50).length;

        setOverallStats({
          totalTests: typedTests.length,
          avgScore,
          activeStudents: uniqueUsers.size,
          passRate: typedTests.length > 0 ? (passedTests / typedTests.length) * 100 : 0,
        });
      }

      // Fetch topics and calculate performance
      const { data: topics } = await supabase
        .from('topics')
        .select('*')
        .eq('course_id', selectedCourse);

      if (topics) {
        const topicStats = await Promise.all(
          (topics as Topic[]).map(async (topic) => {
            const { data: answers } = await supabase
              .from('test_answers')
              .select('is_correct, question:questions!inner(topic_id)')
              .eq('question.topic_id', topic.id);

            const totalQuestions = answers?.length || 0;
            const correctAnswers = answers?.filter((a: { is_correct: boolean }) => a.is_correct).length || 0;
            const avgScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

            return {
              topic_name: topic.topic_name,
              avg_score: avgScore,
              total_questions: totalQuestions,
            };
          })
        );

        setTopicPerformance(topicStats.filter(t => t.total_questions > 0));
      }

      // Fetch question difficulty distribution
      const { data: questions } = await supabase
        .from('questions')
        .select('difficulty')
        .eq('course_id', selectedCourse);

      if (questions) {
        const counts = { easy: 0, medium: 0, hard: 0 };
        questions.forEach((q: { difficulty: string }) => {
          counts[q.difficulty as keyof typeof counts]++;
        });
        setDifficultyCounts(counts);
      }
    };

    fetchAnalytics();
  }, [selectedCourse]);

  const difficultyData = [
    { name: 'Easy', value: difficultyCounts.easy },
    { name: 'Medium', value: difficultyCounts.medium },
    { name: 'Hard', value: difficultyCounts.hard },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
          <p className="text-gray-600 dark:text-gray-400">Performance insights and statistics</p>
        </div>
        <Select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-full sm:w-48"
          options={courses.map(c => ({
            value: c.id,
            label: `${c.icon || COURSE_ICONS[c.course_code] || ''} ${c.course_code}`,
          }))}
        />
      </div>

      {/* AI Usage — platform-wide, not course-scoped */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI Usage — Last 30 Days (All Courses)
          </h2>
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <span>{aiUsageTotal.calls.toLocaleString()} calls</span>
            <span className="flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-amber-500" />
              {aiUsageTotal.tokens.toLocaleString()} tokens
            </span>
          </div>
        </div>
        <CardContent>
          {aiUsage.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, aiUsage.length * 44)}>
              <BarChart data={aiUsage.map(u => ({ ...u, label: FEATURE_LABELS[u.feature] ?? u.feature }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={160} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number, name: string) => [value.toLocaleString(), name === 'totalTokens' ? 'Tokens' : 'Calls']} />
                <Bar dataKey="totalTokens" fill="#7c3aed" radius={[0, 4, 4, 0]} name="Tokens" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-10 text-center text-gray-500 text-sm dark:text-gray-400">
              No AI usage recorded yet — this table only exists once <code className="bg-gray-100 px-1.5 py-0.5 rounded dark:bg-white/10">005_chat_history_and_ai_usage.sql</code> has been run.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Target className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-none dark:text-gray-100">{overallStats.totalTests}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Total Tests</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 dark:bg-green-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-none dark:text-gray-100">
                {formatPercentage(overallStats.avgScore)}
              </p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Avg Score</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 dark:bg-purple-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-none dark:text-gray-100">{overallStats.activeStudents}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Active Students</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 dark:bg-orange-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-gray-900 leading-none dark:text-gray-100">
                {formatPercentage(overallStats.passRate)}
              </p>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 dark:text-gray-400">Pass Rate</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Trends Chart */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Tests & Scores (Last 7 Days)</h2>
          </div>
          <CardContent>
            {testTrends.some(t => t.tests > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={testTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                  <Tooltip />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="tests"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    name="Tests"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avg_score"
                    stroke="#22c55e"
                    strokeWidth={2}
                    name="Avg Score %"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500 dark:text-gray-400">
                No test data for the last 7 days
              </div>
            )}
          </CardContent>
        </Card>

        {/* Difficulty Distribution */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Question Difficulty Distribution</h2>
          </div>
          <CardContent>
            {difficultyData.some(d => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={difficultyData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {difficultyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500 dark:text-gray-400">
                No questions in this course yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Topic Performance */}
        <Card className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Performance by Topic</h2>
          </div>
          <CardContent>
            {topicPerformance.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topicPerformance} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis 
                    dataKey="topic_name" 
                    type="category" 
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Avg Score']}
                  />
                  <Bar 
                    dataKey="avg_score" 
                    fill="#3b82f6"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500 dark:text-gray-400">
                No topic performance data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

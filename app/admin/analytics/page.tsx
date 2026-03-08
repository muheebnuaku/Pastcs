'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Select, Loading } from '@/components/ui';
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

const COLORS = ['#22c55e', '#eab308', '#ef4444'];

export default function AdminAnalyticsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [testTrends, setTestTrends] = useState<TestTrend[]>([]);
  const [topicPerformance, setTopicPerformance] = useState<TopicPerformance[]>([]);
  const [difficultyCounts, setDifficultyCounts] = useState<DifficultyCounts>({ easy: 0, medium: 0, hard: 0 });
  const [overallStats, setOverallStats] = useState({
    totalTests: 0,
    avgScore: 0,
    activeStudents: 0,
    passRate: 0,
  });

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
      setIsLoading(true);
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

      setIsLoading(false);
    };

    fetchAnalytics();
  }, [selectedCourse]);

  const difficultyData = [
    { name: 'Easy', value: difficultyCounts.easy },
    { name: 'Medium', value: difficultyCounts.medium },
    { name: 'Hard', value: difficultyCounts.hard },
  ];

  if (isLoading && courses.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading analytics..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600">Performance insights and statistics</p>
        </div>
        <Select
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          className="w-48"
          options={courses.map(c => ({
            value: c.id,
            label: `${COURSE_ICONS[c.course_code] || ''} ${c.course_code}`,
          }))}
        />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Target className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{overallStats.totalTests}</p>
              <p className="text-sm text-gray-600">Total Tests</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {formatPercentage(overallStats.avgScore)}
              </p>
              <p className="text-sm text-gray-600">Average Score</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{overallStats.activeStudents}</p>
              <p className="text-sm text-gray-600">Active Students</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {formatPercentage(overallStats.passRate)}
              </p>
              <p className="text-sm text-gray-600">Pass Rate</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Trends Chart */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tests & Scores (Last 7 Days)</h2>
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
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No test data for the last 7 days
              </div>
            )}
          </CardContent>
        </Card>

        {/* Difficulty Distribution */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Question Difficulty Distribution</h2>
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
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {difficultyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No questions in this course yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Topic Performance */}
        <Card className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Performance by Topic</h2>
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
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No topic performance data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

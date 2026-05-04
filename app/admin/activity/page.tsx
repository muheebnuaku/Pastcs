'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, Badge } from '@/components/ui';
import { formatPercentage } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, Activity, Target, BotMessageSquare, FileText,
  Volume2, Zap, Clock, BookOpen, RefreshCw,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DayStat { date: string; tests: number }
interface TypeStat { name: string; value: number; color: string }
interface CourseStat { course_code: string; count: number }
interface FeedItem {
  id: string;
  test_type: string;
  percentage: number;
  created_at: string;
  user?: { full_name: string | null; email: string } | null;
  course?: { course_code: string } | null;
}
interface FeatureStat { event: string; count: number; label: string; icon: React.ReactNode; color: string }

const TYPE_COLORS = ['#3b82f6', '#8b5cf6'];
const FEATURE_LABELS: Record<string, { label: string; color: string }> = {
  ai_chat:          { label: 'AI Tutor Chat',      color: 'bg-blue-100 text-blue-700'   },
  document_upload:  { label: 'Document Lesson',    color: 'bg-indigo-100 text-indigo-700' },
  voice_enabled:    { label: 'Voice Reading',      color: 'bg-purple-100 text-purple-700' },
  practice_start:   { label: 'Practice Started',   color: 'bg-green-100 text-green-700'  },
  exam_start:       { label: 'Exam Started',        color: 'bg-orange-100 text-orange-700'},
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminActivityPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats
  const [totalUsers, setTotalUsers] = useState(0);
  const [activeUsers7d, setActiveUsers7d] = useState(0);
  const [testsToday, setTestsToday] = useState(0);
  const [avgScore, setAvgScore] = useState(0);

  // Charts
  const [dayStats, setDayStats] = useState<DayStat[]>([]);
  const [typeStats, setTypeStats] = useState<TypeStat[]>([]);
  const [courseStats, setCourseStats] = useState<CourseStat[]>([]);

  // Feed
  const [feed, setFeed] = useState<FeedItem[]>([]);

  // Feature events
  const [featureStats, setFeatureStats] = useState<FeatureStat[]>([]);
  const [hasFeatureTable, setHasFeatureTable] = useState(false);

  const load = async () => {
    const supabase = createClient();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [
      { count: userCount },
      { data: tests30d },
      { data: recentFeed },
      { data: courses },
    ] = await Promise.all([
      supabase.from('user_public').select('*', { count: 'exact', head: true }).eq('role', 'student'),
      supabase.from('tests').select('created_at, test_type, percentage, user_id').gte('created_at', thirtyDaysAgo),
      supabase.from('tests')
        .select('id, test_type, percentage, created_at, user:user_public(full_name, email), course:courses(course_code)')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('courses').select('id, course_code'),
    ]);

    // Overview stats
    setTotalUsers(userCount ?? 0);

    if (tests30d) {
      const todayTests = tests30d.filter(t => t.created_at >= todayStart);
      setTestsToday(todayTests.length);

      const activeIds = new Set(
        tests30d.filter(t => t.created_at >= sevenDaysAgo).map(t => t.user_id)
      );
      setActiveUsers7d(activeIds.size);

      const scores = tests30d.map(t => t.percentage).filter(Boolean);
      setAvgScore(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);

      // Day-by-day chart (last 14 days)
      const dayMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        dayMap.set(d.toISOString().slice(0, 10), 0);
      }
      for (const t of tests30d) {
        const day = t.created_at.slice(0, 10);
        if (dayMap.has(day)) dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
      }
      setDayStats(Array.from(dayMap.entries()).map(([date, tests]) => ({
        date: date.slice(5), tests,
      })));

      // Test type split
      const practice = tests30d.filter(t => t.test_type === 'practice').length;
      const exam = tests30d.filter(t => t.test_type === 'exam_simulation').length;
      setTypeStats([
        { name: 'Practice', value: practice, color: TYPE_COLORS[0] },
        { name: 'Exam Sim', value: exam,     color: TYPE_COLORS[1] },
      ]);

      // Top courses (from recent feed)
    }

    if (recentFeed) setFeed(recentFeed as FeedItem[]);

    // Top courses from all tests
    if (tests30d && courses) {
      const courseMap = new Map<string, number>();
      for (const t of tests30d) {
        // we don't have course_code here — derive from feed's course data
      }
      // Build from the feed instead (has course_code)
      const topMap = new Map<string, number>();
      for (const item of (recentFeed ?? []) as FeedItem[]) {
        const cc = item.course?.course_code;
        if (cc) topMap.set(cc, (topMap.get(cc) ?? 0) + 1);
      }
      setCourseStats(
        Array.from(topMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([course_code, count]) => ({ course_code, count }))
      );
    }

    // Feature events (optional table)
    try {
      const { data: evts, error } = await supabase
        .from('feature_events')
        .select('event')
        .gte('created_at', thirtyDaysAgo);

      if (!error && evts) {
        setHasFeatureTable(true);
        const counts = new Map<string, number>();
        for (const e of evts) counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
        setFeatureStats(
          Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([event, count]) => ({
              event,
              count,
              label: FEATURE_LABELS[event]?.label ?? event,
              color: FEATURE_LABELS[event]?.color ?? 'bg-gray-100 text-gray-700',
              icon: getFeatureIcon(event),
            }))
        );
      }
    } catch { /* table doesn't exist yet */ }

    setLoading(false);
    setRefreshing(false);
  };

  function getFeatureIcon(event: string) {
    const map: Record<string, React.ReactNode> = {
      ai_chat:         <BotMessageSquare className="w-4 h-4" />,
      document_upload: <FileText className="w-4 h-4" />,
      voice_enabled:   <Volume2 className="w-4 h-4" />,
      practice_start:  <Zap className="w-4 h-4" />,
      exam_start:      <Clock className="w-4 h-4" />,
    };
    return map[event] ?? <Activity className="w-4 h-4" />;
  }

  useEffect(() => { load(); }, []);

  const refresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600" />
            Activity Monitor
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Live feature usage — last 30 days</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Setup notice if feature_events table missing */}
      {!hasFeatureTable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Enable full feature tracking</p>
          <p className="mb-2 text-amber-700">Run this SQL in Supabase to track AI chat, voice, and document uploads:</p>
          <pre className="bg-amber-100 rounded-lg p-3 text-xs overflow-x-auto text-amber-900 select-all">{`create table feature_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  event text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on feature_events (event, created_at desc);
create index on feature_events (user_id, created_at desc);`}</pre>
        </div>
      )}

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Students', value: totalUsers, icon: <Users className="w-5 h-5 text-blue-600" />, bg: 'bg-blue-50' },
          { label: 'Tests Today', value: testsToday, icon: <Target className="w-5 h-5 text-green-600" />, bg: 'bg-green-50' },
          { label: 'Active (7d)', value: activeUsers7d, icon: <Activity className="w-5 h-5 text-purple-600" />, bg: 'bg-purple-50' },
          { label: 'Avg Score (30d)', value: formatPercentage(avgScore), icon: <BookOpen className="w-5 h-5 text-orange-500" />, bg: 'bg-orange-50' },
        ].map(({ label, value, icon, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                {icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Tests per day */}
        <Card className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tests — Last 14 Days</h2>
          </div>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayStats} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="tests" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Test type split */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Test Types</h2>
          </div>
          <CardContent className="pt-4 flex flex-col items-center gap-4">
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={typeStats} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                  {typeStats.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-4">
              {typeStats.map(t => (
                <div key={t.name} className="flex items-center gap-1.5 text-sm">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                  <span className="text-gray-600">{t.name}</span>
                  <span className="font-semibold text-gray-900">{t.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature usage + top courses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Feature events */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Feature Usage (30d)</h2>
          </div>
          <CardContent className="pt-4">
            {hasFeatureTable && featureStats.length > 0 ? (
              <div className="space-y-3">
                {featureStats.map(f => (
                  <div key={f.event} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${f.color}`}>
                      {f.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800">{f.label}</span>
                        <span className="text-sm font-bold text-gray-900">{f.count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.round((f.count / (featureStats[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{hasFeatureTable ? 'No events yet' : 'Run the SQL above to enable tracking'}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top courses */}
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Top Courses (last 30 tests)</h2>
          </div>
          <CardContent className="pt-4">
            {courseStats.length > 0 ? (
              <div className="space-y-3">
                {courseStats.map((c, i) => (
                  <div key={c.course_code} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">{c.course_code}</span>
                        <span className="text-sm font-bold text-gray-900">{c.count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.round((c.count / (courseStats[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No test data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Live activity feed */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Activity</h2>
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
        <div className="divide-y divide-gray-50">
          {feed.length > 0 ? feed.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                item.test_type === 'exam_simulation' ? 'bg-purple-100' : 'bg-blue-100'
              }`}>
                {item.test_type === 'exam_simulation'
                  ? <Clock className="w-4 h-4 text-purple-600" />
                  : <Zap className="w-4 h-4 text-blue-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.user?.full_name || item.user?.email || 'Unknown user'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.course && (
                    <span className="text-xs text-gray-500 font-medium">{item.course.course_code}</span>
                  )}
                  <Badge variant={item.test_type === 'exam_simulation' ? 'info' : 'default'} size="sm">
                    {item.test_type === 'exam_simulation' ? 'Exam' : 'Practice'}
                  </Badge>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-bold ${
                  item.percentage >= 70 ? 'text-green-600' : item.percentage >= 50 ? 'text-yellow-600' : 'text-red-500'
                }`}>
                  {formatPercentage(item.percentage)}
                </p>
                <p className="text-xs text-gray-400">{timeAgo(item.created_at)}</p>
              </div>
            </div>
          )) : (
            <p className="text-sm text-gray-400 text-center py-12">No activity yet</p>
          )}
        </div>
      </Card>
    </div>
  );
}

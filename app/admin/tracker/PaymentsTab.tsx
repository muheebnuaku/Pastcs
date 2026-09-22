'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, Badge, Button } from '@/components/ui';
import {
  DollarSign, BotMessageSquare, GraduationCap, Gift, Sparkles,
  Loader2, RefreshCw, TrendingUp, TrendingDown, Download,
} from 'lucide-react';

interface Totals {
  revenue: number;
  courseRevenue: number;
  tutorRevenue: number;
  courseSubCount: number;
  tutorCreditCount: number;
  freePassCount: number;
}

interface DayRevenue { date: string; course: number; tutor: number }
interface LevelRevenue { level: number; revenue: number; count: number }
interface PlanRevenue { plan: string; planName: string; revenue: number; count: number }
interface Payment {
  id: string;
  type: 'course' | 'tutor';
  userEmail: string;
  userName: string | null;
  amount: number;
  description: string;
  createdAt: string;
}

interface TrackerData {
  totals: Totals;
  revenueByDay: DayRevenue[];
  courseRevenueByLevel: LevelRevenue[];
  tutorRevenueByPlan: PlanRevenue[];
  recentPayments: Payment[];
}

const formatGHC = (pesewas: number) => `GHC ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Payments and revenue — split out of the former Tracker page (see the
// AuditLogTab sibling for the other half of the merged super-admin
// "oversight" page).
export function PaymentsTab() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [insight, setInsight] = useState('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');

  const [fromDate, setFromDate] = useState(() => toDateInput(new Date(Date.now() - 29 * 86400000)));
  const [toDate, setToDate] = useState(() => toDateInput(new Date()));

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/tracker?from=${fromDate}&to=${toDate}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tracker data');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracker data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Date', 'Type', 'User', 'Email', 'Amount (GHC)', 'Description'];
    const rows = data.recentPayments.map(p => [
      new Date(p.createdAt).toISOString(),
      p.type === 'course' ? 'Course' : 'AI Tutor',
      p.userName || '',
      p.userEmail,
      (p.amount / 100).toFixed(2),
      p.description,
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pastcs-payments-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateInsight = async () => {
    if (!data) return;
    setInsightLoading(true);
    setInsightError('');
    try {
      const res = await fetch('/api/admin/tracker/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totals: data.totals,
          revenueByDay: data.revenueByDay,
          courseRevenueByLevel: data.courseRevenueByLevel,
          tutorRevenueByPlan: data.tutorRevenueByPlan,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to generate insights');
      setInsight(json.insight);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : 'Failed to generate insights');
    } finally {
      setInsightLoading(false);
    }
  };

  const last7 = data ? data.revenueByDay.slice(-7).reduce((s, d) => s + d.course + d.tutor, 0) : 0;
  const prev7 = data ? data.revenueByDay.slice(-14, -7).reduce((s, d) => s + d.course + d.tutor, 0) : 0;
  const trendPct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;

  const chartData = data?.revenueByDay.map(d => ({
    date: d.date.slice(5), // MM-DD
    Course: d.course / 100,
    'AI Tutor': d.tutor / 100,
  })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 dark:text-gray-300 dark:border-white/10 dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <span className="text-sm text-gray-400 dark:text-gray-500">to</span>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            max={toDateInput(new Date())}
            onChange={(e) => setToDate(e.target.value)}
            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700 dark:text-gray-300 dark:border-white/10 dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors dark:text-gray-400 dark:border-white/10 dark:hover:bg-white/[0.03]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
        </div>
      ) : data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 bg-amber-50 dark:bg-amber-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 leading-tight dark:text-gray-100 truncate">{formatGHC(data.totals.revenue)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total revenue</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-50 dark:bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 leading-tight dark:text-gray-100 truncate">{formatGHC(data.totals.courseRevenue)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{data.totals.courseSubCount} course access sales</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 bg-indigo-50 dark:bg-indigo-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                  <BotMessageSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 leading-tight dark:text-gray-100 truncate">{formatGHC(data.totals.tutorRevenue)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{data.totals.tutorCreditCount} AI Tutor packs sold</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 bg-green-50 dark:bg-green-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Gift className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-gray-900 leading-tight dark:text-gray-100">{data.totals.freePassCount}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Free passes granted</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* AI Insights */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
                <Sparkles className="w-4 h-4 text-amber-500" />
                AI Insights
              </h2>
              <Button size="sm" onClick={generateInsight} disabled={insightLoading}>
                {insightLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analyzing…</>
                ) : (
                  <><Sparkles className="w-3.5 h-3.5 mr-1.5" />{insight ? 'Regenerate' : 'Generate Insights'}</>
                )}
              </Button>
            </div>
            <CardContent>
              {insightError && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-3">{insightError}</p>
              )}
              {insight ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{insight}</p>
              ) : !insightError && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
                  Ask AI to read the numbers below and tell you what&apos;s actually going on — what&apos;s driving revenue, whether the trend is real, and what&apos;s worth a closer look.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Revenue chart */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Revenue — {fromDate} to {toDate}</h2>
              {trendPct !== null && (
                <span className={`flex items-center gap-1 text-xs font-medium ${trendPct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {trendPct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {trendPct >= 0 ? '+' : ''}{trendPct}% vs prior 7 days
                </span>
              )}
            </div>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="courseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="tutorGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}`} />
                  <Tooltip formatter={(value: number, name: string) => [`GHC ${value.toFixed(2)}`, name]} />
                  <Area type="monotone" dataKey="Course" stackId="1" stroke="#3b82f6" fill="url(#courseGrad)" />
                  <Area type="monotone" dataKey="AI Tutor" stackId="1" stroke="#6366f1" fill="url(#tutorGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue by level */}
            <Card>
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Course Access — by Level</h2>
              </div>
              <CardContent className="pt-4">
                {data.courseRevenueByLevel.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8 dark:text-gray-500">No course access sales yet</p>
                ) : (
                  <div className="space-y-3">
                    {data.courseRevenueByLevel.map(l => (
                      <div key={l.level} className="flex items-center gap-3">
                        <span className="w-16 flex-shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-300">Level {l.level}</span>
                        <div className="flex-1">
                          <div className="h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.round((l.revenue / Math.max(...data.courseRevenueByLevel.map(x => x.revenue), 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0 w-24 text-right">{formatGHC(l.revenue)}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-14 text-right">{l.count} sold</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revenue by AI Tutor plan */}
            <Card>
              <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">AI Tutor — by Plan</h2>
              </div>
              <CardContent className="pt-4">
                {data.tutorRevenueByPlan.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8 dark:text-gray-500">No AI Tutor credit sales yet</p>
                ) : (
                  <div className="space-y-3">
                    {data.tutorRevenueByPlan.map(p => (
                      <div key={p.plan} className="flex items-center gap-3">
                        <span className="w-20 flex-shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">{p.planName}</span>
                        <div className="flex-1">
                          <div className="h-2 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${Math.round((p.revenue / Math.max(...data.tutorRevenueByPlan.map(x => x.revenue), 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0 w-24 text-right">{formatGHC(p.revenue)}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-14 text-right">{p.count} sold</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent payments */}
          <Card>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent Payments</h2>
              <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={data.recentPayments.length === 0}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export CSV
              </Button>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-white/5 max-h-[480px] overflow-y-auto">
              {data.recentPayments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12 dark:text-gray-500">No payments yet</p>
              ) : data.recentPayments.map(p => (
                <div key={`${p.type}-${p.id}`} className="flex items-center gap-3 px-6 py-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${p.type === 'course' ? 'bg-blue-100 dark:bg-blue-500/15' : 'bg-indigo-100 dark:bg-indigo-500/15'}`}>
                    {p.type === 'course'
                      ? <GraduationCap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      : <BotMessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{p.userName ?? p.userEmail}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.description}</span>
                      <Badge variant={p.type === 'course' ? 'info' : 'default'} size="sm">
                        {p.type === 'course' ? 'Course' : 'AI Tutor'}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatGHC(p.amount)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

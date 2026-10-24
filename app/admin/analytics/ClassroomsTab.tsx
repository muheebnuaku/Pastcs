'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui';
import { classroomsNotSetUp } from '@/lib/classrooms';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, Eye, UserPlus, Wallet, Percent, RefreshCw, School } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DailyRow { day: string; views: number; joins: number; created: number }
interface TopRoom {
  id: string;
  name: string;
  course_code: string;
  created_at: string;
  members: number;
  messages_7d: number;
  tests_7d: number;
}
interface Stats {
  days: number;
  classrooms_total: number;
  classrooms_new: number;
  members_total: number;
  invite_views: number;
  joins: number;
  joins_free: number;
  joins_paid: number;
  paid_after_join: number;
  paid_after_join_amount: number;
  payments_total: number;
  payments_with_deal: number;
  deal_discount_total: number;
  daily: DailyRow[];
  top: TopRoom[];
}

const RANGES = [7, 30, 90] as const;

function ghc(pesewas: number): string {
  const cedis = pesewas / 100;
  return `GHC ${Number.isInteger(cedis) ? cedis.toLocaleString() : cedis.toFixed(2)}`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Are classrooms working, and do they make or lose money? Everything
// comes from one admin-only RPC (admin_classroom_stats, migration 032).
export function ClassroomsTab() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().rpc('admin_classroom_stats', { p_days: days });
    if (err) {
      setNotReady(classroomsNotSetUp(err));
      if (!classroomsNotSetUp(err)) setError(err.message);
    } else {
      setStats(data as Stats);
      setError('');
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notReady) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        <p className="font-semibold mb-1">Classroom analytics isn&rsquo;t set up yet</p>
        <p className="text-amber-700 dark:text-amber-400">Run migrations 028 to 032 in the Supabase SQL Editor, then refresh.</p>
      </div>
    );
  }

  if (error || !stats) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error || 'Could not load classroom stats.'}</p>;
  }

  const daily = stats.daily.map(d => ({
    ...d,
    label: new Date(`${d.day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' }),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-lg bg-gray-100 dark:bg-white/10">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                days === r
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {r} days
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors dark:text-gray-400 dark:border-white/10 dark:hover:bg-white/[0.03]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: `Classrooms (${stats.classrooms_new} new)`, value: stats.classrooms_total.toLocaleString(), icon: <School className="w-5 h-5 text-blue-600 dark:text-blue-400" />, bg: 'bg-blue-50 dark:bg-blue-500/15' },
          { label: 'Invite opens', value: stats.invite_views.toLocaleString(), icon: <Eye className="w-5 h-5 text-purple-600 dark:text-purple-400" />, bg: 'bg-purple-50 dark:bg-purple-500/15' },
          { label: `Joins (${pct(stats.joins, stats.invite_views)} of opens)`, value: stats.joins.toLocaleString(), icon: <UserPlus className="w-5 h-5 text-green-600 dark:text-green-400" />, bg: 'bg-green-50 dark:bg-green-500/15' },
          { label: 'Members in total', value: stats.members_total.toLocaleString(), icon: <Users className="w-5 h-5 text-orange-500 dark:text-orange-400" />, bg: 'bg-orange-50 dark:bg-orange-500/15' },
        ] as const).map(({ label, value, icon, bg }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>{icon}</div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Money */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><UserPlus className="w-4 h-4 text-green-600 dark:text-green-400" />How people join</div>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">Last {stats.days} days, owners excluded</p>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Free course', value: stats.joins_free, bar: 'bg-green-500' },
                { label: 'Already paid', value: stats.joins_paid, bar: 'bg-blue-500' },
              ].map(({ label, value, bar }) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{label}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{value} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{pct(value, stats.joins_free + stats.joins_paid)}</span></span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden dark:bg-white/10">
                    <div className={`h-full ${bar} rounded-full`} style={{ width: pct(value, stats.joins_free + stats.joins_paid).replace('–', '0%') }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400" />Paid after joining</div>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">Unlocked the classroom&rsquo;s level within 14 days of joining</p>
            <p className="text-3xl font-bold text-gray-900 mt-4 dark:text-gray-100">{stats.paid_after_join}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {pct(stats.paid_after_join, stats.joins)} of joins · {ghc(stats.paid_after_join_amount)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Percent className="w-4 h-4 text-amber-600 dark:text-amber-400" />Class deal</div>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">All payments in the last {stats.days} days</p>
            <p className="text-3xl font-bold text-gray-900 mt-4 dark:text-gray-100">{pct(stats.payments_with_deal, stats.payments_total)}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {stats.payments_with_deal} of {stats.payments_total} payments · {ghc(stats.deal_discount_total)} discount given
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily trend */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Invite opens and joins, by day</h2>
        </div>
        <CardContent className="pt-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={12} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="views" name="Invite opens" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="joins" name="Joins" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="created" name="New classrooms" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Most active classrooms */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Most active classrooms (last 7 days)</h2>
        </div>
        {stats.top.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8 dark:text-gray-500">No classrooms yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Classroom</th>
                  <th className="px-3 py-3 font-medium text-right">Members</th>
                  <th className="px-3 py-3 font-medium text-right">Messages</th>
                  <th className="px-3 py-3 font-medium text-right">Tests</th>
                  <th className="px-6 py-3 font-medium text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {stats.top.map(r => (
                  <tr key={r.id}>
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900 truncate max-w-[16rem] dark:text-gray-100">{r.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{r.course_code}</p>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.members}</td>
                    <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.messages_7d}</td>
                    <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{r.tests_7d}</td>
                    <td className="px-6 py-3 text-right text-gray-500 whitespace-nowrap dark:text-gray-400">{new Date(r.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

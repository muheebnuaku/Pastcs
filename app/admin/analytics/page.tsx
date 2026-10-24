'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { BarChart3, Activity as ActivityIcon, School } from 'lucide-react';
import { PerformanceTab } from './PerformanceTab';
import { EngagementTab } from './EngagementTab';
import { ClassroomsTab } from './ClassroomsTab';

const TABS = [
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'engagement', label: 'Engagement', icon: ActivityIcon },
  { key: 'classrooms', label: 'Classrooms', icon: School },
];

const SUBTITLES: Record<string, string> = {
  performance: 'Performance insights and statistics',
  engagement: 'Platform-wide engagement and feature usage',
  classrooms: 'Invites, joins and what classrooms bring in',
};

// Merges the former standalone Analytics and Activity pages — both were
// "how are tests going" dashboards (course/topic performance vs.
// platform-wide trends + feature usage), living as two separate nav
// items that answered an overlapping question. /admin/activity now
// redirects here with ?tab=engagement (see next.config.ts).
function AnalyticsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const activeTab = requested === 'engagement' || requested === 'classrooms' ? requested : 'performance';

  const setTab = useCallback((key: string) => {
    router.replace(`/admin/analytics${key === 'performance' ? '' : `?tab=${key}`}`, { scroll: false });
  }, [router]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
          <p className="text-gray-600 dark:text-gray-400">{SUBTITLES[activeTab]}</p>
        </div>
        <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      </div>

      {activeTab === 'performance' ? <PerformanceTab /> : activeTab === 'engagement' ? <EngagementTab /> : <ClassroomsTab />}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsTabs />
    </Suspense>
  );
}

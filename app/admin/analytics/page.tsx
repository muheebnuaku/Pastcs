'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { BarChart3, Activity as ActivityIcon } from 'lucide-react';
import { PerformanceTab } from './PerformanceTab';
import { EngagementTab } from './EngagementTab';

const TABS = [
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'engagement', label: 'Engagement', icon: ActivityIcon },
];

// Merges the former standalone Analytics and Activity pages — both were
// "how are tests going" dashboards (course/topic performance vs.
// platform-wide trends + feature usage), living as two separate nav
// items that answered an overlapping question. /admin/activity now
// redirects here with ?tab=engagement (see next.config.ts).
function AnalyticsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'engagement' ? 'engagement' : 'performance';

  const setTab = useCallback((key: string) => {
    router.replace(`/admin/analytics${key === 'engagement' ? '?tab=engagement' : ''}`, { scroll: false });
  }, [router]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {activeTab === 'performance' ? 'Performance insights and statistics' : 'Platform-wide engagement and feature usage'}
          </p>
        </div>
        <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      </div>

      {activeTab === 'performance' ? <PerformanceTab /> : <EngagementTab />}
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

'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { Tabs } from '@/components/ui';
import { Radar, DollarSign, ScrollText } from 'lucide-react';
import { PaymentsTab } from './PaymentsTab';
import { AuditLogTab } from './AuditLogTab';

const TABS = [
  { key: 'payments', label: 'Payments', icon: DollarSign },
  { key: 'audit-log', label: 'Audit Log', icon: ScrollText },
];

// Merges the former standalone Audit Log page in as a tab — both pages
// are super-admin-only oversight data (Tracker: money moved; Audit Log:
// who changed what), and Audit Log was 143 lines on its own. The guard
// below covers both tabs at once instead of each page enforcing it
// independently. /admin/audit-log now redirects here with
// ?tab=audit-log (see next.config.ts).
function TrackerTabs() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'audit-log' ? 'audit-log' : 'payments';

  // The nav link is already hidden from regular admins, but the page
  // itself must enforce this independently — a direct URL visit from a
  // regular admin (who does pass the /admin layout's own guard) should
  // still be turned away before any tracker/audit data ever loads.
  useEffect(() => {
    if (!authLoading && user && user.role !== 'super_admin') {
      router.replace('/admin');
    }
  }, [user, authLoading, router]);

  const setTab = useCallback((key: string) => {
    router.replace(`/admin/tracker${key === 'audit-log' ? '?tab=audit-log' : ''}`, { scroll: false });
  }, [router]);

  if (user && user.role !== 'super_admin') return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-gray-100">
            <Radar className="w-6 h-6 text-amber-500" />
            Tracker
          </h1>
          <p className="text-gray-500 text-sm mt-0.5 dark:text-gray-400">
            Super admin only — {activeTab === 'payments' ? 'every processed payment across the platform, in one place.' : 'who changed what, and when.'}
          </p>
        </div>
        <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      </div>

      {activeTab === 'payments' ? <PaymentsTab /> : <AuditLogTab />}
    </div>
  );
}

export default function TrackerPage() {
  return (
    <Suspense fallback={null}>
      <TrackerTabs />
    </Suspense>
  );
}

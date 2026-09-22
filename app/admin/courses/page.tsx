'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { BookOpen, Layers } from 'lucide-react';
import { CoursesTab } from './CoursesTab';
import { ProgramsTab } from './ProgramsTab';

const TABS = [
  { key: 'courses', label: 'Courses', icon: BookOpen },
  { key: 'programs', label: 'Programs', icon: Layers },
];

// Merges the former standalone Programs page in as a tab — Programs was
// a thin CRUD page (create/rename/delete a program) that's really only
// meaningful in the context of assigning courses to it, which already
// happens inline on this page. /admin/programs now redirects here with
// ?tab=programs (see next.config.ts).
function CoursesTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'programs' ? 'programs' : 'courses';

  const setTab = useCallback((key: string) => {
    router.replace(`/admin/courses${key === 'programs' ? '?tab=programs' : ''}`, { scroll: false });
  }, [router]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {activeTab === 'courses' ? 'Course Management' : 'Programs'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {activeTab === 'courses' ? 'Manage courses and topics' : 'Manage the academic programs students choose from'}
          </p>
        </div>
        <Tabs tabs={TABS} active={activeTab} onChange={setTab} />
      </div>

      {activeTab === 'courses' ? <CoursesTab /> : <ProgramsTab />}
    </div>
  );
}

export default function AdminCoursesPage() {
  return (
    <Suspense fallback={null}>
      <CoursesTabs />
    </Suspense>
  );
}

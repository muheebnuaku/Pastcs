'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  key: string;
  label: string;
  // Matches how icon props are typed elsewhere in the admin panel
  // (e.g. admin/users' roleTabs) — `typeof SomeIcon` from lucide-react,
  // not a LucideIcon import (that's a namespace, not a type, in the
  // installed version).
  icon?: React.ComponentType<{ className?: string }>;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

// Same pill-tab-bar pattern already used inline on admin/users (role
// filter) — pulled out as a shared component since the admin-panel page
// merges (Analytics+Activity, Courses+Programs, Tracker+Audit Log) all
// need one.
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn('inline-flex p-1 bg-gray-100 dark:bg-white/10 rounded-lg', className)}>
      {tabs.map(tab => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            )}
          >
            {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

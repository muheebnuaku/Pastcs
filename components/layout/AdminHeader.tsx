'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

const routeMeta: Record<string, { title: string; description: string }> = {
  '/admin': { title: 'Overview', description: 'Platform at a glance' },
  '/admin/courses': { title: 'Courses', description: 'Manage courses and topics' },
  '/admin/questions': { title: 'Question Bank', description: 'Browse, filter, and edit questions' },
  '/admin/generate': { title: 'AI Generator', description: 'Generate questions from slides or topics' },
  '/admin/students': { title: 'Students', description: 'View students and manage access' },
  '/admin/analytics': { title: 'Analytics', description: 'Performance and engagement metrics' },
  '/admin/pricing': { title: 'Pricing', description: 'Set subscription prices per level' },
};

function getBreadcrumbs(pathname: string) {
  const crumbs: { label: string; href: string }[] = [{ label: 'Admin', href: '/admin' }];
  const meta = routeMeta[pathname];
  if (meta && pathname !== '/admin') {
    crumbs.push({ label: meta.title, href: pathname });
  }
  return crumbs;
}

export function AdminHeader() {
  const pathname = usePathname();
  const meta = routeMeta[pathname] ?? { title: 'Admin', description: '' };
  const crumbs = getBreadcrumbs(pathname);

  return (
    <div className="mb-6 pb-5 border-b border-gray-200">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
            {i < crumbs.length - 1 ? (
              <Link href={crumb.href} className="hover:text-gray-600 transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-gray-600 font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Title */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 leading-tight">{meta.title}</h1>
          {meta.description && (
            <p className="text-sm text-gray-500 mt-0.5">{meta.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

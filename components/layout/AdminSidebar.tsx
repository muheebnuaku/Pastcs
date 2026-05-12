'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { useAuth } from '@/components/providers';
import {
  LayoutDashboard,
  BookOpen,
  FileQuestion,
  Users,
  BarChart3,
  Activity,
  Sparkles,
  LogOut,
  Menu,
  X,
  Shield,
  GraduationCap,
  DollarSign,
  ChevronRight,
  MessageSquareQuote,
} from 'lucide-react';

const adminNavSections = [
  {
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/courses', label: 'Courses', icon: BookOpen },
      { href: '/admin/questions', label: 'Questions', icon: FileQuestion },
      { href: '/admin/generate', label: 'AI Generator', icon: Sparkles },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/students', label: 'Students', icon: Users },
      { href: '/admin/testimonials', label: 'Testimonials', icon: MessageSquareQuote },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/activity', label: 'Activity', icon: Activity },
      { href: '/admin/pricing', label: 'Pricing', icon: DollarSign },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const { signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut().catch(() => {});
    router.replace('/login');
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200"
        aria-label="Toggle menu"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-gray-950 z-40 transform transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-800/60">
          <Link href="/admin" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-sm leading-tight">PastCS Admin</h1>
              <p className="text-[11px] text-gray-500 mt-0.5">Management Panel</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {adminNavSections.map((section, si) => (
            <div key={si}>
              {section.label && (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href, (item as any).exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150',
                        active
                          ? 'bg-blue-600/15 text-blue-400'
                          : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                        active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 group-hover:text-gray-300'
                      )}>
                        <item.icon className="w-4 h-4" />
                      </div>
                      <span className="font-medium text-sm">{item.label}</span>
                      {active && (
                        <ChevronRight className="w-3.5 h-3.5 ml-auto text-blue-400 opacity-60" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User Profile */}
        <div className="px-3 pb-4 pt-3 border-t border-gray-800/60 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
            <Avatar
              src={user?.avatar_url}
              fallback={user?.full_name || user?.email}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white text-sm truncate leading-tight">
                {user?.full_name || 'Admin'}
              </p>
              <p className="text-[11px] text-gray-500 truncate mt-0.5">{user?.email}</p>
            </div>
          </div>

          <Link
            href="/dashboard"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-blue-400 hover:bg-blue-900/20 rounded-xl transition-colors w-full"
          >
            <GraduationCap className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Student View</span>
          </Link>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 px-3 py-2 text-red-400 hover:bg-red-900/20 rounded-xl transition-colors w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

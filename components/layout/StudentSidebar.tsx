'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/lib/store';
import { useAuth } from '@/components/providers';
import {
  Home,
  BookOpen,
  Trophy,
  LogOut,
  Menu,
  X,
  Flame,
  GraduationCap,
  User,
  ShieldCheck,
  BotMessageSquare,
  Sparkles,
} from 'lucide-react';

const studentNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  { href: '/assistant', label: 'AI Tutor', icon: BotMessageSquare },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/achievements', label: 'Achievements', icon: GraduationCap },
  { href: '/profile', label: 'Profile', icon: User },
];

export function StudentSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasActiveSub } = useSubscriptionStore();
  const { signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut().catch(() => {});
    router.replace('/login');
  };

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const isPaid = hasActiveSub(level, semester);
  const showUpgradeNudge = !isPaid && !!user?.free_course_code;

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
          'fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-40 transform transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="px-5 py-4 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
            <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-10 h-10 rounded-full object-contain" />
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">PastCS</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">Exam Practice</p>
            </div>
          </Link>
        </div>

        {/* Streak Badge */}
        {user && (
          <div className="mx-3 mt-3 px-3 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl text-white flex items-center gap-2.5">
            <Flame className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight">{user.practice_streak} Day Streak</p>
              <p className="text-[11px] text-orange-100 mt-0.5 truncate">Keep practicing daily!</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {studentNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <item.icon className={cn('w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-blue-600' : 'text-gray-400')} style={{ width: '1.125rem', height: '1.125rem' }} />
                <span className="font-medium text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Upgrade Nudge for free users */}
        {showUpgradeNudge && (
          <div className="mx-3 mb-3">
            <Link
              href="/courses"
              onClick={() => setIsOpen(false)}
              className="block bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl p-3 text-white hover:opacity-95 transition-opacity"
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-200 flex-shrink-0" />
                <p className="text-xs font-semibold text-blue-100">Unlock Full Access</p>
              </div>
              <p className="text-[11px] text-blue-200 leading-snug mb-2">
                Get all courses, exam simulations &amp; AI explanations for just GHC 50.
              </p>
              <div className="bg-white/20 hover:bg-white/30 transition-colors rounded-lg py-1.5 text-center text-xs font-semibold">
                Upgrade Now →
              </div>
            </Link>
          </div>
        )}

        {/* User Profile */}
        <div className="px-3 pb-4 pt-2 border-t border-gray-100 space-y-1">
          <Link
            href="/profile"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Avatar
              src={user?.avatar_url}
              fallback={user?.full_name || user?.email}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate text-sm leading-tight">
                {user?.full_name || 'Student'}
              </p>
              <p className="text-[11px] text-gray-400 truncate mt-0.5">{user?.email}</p>
            </div>
          </Link>
          {user?.role === 'admin' && (
            <Link
              href="/admin"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors w-full"
            >
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium">Admin Panel</span>
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/lib/store';
import { useAuth } from '@/components/providers';
import { useNotifications } from '@/lib/hooks/useNotifications';
import {
  Home,
  BookOpen,
  Trophy,
  LogOut,
  Menu,
  Flame,
  GraduationCap,
  User,
  ShieldCheck,
  BotMessageSquare,
  Sparkles,
  Bell,
  Trash2,
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
  const [showNotifs, setShowNotifs] = useState(false);

  const { notifications, unreadCount, markAllRead, dismiss } = useNotifications(user?.id);

  const handleSignOut = async () => {
    await signOut().catch(() => {});
    router.replace('/login');
  };

  const level = user?.selected_level;
  const semester = user?.selected_semester;
  const isPaid = hasActiveSub(level, semester, user?.program_id);
  const showUpgradeNudge = !isPaid && !!user?.free_course_code;

  return (
    <>
      {/* Mobile menu button — hidden once open: it sits right over the
          drawer's own logo, and clicking the overlay already closes it. */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white dark:bg-[#1c1a15] text-gray-900 dark:text-gray-100 rounded-lg shadow-md border border-gray-200 dark:border-white/10"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

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
          'font-jakarta fixed left-0 top-0 h-full w-64 bg-white dark:bg-[#1c1a15] border-r border-gray-200 dark:border-white/10 z-40 transform transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
            <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-10 h-10 rounded-full object-cover" />
            <div>
              <h1 className="font-extrabold text-gray-900 dark:text-gray-100 text-sm leading-tight">PastCS</h1>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Exam Practice</p>
            </div>
          </Link>
          <button
            onClick={() => { setShowNotifs(v => !v); if (!showNotifs && unreadCount > 0) markAllRead(); }}
            className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-4.5 h-4.5 text-gray-500 dark:text-gray-400" style={{ width: '1.125rem', height: '1.125rem' }} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Notification drawer */}
        {showNotifs && (
          <div className="border-b border-gray-100 dark:border-white/10 max-h-72 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-white/[0.03]">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Notifications</span>
              {notifications.length > 0 && (
                <button onClick={() => Promise.all(notifications.map(n => dismiss(n.id)))}
                  className="text-[11px] text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium">
                  Clear all
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-5">No notifications</p>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-white/5">
                {notifications.map(n => (
                  <div key={n.id} className={`flex items-start gap-2.5 px-4 py-3 ${!n.is_read ? 'bg-[#fde3da]/60 dark:bg-[#e8603c]/10' : ''}`}>
                    <p className="flex-1 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{n.message}</p>
                    <button onClick={() => dismiss(n.id)} className="flex-shrink-0 mt-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Streak Badge */}
        {user && (
          <div className="mx-3 mt-3 px-3 py-2.5 bg-gradient-to-r from-[#e8603c] to-[#dba514] rounded-xl text-white flex items-center gap-2.5">
            <Flame className="w-4 h-4 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight">{user.practice_streak} Day Streak</p>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">Keep practicing daily!</p>
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
                    ? 'bg-[#fde3da] dark:bg-[#e8603c]/15 text-[#e8603c]'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100'
                )}
              >
                <item.icon className={cn('w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-[#e8603c]' : 'text-gray-400 dark:text-gray-500')} style={{ width: '1.125rem', height: '1.125rem' }} />
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
              className="block rounded-xl p-3 text-white hover:opacity-95 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #e8603c 0%, #dba514 100%)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-white/80 flex-shrink-0" />
                <p className="text-xs font-semibold text-white">Unlock Full Access</p>
              </div>
              <p className="text-[11px] text-white/80 leading-snug mb-2">
                Get all courses, exam simulations &amp; AI explanations for just GHC 50.
              </p>
              <div className="bg-white/20 hover:bg-white/30 transition-colors rounded-lg py-1.5 text-center text-xs font-semibold">
                Upgrade Now →
              </div>
            </Link>
          </div>
        )}

        {/* User Profile */}
        <div className="px-3 pb-4 pt-2 border-t border-gray-100 dark:border-white/10 space-y-1">
          <Link
            href="/profile"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            <Avatar
              src={user?.avatar_url}
              fallback={user?.full_name || user?.email}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm leading-tight">
                {user?.full_name || 'Student'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{user?.email}</p>
            </div>
          </Link>
          {user?.role === 'admin' && (
            <Link
              href="/admin"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-100 dark:hover:bg-purple-500/15 rounded-xl transition-colors w-full"
            >
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium">Admin Panel</span>
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

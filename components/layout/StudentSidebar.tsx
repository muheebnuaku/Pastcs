'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
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
} from 'lucide-react';

const studentNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/achievements', label: 'Achievements', icon: GraduationCap },
  { href: '/profile', label: 'Profile', icon: User },
];

export function StudentSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const { signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut().catch(() => {});
    router.replace('/login');
  };

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
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
          'fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-40 transform transition-transform duration-200 ease-in-out lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-gray-100">
            <Link href="/dashboard" className="flex items-center gap-3">
              <Image src="/pastcs.png" alt="PastCS" width={40} height={40} className="rounded-xl" />
              <div>
                <h1 className="font-bold text-gray-900">PastCS</h1>
                <p className="text-xs text-gray-500">Exam Practice</p>
              </div>
            </Link>
          </div>

          {/* Streak Badge */}
          {user && (
            <div className="mx-4 mt-4 p-3 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl text-white">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5" />
                <span className="font-semibold">{user.practice_streak} Day Streak</span>
              </div>
              <p className="text-xs text-orange-100 mt-1">Keep practicing daily!</p>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {studentNavItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Profile */}
          <div className="p-4 border-t border-gray-100">
            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 mb-3 p-2 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Avatar
                src={user?.avatar_url}
                fallback={user?.full_name || user?.email}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate text-sm">
                  {user?.full_name || 'Student'}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </Link>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

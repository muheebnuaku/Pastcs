'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { StudentSidebar } from '@/components/layout';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    // Redirect to profile if program not set (skip if already there)
    if (!user.program && pathname !== '/profile') {
      router.replace('/profile');
    }
  }, [user, isLoading, router, pathname]);

  return (
    <div className="font-jakarta min-h-screen bg-gray-50 dark:bg-[#16140f]">
      <StudentSidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="pt-16 lg:pt-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

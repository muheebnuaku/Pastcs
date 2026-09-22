'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { AdminSidebar, AdminHeader } from '@/components/layout';
import { isAdminRole } from '@/lib/utils';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    } else if (!isLoading && user && !isAdminRole(user.role)) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  return (
    <div className="font-jakarta min-h-screen bg-gray-100 dark:bg-[#16140f]">
      <AdminSidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="pt-16 lg:pt-0 p-6 lg:p-8">
          <AdminHeader />
          {children}
        </div>
      </main>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { StudentSidebar } from '@/components/layout';
import { PageLoading } from '@/components/ui';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    } else if (!isLoading && user?.role === 'admin') {
      router.push('/admin');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return <PageLoading />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <StudentSidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

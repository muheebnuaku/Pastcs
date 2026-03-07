'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { PageLoading } from '@/components/ui';

export default function LogoutPage() {
  const { signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const handleLogout = async () => {
      await signOut();
      router.push('/');
    };
    handleLogout();
  }, [signOut, router]);

  return <PageLoading />;
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers';
import { StudentSidebar } from '@/components/layout';
import { LevelSemesterModal } from './courses/components/LevelSemesterModal';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
  }, [user, isLoading, router]);

  // A student without a real program_id can't access or pay for courses
  // (verify/route.ts requires it) — a student who picked "Other — not
  // listed" at registration, or an older account from before programs
  // existed, can be stuck here indefinitely otherwise. Surface the
  // picker right at login on every page, instead of a banner that's
  // easy to navigate past — but let them dismiss it per visit rather
  // than hard-locking the app, since "Other" students genuinely have
  // nothing to pick until their program gets added.
  const needsProgram = !isLoading && !!user && !user.program_id;

  return (
    <div className="font-jakarta min-h-screen bg-gray-50 dark:bg-[#16140f]">
      {needsProgram && !dismissedOnboarding && (
        <LevelSemesterModal
          onSuccess={() => setDismissedOnboarding(true)}
          onClose={() => setDismissedOnboarding(true)}
        />
      )}
      <StudentSidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="pt-16 lg:pt-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

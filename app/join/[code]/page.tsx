'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui';
import { PENDING_JOIN_KEY, classroomErrorMessage } from '@/lib/classrooms';
import { Users, Trophy, BarChart3, Loader2, Gift } from 'lucide-react';

interface Preview {
  name: string;
  course_code: string;
  course_name: string;
  member_count: number;
  owner_name: string;
}

// The page an invite link opens. Works signed out: it shows what the
// classroom is, and remembers the code so the student lands back here to
// finish joining after signing up or logging in (see the student layout).
export default function JoinClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code ?? '').toUpperCase();
  const { user, isLoading, refreshUser } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    createClient()
      .rpc('get_classroom_preview', { p_code: code })
      .then(({ data, error: err }: { data: Preview[] | null; error: { message?: string } | null }) => {
        const row = data?.[0];
        if (err || !row) { setState('invalid'); return; }
        setPreview(row);
        setState('ready');
      });
  }, [code]);

  // Signed out: remember the invite for after sign-up / login.
  useEffect(() => {
    if (isLoading || user || state !== 'ready') return;
    try { localStorage.setItem(PENDING_JOIN_KEY, code); } catch { /* storage unavailable */ }
  }, [isLoading, user, state, code]);

  const join = async () => {
    setJoining(true);
    setError('');
    const hadFreeCourse = !!user?.free_course_code;
    const { data, error: err } = await createClient().rpc('join_classroom', { p_code: code });
    if (err || !data) { setJoining(false); setError(classroomErrorMessage(err)); return; }
    try { localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* storage unavailable */ }
    // Joining can make the classroom's course this student's free course
    // (new students) — refresh so the app knows, and say so on arrival.
    await refreshUser().catch(() => {});
    const gotFreeCourse = !hadFreeCourse && !!useAuthStore.getState().user?.free_course_code;
    router.replace(`/classrooms/${data as string}${gotFreeCourse ? '?free=1' : ''}`);
  };

  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] dark:bg-[#16140f] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-6">
          <Image src="/past.png" alt="PastCS" width={36} height={36} className="w-9 h-9 rounded-full object-cover" />
          <span className="font-extrabold text-[#2b2420] text-lg dark:text-gray-100">PastCS</span>
        </Link>

        <div className="rounded-3xl bg-white border border-[#efe2d0] shadow-sm p-6 dark:bg-[#1c1a15] dark:border-white/10">
          {state === 'loading' && (
            <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />Opening invite…
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center py-4">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">This invite isn&rsquo;t valid</h1>
              <p className="text-sm text-gray-500 mt-2 dark:text-gray-400">The code may have been changed. Ask your classmate for a new link.</p>
              <Link href="/classrooms" className="inline-block mt-5 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Go to Classrooms</Link>
            </div>
          )}

          {state === 'ready' && preview && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">{preview.owner_name} invited you to</p>
              <h1 className="text-2xl font-bold text-gray-900 mt-1 break-words dark:text-gray-100">{preview.name}</h1>
              <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">{preview.course_code} · {preview.course_name}</p>
              <p className="text-sm text-gray-700 mt-3 flex items-center gap-1.5 dark:text-gray-300">
                <Users className="w-4 h-4" />{preview.member_count} {preview.member_count === 1 ? 'classmate' : 'classmates'} already in
              </p>

              <ul className="mt-5 space-y-2.5">
                {[
                  { icon: Trophy, text: 'A weekly leaderboard with your classmates' },
                  { icon: BarChart3, text: 'See the topics your class finds hardest' },
                  { icon: Users, text: 'Class chat, shared resources and video calls' },
                  ...(!user?.free_course_code ? [{ icon: Gift, text: `New to PastCS? Practise ${preview.course_code} free` }] : []),
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                    <Icon className="w-4 h-4 text-blue-600 flex-shrink-0 dark:text-blue-400" />{text}
                  </li>
                ))}
              </ul>

              {error && <p className="text-sm text-red-600 mt-4 dark:text-red-400">{error}</p>}

              <div className="mt-6">
                {isLoading ? (
                  <Button size="lg" className="w-full" disabled>Checking your account…</Button>
                ) : user ? (
                  <Button size="lg" className="w-full" onClick={join} isLoading={joining}>Join classroom</Button>
                ) : (
                  <div className="space-y-2">
                    <Link href="/register" className="block">
                      <Button size="lg" className="w-full">Create a free account to join</Button>
                    </Link>
                    <Link href="/login" className="block">
                      <Button size="lg" variant="outline" className="w-full">I already have an account</Button>
                    </Link>
                    <p className="text-xs text-center text-gray-500 pt-1 dark:text-gray-400">You&rsquo;ll come back here to join after signing in.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

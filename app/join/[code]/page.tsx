'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui';
import { PaywallModal } from '@/app/(student)/courses/components/PaywallModal';
import { PENDING_JOIN_KEY, classroomErrorMessage, classroomsNotSetUp, type JoinStatus } from '@/lib/classrooms';
import { Users, Trophy, BarChart3, Loader2, Gift, Lock, CheckCircle2, MessageCircle, Info } from 'lucide-react';

interface Preview {
  name: string;
  course_code: string;
  course_name: string;
  member_count: number;
  owner_name: string;
}

interface Status {
  status: JoinStatus;
  classroom_id: string | null;
  level: number;
  semester: number;
}

// The page an invite link opens. Works signed out: it shows what the
// classroom is, and remembers the code so the student lands back here to
// finish joining after signing up or logging in (see the student layout).
// Signed in, it asks the database what this student may do (migration 030)
// and shows that one step: join, join free, pay first, or not your program.
export default function JoinClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code ?? '').toUpperCase();
  const { user, isLoading, refreshUser } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
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

  const userId = user?.id;
  useEffect(() => {
    if (!userId || state !== 'ready') return;
    let cancelled = false;
    setStatusLoading(true);
    createClient()
      .rpc('get_classroom_join_status', { p_code: code })
      .then(({ data, error: err }: { data: Status[] | null; error: { code?: string; message?: string } | null }) => {
        if (cancelled) return;
        setStatusLoading(false);
        // Before migration 030 runs there's no status check — fall back to
        // a plain join button and let join_classroom decide.
        if (err && !classroomsNotSetUp(err)) setError(classroomErrorMessage(err));
        const row = data?.[0] ?? null;
        if (row?.status === 'member' && row.classroom_id) {
          try { localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* storage unavailable */ }
          router.replace(`/classrooms/${row.classroom_id}`);
          return;
        }
        setStatus(row);
      });
    return () => { cancelled = true; };
  }, [userId, state, code, router]);

  // Signed out: remember the invite for after sign-up / login.
  useEffect(() => {
    if (isLoading || user || state !== 'ready') return;
    try { localStorage.setItem(PENDING_JOIN_KEY, code); } catch { /* storage unavailable */ }
  }, [isLoading, user, state, code]);

  const join = async () => {
    setJoining(true);
    setError('');
    const claimsFree = status?.status === 'available_free';
    const { data, error: err } = await createClient().rpc('join_classroom', { p_code: code });
    if (err || !data) {
      setJoining(false);
      setError(classroomErrorMessage(err));
      // The rule changed under us (e.g. they used their free course in
      // another tab) — show the step that now applies.
      if (err?.message?.includes('payment_required')) setStatus(s => (s ? { ...s, status: 'payment_required' } : s));
      return;
    }
    try { localStorage.removeItem(PENDING_JOIN_KEY); } catch { /* storage unavailable */ }
    // Joining can make the classroom's course this student's free course
    // (new students) — refresh so the app knows, and say so on arrival.
    await refreshUser().catch(() => {});
    router.replace(`/classrooms/${data as string}${claimsFree ? '?free=1' : ''}`);
  };

  const s = status?.status;
  const levelLabel = status ? `Level ${status.level}, Semester ${status.semester}` : '';

  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] dark:bg-[#16140f] flex items-center justify-center px-4 py-10 sm:py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-6">
          <Image src="/past.png" alt="PastCS" width={36} height={36} className="w-9 h-9 rounded-full object-cover" />
          <span className="font-extrabold text-[#2b2420] text-lg dark:text-gray-100">PastCS</span>
        </Link>

        <div className="rounded-3xl bg-white border border-[#efe2d0] shadow-sm overflow-hidden dark:bg-[#1c1a15] dark:border-white/10">
          {state === 'loading' && (
            <div className="flex items-center justify-center py-16 text-gray-500 dark:text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />Opening invite…
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center p-6 py-10">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">This invite isn&rsquo;t valid</h1>
              <p className="text-sm text-gray-500 mt-2 dark:text-gray-400">The code may have been changed. Ask your classmate for a new link.</p>
              <Link href="/classrooms" className="inline-block mt-5 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Go to Classrooms</Link>
            </div>
          )}

          {state === 'ready' && preview && (
            <>
              <div className="bg-gradient-to-br from-blue-600 to-purple-600 px-5 py-5 sm:px-6 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{preview.owner_name} invited you to</p>
                <h1 className="text-xl sm:text-2xl font-bold mt-1 break-words leading-tight">{preview.name}</h1>
                <p className="text-sm text-white/85 mt-1 truncate">{preview.course_code} · {preview.course_name}</p>
                <p className="text-xs text-white/85 mt-3 inline-flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1">
                  <Users className="w-3.5 h-3.5" />{preview.member_count} {preview.member_count === 1 ? 'classmate' : 'classmates'} already in
                </p>
              </div>

              <div className="p-5 sm:p-6">
                <ul className="space-y-2.5">
                  {[
                    { icon: Trophy, text: 'A weekly leaderboard with your classmates' },
                    { icon: BarChart3, text: 'See the topics your class finds hardest' },
                    { icon: MessageCircle, text: 'Class chat, shared resources and video calls' },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                      <Icon className="w-4 h-4 text-blue-600 flex-shrink-0 dark:text-blue-400" />{text}
                    </li>
                  ))}
                </ul>

                {/* The one step that applies to this student */}
                {user && !statusLoading && s === 'available_free' && (
                  <Note tone="green" icon={Gift}>
                    <strong>{preview.course_code} becomes your free course.</strong> Joining other classrooms later needs an unlock.
                  </Note>
                )}
                {user && !statusLoading && (s === 'free' || s === 'paid') && (
                  <Note tone="green" icon={CheckCircle2}>
                    {s === 'free' ? `${preview.course_code} is your free course, so you can join.` : `You've unlocked ${levelLabel}, so you can join.`}
                  </Note>
                )}
                {user && !statusLoading && s === 'payment_required' && (
                  <Note tone="amber" icon={Lock}>
                    You&rsquo;ve already used your free course{user.free_course_code ? ` on ${user.free_course_code}` : ''}. Unlock {levelLabel} to join, which also opens every course at that level.
                  </Note>
                )}
                {user && !statusLoading && s === 'wrong_program' && (
                  <Note tone="gray" icon={Info}>
                    {preview.course_code} isn&rsquo;t part of your programme, so you can&rsquo;t join this classroom. Ask a classmate for one in your programme, or start your own.
                  </Note>
                )}

                {error && <p className="text-sm text-red-600 mt-4 dark:text-red-400">{error}</p>}

                <div className="mt-6">
                  {isLoading || (user && statusLoading) ? (
                    <Button size="lg" className="w-full" disabled>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking your account…
                    </Button>
                  ) : user ? (
                    s === 'payment_required' ? (
                      <div className="space-y-2">
                        <Button size="lg" className="w-full" onClick={() => setShowPaywall(true)} isLoading={joining}>
                          <Lock className="w-4 h-4 mr-2" />Unlock &amp; join
                        </Button>
                        <Link href="/classrooms" className="block text-center text-sm text-gray-500 py-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Not now</Link>
                      </div>
                    ) : s === 'wrong_program' ? (
                      <Link href="/classrooms" className="block">
                        <Button size="lg" variant="outline" className="w-full">Go to my classrooms</Button>
                      </Link>
                    ) : (
                      <Button size="lg" className="w-full" onClick={join} isLoading={joining}>
                        {s === 'available_free' ? 'Join free' : 'Join classroom'}
                      </Button>
                    )
                  ) : (
                    <div className="space-y-2">
                      <Link href="/register" className="block">
                        <Button size="lg" className="w-full">Create a free account to join</Button>
                      </Link>
                      <Link href="/login" className="block">
                        <Button size="lg" variant="outline" className="w-full">I already have an account</Button>
                      </Link>
                      <p className="text-xs text-center text-gray-500 pt-1 dark:text-gray-400">
                        New to PastCS? {preview.course_code} will be your free course. You&rsquo;ll come back here to join after signing in.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showPaywall && status && preview && (
        <PaywallModal
          courseName={preview.course_name}
          courseCode={preview.course_code}
          totalCourses={0}
          level={status.level}
          semester={status.semester}
          heading={`Unlock to join ${preview.name}`}
          blurb={`One payment opens every Level ${status.level} course in your programme for Semester ${status.semester}, ${preview.course_code} included, and lets you join its classrooms.`}
          onClose={() => setShowPaywall(false)}
          onSuccess={() => { setStatus(st => (st ? { ...st, status: 'paid' } : st)); join(); }}
        />
      )}
    </div>
  );
}

const TONES = {
  green: 'bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300',
  amber: 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300',
};

function Note({ tone, icon: Icon, children }: { tone: keyof typeof TONES; icon: typeof Info; children: React.ReactNode }) {
  return (
    <div className={`mt-5 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ${TONES[tone]}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

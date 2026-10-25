'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore, useClassroomUnreadStore, useSubscriptionStore } from '@/lib/store';
import { NOTIFICATIONS_CHANGED } from '@/lib/hooks/useNotifications';
import { PhoneCall, X } from 'lucide-react';
import type { Subscription } from '@/types';

interface CallAlert {
  id: string;
  message: string;
  link: string;
  url?: string;
}

// Mounted once in the student layout. Keeps the classroom unread counts
// live (badges on the Classes tab and the classroom cards), tells the bell
// when a new notification lands, and pops up a "call started" card with a
// one-tap Join wherever the student is in the app (migration 033).
export function ClassroomAlerts() {
  const userId = useAuthStore(s => s.user?.id);
  const pathname = usePathname();
  const setCounts = useClassroomUnreadStore(s => s.setCounts);
  const bump = useClassroomUnreadStore(s => s.bump);
  const [call, setCall] = useState<CallAlert | null>(null);

  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  // Fresh counts on every page change. The chat a student is looking at
  // reads as 0 even if this answer raced its "mark read".
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    createClient().rpc('get_my_classroom_unread')
      .then(({ data, error }: { data: { classroom_id: string; unread: number }[] | null; error: unknown }) => {
        if (cancelled || error || !data) return;
        const counts = Object.fromEntries(data.map(r => [r.classroom_id, r.unread]));
        const open = pathRef.current.match(/^\/classrooms\/([^/]+)/)?.[1];
        if (open && open in counts) counts[open] = 0;
        setCounts(counts);
      });
    return () => { cancelled = true; };
  }, [userId, pathname, setCounts]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    // No filter on classroom_messages: Realtime applies its RLS, so only
    // messages from my own classrooms arrive.
    const channel = supabase
      .channel(`classroom-alerts-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'classroom_messages' },
        (payload: { new: { classroom_id: string; user_id: string; kind: string } }) => {
          const m = payload.new;
          if (m.user_id === userId || m.kind === 'call_end') return;
          if (pathRef.current === `/classrooms/${m.classroom_id}`) return; // its chat marks itself read
          bump(m.classroom_id);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload: { new: { id: string; type: string; message: string; link: string | null; meta: { url?: string } | null } }) => {
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
          const n = payload.new;
          // A class rep just paid for this student (migration 036): pick up
          // the new subscription so locked courses open without a reload.
          if (n.type === 'group_payment') {
            supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active')
              .then(({ data, error }: { data: Subscription[] | null; error: unknown }) => { if (!error && data) useSubscriptionStore.getState().setSubscriptions(data); });
          }
          const path = pathRef.current;
          // Never interrupt a practice session, exam or battle, and the
          // classroom itself already shows the call banner.
          if (n.type !== 'classroom_call' || !n.link || path === n.link) return;
          if (path.startsWith('/practice/') || path.startsWith('/exam/') || path.includes('/battles/')) return;
          setCall({ id: n.id, message: n.message, link: n.link, url: n.meta?.url });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, bump]);

  // A call card fades out on its own after a couple of minutes.
  useEffect(() => {
    if (!call) return;
    const t = window.setTimeout(() => setCall(null), 2 * 60 * 1000);
    return () => window.clearTimeout(t);
  }, [call]);

  useEffect(() => {
    if (call && pathname === call.link) setCall(null);
  }, [pathname, call]);

  if (!call) return null;

  return (
    <div
      role="status"
      className="fixed z-50 inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[22rem] animate-fade-in"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-white p-3.5 shadow-lg dark:border-green-500/30 dark:bg-[#1c1a15]">
        <span className="w-9 h-9 rounded-xl bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0 dark:bg-green-500/15 dark:text-green-400">
          <PhoneCall className="w-4.5 h-4.5 animate-pulse" style={{ width: '1.125rem', height: '1.125rem' }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">{call.message}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {call.url && (
              <a
                href={call.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setCall(null)}
                className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg"
              >
                Join call
              </a>
            )}
            <Link
              href={call.link}
              onClick={() => setCall(null)}
              className="text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg dark:text-gray-200 dark:bg-white/10 dark:hover:bg-white/15"
            >
              Open class
            </Link>
          </div>
        </div>
        <button
          onClick={() => setCall(null)}
          aria-label="Dismiss"
          className="p-1 -m-1 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@/types';

export interface AppNotification {
  id: string;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const NOTIF_COOLDOWN_KEY = (userId: string, type: string) =>
  `notif_cooldown_${userId}_${type}`;

function canSend(userId: string, type: string, hours = 24): boolean {
  const key = NOTIF_COOLDOWN_KEY(userId, type);
  const last = localStorage.getItem(key);
  if (!last) return true;
  return Date.now() - Number(last) > hours * 3600000;
}

function markSent(userId: string, type: string) {
  localStorage.setItem(NOTIF_COOLDOWN_KEY(userId, type), String(Date.now()));
}

export async function createNotification(
  userId: string,
  type: string,
  message: string
) {
  const supabase = createClient();
  await supabase.from('notifications').insert({ user_id: userId, type, message });
}

export async function triggerNotifications(user: User) {
  if (!user?.id) return;

  const supabase = createClient();
  const now = new Date();

  // ── 1. Streak at risk (2+ days no practice) ──
  if (user.practice_streak > 0 && user.last_practice_date && canSend(user.id, 'streak_risk')) {
    const last = new Date(user.last_practice_date);
    const daysSince = Math.floor((now.getTime() - last.getTime()) / 86400000);
    if (daysSince >= 2) {
      await createNotification(
        user.id,
        'streak_risk',
        `🔥 Your ${user.practice_streak}-day streak is at risk! Practice today to keep it alive.`
      );
      markSent(user.id, 'streak_risk');
    }
  }

  // ── 2. Inactivity nudge (7 days no test) ──
  if (canSend(user.id, 'inactivity', 72)) {
    const { data: recent } = await supabase
      .from('tests')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const daysSince = recent?.created_at
      ? Math.floor((now.getTime() - new Date(recent.created_at).getTime()) / 86400000)
      : 999;

    if (daysSince >= 7) {
      await createNotification(
        user.id,
        'inactivity',
        `📚 You haven't taken an exam in ${daysSince} days. Jump back in and keep improving!`
      );
      markSent(user.id, 'inactivity', );
    }
  }

  // ── 3. Milestone notifications ──
  if (canSend(user.id, 'milestone')) {
    const milestones = [1, 10, 25, 50, 100];
    const total = user.total_tests_taken ?? 0;
    if (milestones.includes(total)) {
      const msgs: Record<number, string> = {
        1:   '🎉 You completed your first test! Great start — keep it up!',
        10:  '⚡ 10 tests completed! You\'re building real momentum.',
        25:  '🏆 25 tests done! You\'re well on your way to exam readiness.',
        50:  '🔥 50 tests completed — you\'re in the top tier of dedicated students!',
        100: '👑 100 tests! You\'re an absolute champion. Exams have no chance.',
      };
      await createNotification(user.id, 'milestone', msgs[total]);
      markSent(user.id, 'milestone');
    }
  }
}

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetch = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    const notifs = (data ?? []) as AppNotification[];
    setNotifications(notifs);
    setUnreadCount(notifs.filter(n => !n.is_read).length);
  }, [userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, [userId]);

  const dismiss = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(prev => {
      const updated = prev.filter(n => n.id !== id);
      setUnreadCount(updated.filter(n => !n.is_read).length);
      return updated;
    });
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { notifications, unreadCount, markAllRead, dismiss, refetch: fetch };
}

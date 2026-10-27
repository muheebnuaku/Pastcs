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
  // In-app path to open (classroom calls and @mentions, migration 033).
  link?: string | null;
  meta?: { classroom_id?: string; url?: string } | null;
}

// Fired by ClassroomAlerts when a notification arrives over Realtime, so
// the bell refreshes without its own subscription.
export const NOTIFICATIONS_CHANGED = 'pastcs:notifications-changed';

/**
 * Streak, time-away and milestone reminders. The database works out which
 * are due and creates each one only once (migration 041), however many
 * devices or tabs call this. The bell is told to refresh if any were made.
 */
export async function triggerNotifications(user: User) {
  if (!user?.id) return;
  const { data, error } = await createClient().rpc('generate_my_reminders');
  if (!error && typeof data === 'number' && data > 0) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
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
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, fetch);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, fetch);
  }, [fetch]);

  return { notifications, unreadCount, markAllRead, dismiss, refetch: fetch };
}

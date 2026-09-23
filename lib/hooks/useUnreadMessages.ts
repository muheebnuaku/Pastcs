'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// StudentSidebar is mounted once for the whole (student) layout and
// doesn't remount on navigation, so `watchKey` (pass the pathname) is
// what re-triggers a refetch after the student reads their messages on
// /messages — no realtime subscription needed for this volume of traffic.
export function useUnreadMessageCount(userId: string | undefined, watchKey?: string) {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { count: c } = await supabase
      .from('admin_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('sender_id', userId)
      .eq('is_read', false);
    setCount(c ?? 0);
  }, [userId]);

  useEffect(() => { refetch(); }, [refetch, watchKey]);

  return count;
}

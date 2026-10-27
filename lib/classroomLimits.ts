'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Classroom limits on free access (migration 039): 2 battles, 5 text
// messages and 2 call joins per classroom, for good. The database enforces
// them; this only shows what's left.

export interface Allowance { used: number; limit: number }

export interface ClassroomLimits {
  free: boolean;
  messages?: Allowance;
  battles?: Allowance;
  calls?: Allowance;
}

export function left(a: Allowance | undefined): number {
  return a ? Math.max(0, a.limit - a.used) : Infinity;
}

/** null until loaded, and stays null before migration 039 (no limits). */
export function useClassroomLimits(classroomId: string) {
  const [limits, setLimits] = useState<ClassroomLimits | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await createClient().rpc('get_my_classroom_limits', { p_classroom: classroomId });
    if (!error && data) setLimits(data as ClassroomLimits);
  }, [classroomId]);
  useEffect(() => { reload(); }, [reload]);
  return { limits, reload };
}

// Calls a free member has already joined, so rejoining one after a dropped
// connection isn't stopped by the limit (the server doesn't count it).
const joinedKey = (classroomId: string) => `pastcs_calls_joined_${classroomId}`;

export function hasJoinedCall(classroomId: string, messageId: string): boolean {
  try { return (JSON.parse(localStorage.getItem(joinedKey(classroomId)) ?? '[]') as string[]).includes(messageId); } catch { return false; }
}

export function rememberJoinedCall(classroomId: string, messageId: string): void {
  try {
    const ids = (JSON.parse(localStorage.getItem(joinedKey(classroomId)) ?? '[]') as string[]).filter(id => id !== messageId);
    localStorage.setItem(joinedKey(classroomId), JSON.stringify([...ids, messageId].slice(-20)));
  } catch { /* storage unavailable: the server still decides */ }
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { whatsappShareUrl } from '@/lib/share';

// The grade ladder (migration 042): each course climbs F → A on the
// University of Ghana scale. The database decides every promotion,
// warning and drop; these helpers only read and show it.

export const GRADE_LABELS = ['F', 'E', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const;
/** The accuracy (last 30 answers) each grade needs: 40 + 5 × stage. */
export const gradeBoundary = (stage: number) => 40 + 5 * stage;

export interface Coverage {
  kind: 'none' | 'practised' | 'at50' | 'at60';
  have: number;
  need: number;
  ok: boolean;
  mock?: boolean;
}

export interface CourseGrade {
  access: 'ok' | 'locked';
  stage: number;
  label: string;
  best: number;
  best_label: string;
  next: number | null;
  next_label: string | null;
  bar: number;
  bar_needed: number | null;
  acc30: number | string | null;
  n30: number;
  acc_needed: number | null;
  coverage: Coverage | null;
  topics_total: number;
  free: boolean;
  capped: boolean;
  slipping: boolean;
  hold: { answered: number; right: number } | null;
}

export interface GradeEvent {
  kind: 'promote' | 'warn' | 'clear' | 'drop' | 'capped';
  from: number;
  to: number;
  from_label: string;
  to_label: string;
}

/** "Topics practised: 4 of 8 (need 4)" and the like; null when nothing is needed. */
export function coverageText(c: Coverage | null, total: number): string | null {
  if (!c || c.kind === 'none') return null;
  const what = c.kind === 'practised' ? 'practised' : c.kind === 'at50' ? 'at 50%+' : 'at 60%+';
  return `Topics ${what}: ${c.have} of ${total} (need ${c.kind === 'at60' ? 'all' : c.need})`;
}

export function accuracyNumber(g: Pick<CourseGrade, 'acc30'>): number | null {
  return g.acc30 === null || g.acc30 === undefined ? null : Number(g.acc30);
}

/** One-line summary of what still stands between the student and the next grade. */
export function nextStepText(g: CourseGrade): string {
  if (g.next === null || g.bar_needed === null) return 'You’ve reached A. Keep practising to hold it.';
  const left = Math.max(0, g.bar_needed - g.bar);
  if (left > 0) return `${left} more correct to reach ${g.next_label}`;
  const acc = accuracyNumber(g);
  if (g.acc_needed !== null && (acc === null || acc < g.acc_needed)) return `Bar full: get your accuracy to ${g.acc_needed}% to reach ${g.next_label}`;
  if (g.coverage && !g.coverage.ok) return `Bar full: practise more topics to reach ${g.next_label}`;
  if (g.capped) return `You’ve earned ${g.next_label}-level work. Unlock all topics to take it`;
  return `Next quiz takes you to ${g.next_label}`;
}

export function gradeShareUrl(label: string, courseCode: string): string {
  const text = `I just reached ${label} in ${courseCode} on PastCS. Climbing to an A before the exam!`;
  return whatsappShareUrl(text);
}

/** The caller's grade in a course. Stays null before migration 042 (no ladder shown). */
export function useCourseGrade(courseId: string | null | undefined) {
  const [grade, setGrade] = useState<CourseGrade | null>(null);
  const reload = useCallback(async () => {
    if (!courseId) return;
    const { data, error } = await createClient().rpc('get_course_grade', { p_course: courseId });
    if (!error && data) setGrade(data as CourseGrade);
  }, [courseId]);
  useEffect(() => { reload(); }, [reload]);
  return { grade, reload };
}

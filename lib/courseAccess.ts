'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Free-course limits (migration 038). On free access only the course's
// first 2 topics are open. The database enforces it (question reads and
// record_test); this tells the pages which topics to show as locked.

export type CourseAccessLevel = 'full' | 'free' | 'locked';

export interface CourseAccess {
  access: CourseAccessLevel;
  /** On free access, the open topic ids. Empty otherwise. */
  openTopicIds: string[];
}

/** Every topic is open unless the student is on free access. */
export function isTopicOpen(access: CourseAccess | null, topicId: string | null | undefined): boolean {
  if (!access || access.access !== 'free') return true;
  return !!topicId && access.openTopicIds.includes(topicId);
}

/** Drops questions from locked topics (on free access, questions answered
 * before a topic locked are still readable, but can't be practised). */
export function openQuestionsOnly<T extends { topic_id?: string | null }>(questions: T[], access: CourseAccess | null): T[] {
  if (!access || access.access !== 'free') return questions;
  return questions.filter(q => isTopicOpen(access, q.topic_id));
}

type Client = ReturnType<typeof createClient>;

/** One-off read of get_course_access; null if migration 038 hasn't run. */
export async function fetchCourseAccess(supabase: Client, courseId: string): Promise<CourseAccess | null> {
  const { data, error } = await supabase.rpc('get_course_access', { p_course: courseId });
  if (error || !data) return null;
  const d = data as { access: CourseAccessLevel; open_topic_ids: string[] };
  return { access: d.access, openTopicIds: d.open_topic_ids ?? [] };
}

/**
 * The student's access to a course. `ready` is false until it has loaded;
 * `access` stays null if migration 038 hasn't run, and the pages then
 * behave as they did before (the whole free course open).
 */
export function useCourseAccess(courseId: string | null | undefined): { access: CourseAccess | null; ready: boolean } {
  const [state, setState] = useState<{ id: string | null; access: CourseAccess | null }>({ id: null, access: null });

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    fetchCourseAccess(createClient(), courseId).then(access => {
      if (!cancelled) setState({ id: courseId, access });
    });
    return () => { cancelled = true; };
  }, [courseId]);

  return { access: state.id === courseId ? state.access : null, ready: !!courseId && state.id === courseId };
}

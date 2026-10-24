// Shared pieces for Classrooms (see supabase/migrations/028_classrooms.sql).

export type ClassroomRole = 'owner' | 'leader' | 'member';
export type ShareLevel = 'full' | 'totals' | 'hidden';

export interface Classroom {
  id: string;
  name: string;
  course_id: string;
  owner_id: string;
  join_code: string;
  max_members: number;
  created_at: string;
  course?: { course_code: string; course_name: string; icon?: string | null } | null;
}

export interface ClassroomMemberProgress {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: ClassroomRole;
  share_level: ShareLevel;
  is_me: boolean;
  practice_streak: number | null;
  tests_taken: number | null;
  questions_answered: number | null;
  correct_answers: number | null;
  accuracy: number | string | null;
  last_active: string | null;
}

export interface ClassroomTopicStat {
  topic_id: string;
  topic_name: string;
  attempts: number;
  correct: number;
  accuracy: number | string;
  students: number;
}

export const PENDING_JOIN_KEY = 'pastcs_pending_join';

export function inviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.pastcs.com';
  return `${origin}/join/${code}`;
}

export function whatsappShareUrl(name: string, courseCode: string | undefined, code: string): string {
  const text = `Join our ${courseCode ? `${courseCode} ` : ''}classroom "${name}" on PastCS — practise past questions together, weekly battles and a class leaderboard: ${inviteUrl(code)} (code ${code})`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const ERRORS: Record<string, string> = {
  invalid_code: "That code doesn't match any classroom. Check it and try again.",
  classroom_full: 'This classroom is full.',
  not_signed_in: 'Please log in again.',
  bad_name: 'Give the classroom a name between 3 and 80 characters.',
  bad_course: 'Pick a course for the classroom.',
  too_many_classrooms: 'You can own up to 10 classrooms. Delete one you no longer use first.',
  not_a_member: "You're not a member of this classroom.",
  owner_only: 'Only the classroom owner can do that.',
};

/** Turns a Supabase/RPC error into a sentence a student can act on. */
export function classroomErrorMessage(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  const known = Object.keys(ERRORS).find(k => msg.includes(k));
  return known ? ERRORS[known] : 'Something went wrong. Please try again.';
}

/** True when the classroom tables/functions don't exist yet (migration not run). */
export function classroomsNotSetUp(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST202' || error.code === 'PGRST205'
    || /does not exist|could not find the function|schema cache/i.test(error.message ?? '');
}

export function accuracyNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'No practice yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? 'Just now' : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

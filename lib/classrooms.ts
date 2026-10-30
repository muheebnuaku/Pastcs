// Shared pieces for Classrooms (see supabase/migrations/028_classrooms.sql).

import { whatsappShareUrl as whatsappTextUrl } from '@/lib/share';
import { shareLink } from '@/lib/referral';

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
  /** Set by the owner/leaders (migration 035); shown as a countdown. */
  exam_date?: string | null;
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

/** The invite link; a Level Rep's carries their code (lib/referral). */
export function inviteUrl(code: string): string {
  return shareLink(`/join/${code}`);
}

export function whatsappShareUrl(name: string, courseCode: string | undefined, code: string): string {
  const text = `Join our ${courseCode ? `${courseCode} ` : ''}classroom "${name}" on PastCS — practise past questions together, weekly battles and a class leaderboard: ${inviteUrl(code)} (code ${code})`;
  return whatsappTextUrl(text);
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
  payment_required: "You've already used your free course. Unlock this course's level to join its classroom.",
  wrong_program: "This classroom's course isn't part of your programme.",
  not_allowed: 'Only the person who started the call, or a class leader, can end it.',
  leaders_only: 'Only the class owner and leaders can do that.',
  too_many_pins: 'You can pin up to 3 announcements. Unpin one first.',
  bad_announcement: 'Write an announcement of up to 500 characters.',
  too_many_goals: 'You can have up to 5 goals running at once. Delete one first.',
  bad_target: 'Pick a number of questions between 1 and 500.',
  bad_due_date: 'Pick a due date between today and 60 days from now.',
  bad_topic: 'That topic isn’t part of this course.',
  bad_exam_date: 'Pick an exam date between today and a year from now.',
};

/**
 * What get_classroom_join_status (migration 030) says about a student and
 * a classroom: already in, can join (free course, paid, or this becomes
 * their free course), must pay first, or the course isn't in their program.
 */
export type JoinStatus = 'member' | 'free' | 'paid' | 'available_free' | 'payment_required' | 'wrong_program';

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

/** A YYYY-MM-DD date as a local date (no time-zone shift). */
export function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from today to a YYYY-MM-DD date (negative once it's past). */
export function daysUntil(ymd: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((localDate(ymd).getTime() - today.getTime()) / 86400000);
}

export function shortDate(ymd: string): string {
  return localDate(ymd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Today plus n days, as YYYY-MM-DD in local time (for date inputs). */
export function ymdFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

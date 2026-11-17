// Skills (migration 052): paid practical courses — Vibe Coding, AI
// Automation, WhatsApp AI Bot. Prices are in pesewas, like everywhere else.

export interface SkillCourse {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  outcomes: string[];
  price: number;
  duration_days: number;
  cohort_note: string | null;
}

export interface MySkillEnrolment {
  skill_course_id: string;
  slug: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  class_link: string | null;
  cohort_note: string | null;
}

export interface AdminSkillCourse extends SkillCourse {
  class_link: string | null;
  is_active: boolean;
  sort_order: number;
  students: number;
  running: number;
  revenue: number;
}

export interface AdminSkillEnrolment {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  course_title: string;
  amount: number;
  payment_reference: string;
  paid_at: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

// Someone who tapped Enrol while signed out comes back to that course
// once they've signed up or logged in (see app/(student)/layout.tsx).
export const PENDING_SKILL_KEY = 'pastcs_pending_skill';
export const SKILL_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function weeksLabel(days: number): string {
  if (days % 7 === 0) {
    const w = days / 7;
    return `${w} week${w === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function skillDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const ERRORS: Record<string, string> = {
  admins_only: 'Only admins can do that.',
  bad_slug: 'The web address can only use lowercase letters, numbers and dashes, like “vibe-coding”.',
  bad_title: 'Give the course a name.',
  bad_price: 'The price must be at least GHC 1.',
  bad_duration: 'Teaching time must be between 1 and 365 days.',
  bad_link: 'The class link must be a full web address starting with https://',
  slug_taken: 'Another course already uses that web address.',
  no_such_skill: 'That course no longer exists.',
  bad_days: 'Add between 1 and 90 days.',
  not_found: 'That enrolment no longer exists.',
};

export function skillErrorMessage(raw: string | undefined | null): string {
  if (!raw) return 'Something went wrong. Please try again.';
  for (const [code, text] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return text;
  }
  return 'Something went wrong. Please try again.';
}

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
  image_url: string | null;
  sample_url: string | null;
  sample_label: string | null;
  has_sample_file: boolean;
  sample_file_public: boolean;
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

// A purchase seen through its access link (no account needed).
export interface SkillAccess {
  slug: string;
  title: string;
  buyer_name: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  class_link: string | null;
  cohort_note: string | null;
}

export interface AdminSkillCourse extends Omit<SkillCourse, 'has_sample_file'> {
  class_link: string | null;
  sample_file_path: string | null;
  sample_file_name: string | null;
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
  phone: string | null;
  has_account: boolean;
  course_slug: string;
  course_title: string;
  amount: number;
  payment_reference: string;
  access_token: string;
  paid_at: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

// A buyer without an account keeps their access link's token on this
// device, per course, so the course page remembers them.
const ACCESS_KEY = 'pastcs_skill_access';

export function savedAccessToken(slug: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(ACCESS_KEY) || '{}') as Record<string, string>;
    return typeof map[slug] === 'string' ? map[slug] : null;
  } catch { return null; }
}

export function saveAccessToken(slug: string, token: string) {
  try {
    const map = JSON.parse(localStorage.getItem(ACCESS_KEY) || '{}') as Record<string, string>;
    map[slug] = token;
    localStorage.setItem(ACCESS_KEY, JSON.stringify(map));
  } catch { /* storage unavailable */ }
}

export const ACCESS_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function accessLink(origin: string, slug: string, token: string): string {
  return `${origin}/skills/${slug}?access=${token}`;
}

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
  bad_sample_link: 'The example link must be a full web address starting with https://',
  bad_image: 'The picture must be an uploaded image or a web address starting with https://',
  bad_path: 'That file name can’t be used. Rename it with letters, numbers, dots and dashes only.',
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

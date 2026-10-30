// Admin Users page (migration 049): the rows admin_search_users returns,
// the filters it understands, and small display helpers.

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: 'student' | 'admin' | 'super_admin';
  avatar_url: string | null;
  program_id: string | null;
  program_code: string | null;
  selected_level: number | null;
  selected_semester: number | null;
  created_at: string;
  is_suspended: boolean;
  total_tests_taken: number | null;
  practice_streak: number | null;
  xp: number | null;
  email_confirmed: boolean;
  last_active: string | null;
  access: 'paid' | 'free_pass' | 'none';
  unread_reply: boolean;
  shared_ip: number;
  suspicious: boolean;
  rep_level: number | null;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminUserRow['role'];
  avatar_url: string | null;
  student_id: string | null;
  program_id: string | null;
  program: string | null;
  program_name: string | null;
  selected_level: number | null;
  selected_semester: number | null;
  free_course_code: string | null;
  referral_code: string | null;
  referred_by: { id: string; name: string | null; email: string } | null;
  created_at: string;
  is_suspended: boolean;
  total_tests_taken: number | null;
  practice_streak: number | null;
  xp: number | null;
  registration_ip: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  last_active: string | null;
  suspicious: boolean;
  subscriptions: {
    id: string; level: number; semester: number; program_id: string | null; program_code: string | null;
    status: string; amount: number | null; payment_reference: string | null; paid_at: string | null;
  }[];
  ip_siblings: { id: string; name: string | null; email: string; suspended: boolean }[];
  classrooms: number;
  rep: { program_id: string | null; program_name: string | null; level: number; commission_pct: number; discount_pct: number; active: boolean; signups: number } | null;
  delete_blocked: string | null;
}

export const USER_FILTERS = [
  ['all', 'All'],
  ['students', 'Students'],
  ['admins', 'Admins'],
  ['reps', 'Level Reps'],
  ['paid', 'Paid'],
  ['free_pass', 'Free passes'],
  ['unread', 'Needs a reply'],
  ['suspicious', 'Suspicious'],
  ['shared_ip', 'Shared IP'],
  ['unconfirmed', 'Email not confirmed'],
  ['suspended', 'Suspended'],
] as const;
export type UserFilter = typeof USER_FILTERS[number][0];

export const DELETE_BLOCKED: Record<string, string> = {
  self: 'This is your own account.',
  admin_account: 'Admin accounts can’t be deleted here.',
  has_payments: 'They’ve paid, and payment records must be kept. Suspend the account instead.',
  rep_records: 'They have Level Rep commission on record. Suspend the account instead.',
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export function dateLabel(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function roleLabel(role: string): string {
  return role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Student';
}

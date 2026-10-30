// Level Reps (migration 047): shared types and messages for the admin
// pages and the rep's own page.

export interface LevelRepRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  referral_code: string | null;
  program_id: string | null;
  program_name: string | null;
  level: number;
  commission_pct: number;
  discount_pct: number;
  active: boolean;
  signups: number;
  paying: number;
  revenue: number;
  earned: number;
  unpaid: number;
  paid_out: number;
  created_at: string;
}

const ERRORS: Record<string, string> = {
  admins_only: 'Only admins can do that.',
  no_such_user: 'That account no longer exists.',
  bad_level: 'Pick a level.',
  bad_rate: 'Commission and discount must each be between 0% and 50%.',
  nothing_owed: 'Nothing is owed to this rep right now.',
};

export function repErrorMessage(message: string | undefined): string {
  const key = Object.keys(ERRORS).find(k => message?.includes(k));
  if (key) return ERRORS[key];
  if (message && /admin_set_level_rep|admin_list_level_reps|Could not find the function/.test(message)) {
    return 'Level Reps aren’t set up yet: run migration 047 in Supabase.';
  }
  return 'Something went wrong. Try again.';
}

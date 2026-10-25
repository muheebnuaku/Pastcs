// Group payment through the class rep (migration 036): shared by the
// rep's screens and the /api/payments/group routes.

export interface GroupPayCandidate {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_me: boolean;
  /** Another checkout from the last 30 minutes already covers them. */
  pending: boolean;
}

export interface GroupPayQuote {
  unitAmount: number;
  fullUnitAmount: number;
  dealActive: boolean;
  paidCount: number;
  percent: number;
  level: number;
  semester: number;
  candidates: GroupPayCandidate[];
}

export interface GroupPayReceipt {
  id: string;
  reference: string;
  status: 'pending' | 'paid' | 'problem';
  level: number;
  semester: number;
  unit_amount: number;
  full_unit_amount: number;
  deal: boolean;
  total: number;
  amount_paid: number | null;
  created_at: string;
  paid_at: string | null;
  students: { user_id: string; full_name: string | null; state: 'covered' | 'already_paid' | 'waiting' }[];
}

/** Pesewas as "GHC 40" or "GHC 37.50". */
export function ghc(pesewas: number): string {
  const cedis = pesewas / 100;
  return `GHC ${Number.isInteger(cedis) ? cedis : cedis.toFixed(2)}`;
}

const ERRORS: Record<string, string> = {
  leaders_only: 'Only the classroom owner or a leader can pay for classmates.',
  not_a_member: 'You’re not a member of this classroom.',
  wrong_program: 'Choose your programme in your profile first.',
  no_students: 'Choose at least one classmate.',
  too_many_students: 'You can pay for up to 50 classmates at once.',
  student_not_eligible: 'Someone on your list has just unlocked, or is already being paid for. Refresh the list and try again.',
  too_many_checkouts: 'You’ve started a lot of checkouts in the last hour. Please wait a little and try again.',
  bad_price: 'Could not work out the price. Please try again.',
};

export function groupPayErrorMessage(message: string | undefined): string {
  const known = Object.keys(ERRORS).find(k => (message ?? '').includes(k));
  return known ? ERRORS[known] : 'Something went wrong. Please try again.';
}

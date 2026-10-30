import type { SemesterEndDate } from '@/types';

/**
 * A payment (or free pass) counts for a term if it was made no earlier
 * than this many days before the term's start_date: early payers get in
 * straight away, while last cycle's payments (months older) don't revive.
 * Same window as public.paid_in_term (migration 048).
 */
export const EARLY_PAYMENT_DAYS = 120;

/** The first moment a payment counts for this term, or null if any time does. */
export function termOpensAt(startDate: string | null | undefined): Date | null {
  if (!startDate) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - EARLY_PAYMENT_DAYS);
  return d;
}

/** When access for this term runs out: end_date's whole day, then grace_days more. */
export function termCutoff(term: Pick<SemesterEndDate, 'end_date' | 'grace_days'>): Date {
  const cutoff = new Date(`${term.end_date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + term.grace_days + 1);
  return cutoff;
}

/**
 * Access purchased for a program+semester runs out grace_days after
 * that semester's admin-configured end_date — "pay for a course this
 * semester, when the semester ends the access ends [+ grace]." Used by
 * both the server-side question gate (app/api/courses/[courseCode]/
 * questions/route.ts) and the client-side subscription store
 * (lib/store.ts's hasActiveSub, fed by AuthProvider) so both agree on
 * what "active" means — there's no background job flipping status,
 * this is evaluated fresh every time.
 *
 * Returns true when no end date has been configured for that
 * program+semester at all, so turning this feature on for the first
 * time (or for a program an admin hasn't touched yet) never
 * retroactively cuts off existing access.
 */
export function isSubscriptionCurrentlyActive(
  sub: { status: string; paid_at: string | null; program_id: string | null; semester: number },
  terms: Pick<SemesterEndDate, 'program_id' | 'semester' | 'start_date' | 'end_date' | 'grace_days'>[]
): boolean {
  if (sub.status !== 'active') return false;
  if (!sub.program_id) return true;

  const term = terms.find(t => t.program_id === sub.program_id && t.semester === sub.semester);
  if (!term) return true;

  // end_date's whole day counts, then grace_days more full days —
  // cutoff is midnight UTC at the start of the day after that.
  if (Date.now() >= termCutoff(term).getTime()) return false;

  // A payment made long before this term's start belongs to whatever
  // cycle came before it — protects against an admin reusing this same
  // row for a new academic cycle and silently reviving an old purchase.
  // One made in the run-up to the start (EARLY_PAYMENT_DAYS) counts.
  const opens = termOpensAt(term.start_date);
  if (opens && sub.paid_at && new Date(sub.paid_at) < opens) return false;

  return true;
}

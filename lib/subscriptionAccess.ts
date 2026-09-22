import type { SemesterEndDate } from '@/types';

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
  const cutoff = new Date(`${term.end_date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + term.grace_days + 1);
  if (Date.now() >= cutoff.getTime()) return false;

  // A payment made before this term's start belongs to whatever cycle
  // came before it — protects against an admin reusing this same row
  // for a new academic cycle and silently reviving an old purchase.
  if (term.start_date && sub.paid_at && new Date(sub.paid_at) < new Date(`${term.start_date}T00:00:00Z`)) {
    return false;
  }

  return true;
}

import type { SupabaseClient } from '@supabase/supabase-js';

// Records a paid skill course (migration 052). The database checks the
// amount against the course's own price and is idempotent on the
// reference, so the browser's verify call and Paystack's webhook can both
// land without a double enrolment.
export type SkillEnrolResult =
  | { ok: true; title: string; ends_at: string }
  | { ok: false; code: 'amount_too_low' | 'no_such_skill' | 'reference_used' | 'no_such_user' | 'failed'; message: string };

export async function recordSkillEnrolment(
  admin: SupabaseClient,
  userId: string,
  slug: string,
  reference: string,
  amount: number,
  currency: string,
): Promise<SkillEnrolResult> {
  const { data, error } = await admin.rpc('record_skill_enrolment', {
    p_user: userId,
    p_slug: slug,
    p_reference: reference,
    p_amount: Math.round(amount),
    p_currency: currency,
  });
  if (error) {
    for (const code of ['amount_too_low', 'no_such_skill', 'reference_used', 'no_such_user'] as const) {
      if (error.message.includes(code)) return { ok: false, code, message: error.message };
    }
    return { ok: false, code: 'failed', message: error.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { title: string; ends_at: string } | undefined;
  if (!row) return { ok: false, code: 'failed', message: 'no row returned' };
  return { ok: true, title: row.title, ends_at: row.ends_at };
}

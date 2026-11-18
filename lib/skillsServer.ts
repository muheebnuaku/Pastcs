import type { SupabaseClient } from '@supabase/supabase-js';

// Records a paid skill course (migrations 052–053). The buyer is an
// account (userId) or a guest (userId null, email required). The database
// checks the amount against the course's own price and is idempotent on
// the reference, so the browser's verify call and Paystack's webhook can
// both land without a double enrolment.
export type SkillEnrolResult =
  | { ok: true; title: string; ends_at: string; access_token: string }
  | { ok: false; code: 'amount_too_low' | 'no_such_skill' | 'reference_used' | 'no_such_user' | 'no_buyer' | 'failed'; message: string };

export interface SkillBuyer {
  userId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export async function recordSkillEnrolment(
  admin: SupabaseClient,
  buyer: SkillBuyer,
  slug: string,
  reference: string,
  amount: number,
  currency: string,
): Promise<SkillEnrolResult> {
  const { data, error } = await admin.rpc('record_skill_enrolment', {
    p_user: buyer.userId,
    p_slug: slug,
    p_reference: reference,
    p_amount: Math.round(amount),
    p_currency: currency,
    p_name: buyer.name,
    p_email: buyer.email,
    p_phone: buyer.phone,
  });
  if (error) {
    for (const code of ['amount_too_low', 'no_such_skill', 'reference_used', 'no_such_user', 'no_buyer'] as const) {
      if (error.message.includes(code)) return { ok: false, code, message: error.message };
    }
    return { ok: false, code: 'failed', message: error.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { title: string; ends_at: string; access_token: string } | undefined;
  if (!row) return { ok: false, code: 'failed', message: 'no row returned' };
  return { ok: true, title: row.title, ends_at: row.ends_at, access_token: row.access_token };
}

// What the checkout put in Paystack's metadata. Name and phone are the
// buyer's own words; the email Paystack charged is used, not the form's.
export function buyerFromPaystack(
  meta: Record<string, unknown> | undefined,
  customerEmail: unknown,
): SkillBuyer {
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return {
    userId: str(meta?.userId, 64),
    name: str(meta?.buyerName, 120),
    email: str(customerEmail, 200) ?? str(meta?.buyerEmail, 200),
    phone: str(meta?.buyerPhone, 40),
  };
}

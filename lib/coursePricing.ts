import type { SupabaseClient } from '@supabase/supabase-js';

// Matches the price the UI shows before a program's real price has loaded.
const DEFAULT_PRICE_PESEWAS = 5000;

/**
 * The price to unlock a level, in pesewas, from the admin price list.
 * Computed on the server: payment verification checks the amount Paystack
 * actually charged against this, because the amount used to come only from
 * the browser, so it could be changed. (The class deal that used to take
 * 20% off was removed in migration 037; everyone pays this price.)
 */
export async function coursePriceFor(admin: SupabaseClient, programId: string, level: number): Promise<number> {
  const { data: priceRow } = await admin
    .from('subscription_prices')
    .select('amount')
    .eq('program_id', programId)
    .eq('level', level)
    .maybeSingle();
  return Number((priceRow as { amount?: number } | null)?.amount) || DEFAULT_PRICE_PESEWAS;
}

export interface UnlockPrice {
  /** What this student pays, in pesewas. */
  amount: number;
  /** The list price before any Level Rep discount. */
  full: number;
  /** The discount from the rep whose code they signed up with (0–50). */
  discountPct: number;
}

/**
 * This student's price to unlock a level: the list price, less the
 * discount of the Level Rep whose code they signed up with (migration
 * 047). The quote, /api/payments/verify and the webhook all use this, so
 * the price shown, the price charged and the price checked agree.
 */
export async function unlockPriceFor(admin: SupabaseClient, userId: string, programId: string, level: number): Promise<UnlockPrice> {
  const full = await coursePriceFor(admin, programId, level);
  // Before migration 047 the function doesn't exist: no discount.
  const { data, error } = await admin.rpc('rep_discount_for', { p_user: userId });
  const pct = error ? 0 : Math.min(50, Math.max(0, Number(data) || 0));
  return { amount: Math.round(full * (100 - pct) / 100), full, discountPct: pct };
}

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

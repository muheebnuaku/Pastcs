import type { SupabaseClient } from '@supabase/supabase-js';

// Server-only pieces of group payment (migration 036), shared by
// /api/payments/group/verify and the Paystack webhook.

export const GROUP_REFERENCE_PREFIX = 'pastcs_grp_';

export interface FulfilResult {
  result: 'paid' | 'amount_mismatch' | 'not_found';
  covered?: string[];
  already_paid?: string[];
  payer_id?: string | null;
  repeat?: boolean;
}

/** Asks Paystack what actually happened to a charge. */
export async function paystackVerify(reference: string): Promise<{ ok: boolean; amount: number; currency: string; status: string }> {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const body = await res.json();
  const status = String(body?.data?.status ?? '');
  return { ok: !!body?.status && status === 'success', amount: Number(body?.data?.amount), currency: String(body?.data?.currency ?? ''), status };
}

/**
 * Unlocks every student on a group payment once Paystack has confirmed it.
 * Safe to call from both the verify route and the webhook, any number of
 * times: the database checks the amount and creates each subscription
 * once. Anything support has to act on is logged under one greppable tag.
 */
export async function fulfilGroupPayment(
  admin: SupabaseClient,
  reference: string,
  amount: number,
  currency: string,
  source: 'verify' | 'webhook'
): Promise<FulfilResult> {
  const { data, error } = await admin.rpc('fulfil_group_payment', {
    p_reference: reference,
    p_amount: Number.isFinite(amount) ? Math.round(amount) : null,
    p_currency: currency,
  });
  if (error) {
    console.error('[GROUP PAYMENT — SUPPORT] could not record a paid group checkout', { source, reference, amount, currency, error });
    throw error;
  }
  const result = data as FulfilResult;
  if (result.repeat) return result;
  if (result.result === 'not_found') {
    console.error('[GROUP PAYMENT — SUPPORT] Paystack charged a group reference we have no record of', { source, reference, amount, currency });
  } else if (result.result === 'amount_mismatch') {
    console.error('[GROUP PAYMENT — SUPPORT] amount below the group total, nobody unlocked', { source, reference, amount, currency, payer: result.payer_id });
  } else if (result.already_paid?.length) {
    console.error('[GROUP PAYMENT — SUPPORT] some students had already unlocked: refund due', { source, reference, payer: result.payer_id, alreadyPaid: result.already_paid });
  }
  return result;
}

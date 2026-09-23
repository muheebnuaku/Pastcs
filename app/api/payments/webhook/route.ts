import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Paystack's server-to-server notification of a successful charge — the
// reliable backstop for /api/payments/verify (the client-side path used
// for instant unlock). That path depends entirely on the student's own
// browser completing a follow-up fetch after Paystack's popup reports
// success; Mobile Money charges in particular often require leaving the
// browser to approve a USSD prompt, and a backgrounded/closed tab means
// that fetch never happens — Paystack gets paid, the app never finds out.
// This endpoint fires from Paystack's own servers regardless of what the
// student's device does afterward, so a payment can no longer vanish.
export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get('x-paystack-signature'))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event !== 'charge.success' || event.data?.status !== 'success') {
    return Response.json({ received: true });
  }

  const { reference, amount, metadata } = event.data;
  const userId = metadata?.userId;
  const level = Number(metadata?.level);
  const semester = Number(metadata?.semester);

  if (!userId || !level || !semester) {
    console.error('Paystack webhook: charge.success missing userId/level/semester in metadata', { reference, metadata });
    return Response.json({ received: true });
  }

  // Idempotent: the client-side path may have already recorded this
  // exact payment, or Paystack may redeliver the same event.
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('payment_reference', reference)
    .maybeSingle();

  if (existing) {
    return Response.json({ received: true });
  }

  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('program_id')
    .eq('id', userId)
    .single();

  if (!userData?.program_id) {
    // Can't attribute the subscription to a program — surface loudly so
    // it gets a manual free-pass grant instead of silently vanishing.
    console.error(`Paystack webhook: paid but user ${userId} has no program_id — reference ${reference}, amount ${amount}`);
    return Response.json({ received: true });
  }

  const { error } = await supabaseAdmin.from('subscriptions').insert({
    user_id: userId,
    level,
    semester,
    program_id: userData.program_id,
    payment_reference: reference,
    amount,
    status: 'active',
    paid_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Paystack webhook: subscription insert failed', error, { reference, userId });
    // Non-2xx so Paystack retries — this is a transient DB error, not a
    // permanent rejection like the missing-program_id case above.
    return new Response('Insert failed', { status: 500 });
  }

  return Response.json({ received: true });
}

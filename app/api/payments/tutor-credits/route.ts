import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { reference, plan } = await request.json() as { reference: string; plan: string };
    if (!reference || !plan) {
      return Response.json({ error: 'reference and plan are required' }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Credits (and the price the client was shown) come from the same
    // admin-editable table TutorPricingModal reads — never trust the
    // client's own idea of how many credits a plan is worth.
    const { data: planRow } = await admin
      .from('tutor_credit_plans')
      .select('id, credits, amount')
      .eq('id', plan)
      .single();
    if (!planRow) {
      return Response.json({ error: 'Unknown plan' }, { status: 400 });
    }

    // Verify with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const paystackData = await paystackRes.json() as { status: boolean; data?: { status: string; amount: number } };

    if (!paystackData.status || paystackData.data?.status !== 'success') {
      return Response.json({ error: 'Payment not successful' }, { status: 400 });
    }
    // The amount actually paid must match what this plan currently costs —
    // stops a stale/tampered client-side price from buying a pack for less
    // than admin's current price.
    if (paystackData.data!.amount < planRow.amount) {
      return Response.json({ error: 'Amount paid does not match the plan price' }, { status: 400 });
    }

    // Idempotency check
    const { data: existing } = await admin
      .from('ai_tutor_credits')
      .select('id')
      .eq('payment_reference', reference)
      .single();
    if (existing) return Response.json({ success: true });

    const { error } = await admin.from('ai_tutor_credits').insert({
      user_id: authUser.id,
      plan,
      amount_paid: paystackData.data!.amount,
      total_credits: planRow.credits,
      payment_reference: reference,
    });

    if (error) return Response.json({ error: 'Failed to save credits' }, { status: 500 });

    return Response.json({ success: true, credits: planRow.credits });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

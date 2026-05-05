import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const PLAN_CREDITS: Record<string, number> = {
  starter: 30,
  pack_50: 50,
  pack_100: 100,
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { reference, plan } = await request.json() as { reference: string; plan: string };
    if (!reference || !plan || !PLAN_CREDITS[plan]) {
      return Response.json({ error: 'reference and plan are required' }, { status: 400 });
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

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
      total_credits: PLAN_CREDITS[plan],
      payment_reference: reference,
    });

    if (error) return Response.json({ error: 'Failed to save credits' }, { status: 500 });

    return Response.json({ success: true, credits: PLAN_CREDITS[plan] });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

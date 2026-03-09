import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reference, level, semester } = await request.json();

    if (!reference || !level || !semester) {
      return Response.json(
        { error: 'reference, level, and semester are required' },
        { status: 400 }
      );
    }

    // Verify payment with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data?.status !== 'success') {
      return Response.json({ error: 'Payment not successful' }, { status: 400 });
    }

    // Use admin client to bypass RLS for subscription insert
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Prevent replay: check if reference already processed
    const { data: existing } = await adminSupabase
      .from('subscriptions')
      .select('id')
      .eq('payment_reference', reference)
      .single();

    if (existing) {
      return Response.json({ success: true }); // idempotent
    }

    const { error } = await adminSupabase.from('subscriptions').insert({
      user_id: authUser.id,
      level,
      semester,
      payment_reference: reference,
      amount: paystackData.data.amount,
      status: 'active',
      paid_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Subscription insert error:', error);
      return Response.json({ error: 'Failed to save subscription' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Payment verify error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

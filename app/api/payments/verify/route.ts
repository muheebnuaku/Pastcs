import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { coursePriceFor } from '@/lib/coursePricing';

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

    // A subscription unlocks the student's own program's courses at this
    // level+semester, not every program's — read their current program
    // rather than trusting anything the client could send.
    const { data: userData } = await supabase
      .from('user_public')
      .select('program_id')
      .eq('id', authUser.id)
      .single();

    if (!userData?.program_id) {
      return Response.json({ error: 'No program selected' }, { status: 400 });
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

    // The amount and level used to be trusted as sent by the browser, so a
    // tampered checkout could pay a few pesewas (or a cheaper level's price)
    // and still unlock. Check what Paystack actually charged against the
    // server's own price for this level, class deal included, and that the
    // payment was made for this account.
    const paidFor = paystackData.data?.metadata?.userId;
    if (paidFor && paidFor !== authUser.id) {
      return Response.json({ error: 'This payment belongs to a different account.' }, { status: 400 });
    }
    const expected = await coursePriceFor(adminSupabase, authUser.id, userData.program_id, Number(level), Number(semester));
    const charged = Number(paystackData.data?.amount);
    if (paystackData.data?.currency !== 'GHS' || !Number.isFinite(charged) || charged < expected.amount) {
      console.error('Payment amount mismatch', { reference, userId: authUser.id, level, semester, charged, expected: expected.amount, currency: paystackData.data?.currency });
      return Response.json(
        { error: `The amount paid doesn't match the price for this level. Please contact support with reference ${reference}.` },
        { status: 400 }
      );
    }

    const { error } = await adminSupabase.from('subscriptions').insert({
      user_id: authUser.id,
      level,
      semester,
      program_id: userData.program_id,
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

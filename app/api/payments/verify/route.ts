import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { unlockPriceFor } from '@/lib/coursePricing';
import { GROUP_REFERENCE_PREFIX } from '@/lib/groupPaymentsServer';

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

    // A rep's group checkout is settled by /api/payments/group/verify. Its
    // total would pass the amount check below, so without this the rep
    // could also unlock themselves with a payment made for classmates.
    if (String(reference).startsWith(GROUP_REFERENCE_PREFIX)) {
      return Response.json({ error: 'This payment belongs to a group checkout.' }, { status: 400 });
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
    // server's own price for this level (less any Level Rep discount), and
    // that the payment was made for this account.
    const paidFor = paystackData.data?.metadata?.userId;
    // A tutor credit purchase is a different product: it mustn't also
    // unlock a level just because it cost as much.
    if (paystackData.data?.metadata?.product === 'ai_tutor') {
      return Response.json({ error: 'This payment was for tutor credits, not a course unlock.' }, { status: 400 });
    }
    if (paidFor && paidFor !== authUser.id) {
      return Response.json({ error: 'This payment belongs to a different account.' }, { status: 400 });
    }
    const price = await unlockPriceFor(adminSupabase, authUser.id, userData.program_id, Number(level));
    const expected = price.amount;
    const charged = Number(paystackData.data?.amount);
    if (paystackData.data?.currency !== 'GHS' || !Number.isFinite(charged) || charged < expected) {
      console.error('Payment amount mismatch', { reference, userId: authUser.id, level, semester, charged, expected, currency: paystackData.data?.currency });
      return Response.json(
        { error: `The amount paid doesn't match the price for this level. Please contact support with reference ${reference}.` },
        { status: 400 }
      );
    }

    const row = {
      user_id: authUser.id,
      level,
      semester,
      program_id: userData.program_id,
      payment_reference: reference,
      amount: paystackData.data.amount,
      status: 'active',
      paid_at: new Date().toISOString(),
    };
    let { error } = await adminSupabase.from('subscriptions').insert({ ...row, full_amount: price.full });
    // Before migration 032 the full_amount column doesn't exist — never let
    // analytics bookkeeping lose a payment.
    if (error && /full_amount/.test(error.message)) {
      ({ error } = await adminSupabase.from('subscriptions').insert(row));
    }

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

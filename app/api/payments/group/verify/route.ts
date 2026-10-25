import { requireUser, serviceClient } from '@/lib/apiAuth';
import { fulfilGroupPayment, paystackVerify } from '@/lib/groupPaymentsServer';

// POST /api/payments/group/verify { reference } — the rep's browser calls
// this when Paystack's popup reports success, for an instant unlock. The
// webhook does the same job from Paystack's side if this never arrives.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  let reference = '';
  try { reference = String((await request.json())?.reference ?? ''); } catch { /* handled below */ }
  if (!reference) return Response.json({ error: 'reference is required' }, { status: 400 });

  const admin = serviceClient();
  const { data: row } = await admin.from('classroom_group_payments').select('payer_id').eq('reference', reference).maybeSingle();
  if (!row || (row as { payer_id: string | null }).payer_id !== auth.userId) {
    return Response.json({ error: 'We couldn’t find that checkout on your account.' }, { status: 404 });
  }

  try {
    const charge = await paystackVerify(reference);
    if (!charge.ok) {
      // Mobile Money can still be waiting for approval: the webhook
      // finishes the job when Paystack confirms.
      const waiting = ['pending', 'ongoing', 'processing', 'queued'].includes(charge.status);
      return Response.json({
        error: waiting
          ? 'Paystack is still confirming this payment. Your classmates unlock as soon as it goes through.'
          : 'The payment didn’t go through, so nobody was charged or unlocked.',
        waiting,
      }, { status: 400 });
    }
    const result = await fulfilGroupPayment(admin, reference, charge.amount, charge.currency, 'verify');
    if (result.result !== 'paid') {
      return Response.json({ error: `The amount paid doesn’t match the total, so nobody was unlocked. Please contact support with reference ${reference}.` }, { status: 400 });
    }
    return Response.json({ success: true, covered: result.covered ?? [], alreadyPaid: result.already_paid ?? [] });
  } catch (err) {
    console.error('group verify error:', err);
    return Response.json({ error: `We couldn’t confirm the payment yet. If you were charged, your classmates unlock shortly. Reference ${reference}.` }, { status: 500 });
  }
}

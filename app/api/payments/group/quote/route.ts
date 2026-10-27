import { requireUser, serviceClient } from '@/lib/apiAuth';
import { groupPayErrorMessage, type GroupPayCandidate, type GroupPayQuote } from '@/lib/groupPayments';
import { priceGroupPayment } from '@/lib/groupPaymentsPricing';

// GET /api/payments/group/quote?classroom= — for a class rep: which
// classmates they can pay for, and the price per classmate.
// /api/payments/group/start charges exactly this.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const classroomId = new URL(request.url).searchParams.get('classroom') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(classroomId)) return Response.json({ error: 'Missing classroom.' }, { status: 400 });

  // Runs as the rep, so the database checks they're the owner or a leader.
  const { data: candidates, error } = await auth.supabase.rpc('get_group_payment_candidates', { p_classroom: classroomId });
  if (error) {
    const status = /leaders_only|not_a_member/.test(error.message) ? 403 : 500;
    if (status === 500) console.error('group quote: candidates failed', error);
    return Response.json({ error: groupPayErrorMessage(error.message) }, { status });
  }

  try {
    const price = await priceGroupPayment(serviceClient(), auth.userId, classroomId);
    if ('error' in price) return Response.json({ error: groupPayErrorMessage(price.error) }, { status: 400 });
    const quote: GroupPayQuote = {
      unitAmount: price.unitAmount,
      level: price.level,
      semester: price.semester,
      candidates: (candidates ?? []) as GroupPayCandidate[],
    };
    return Response.json(quote);
  } catch (err) {
    console.error('group quote error:', err);
    return Response.json({ error: 'Could not load the price. Please try again.' }, { status: 500 });
  }
}

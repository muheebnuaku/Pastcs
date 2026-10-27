import { requireUser, serviceClient } from '@/lib/apiAuth';
import { groupPayErrorMessage } from '@/lib/groupPayments';
import { priceGroupPayment } from '@/lib/groupPaymentsPricing';

const KNOWN_ERRORS = /leaders_only|not_a_member|wrong_program|no_students|too_many_students|student_not_eligible|too_many_checkouts|bad_price/;

// POST /api/payments/group/start { classroomId, studentIds } — records a
// group checkout before Paystack opens. The server prices it and makes the
// reference; the browser is only told what to charge. Verification and the
// webhook look the checkout up by that reference, so a tampered popup
// can't change who gets unlocked, and paying less unlocks nobody.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  let body: { classroomId?: unknown; studentIds?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter((s): s is string => typeof s === 'string') : [];
  if (!classroomId || studentIds.length === 0) return Response.json({ error: groupPayErrorMessage('no_students') }, { status: 400 });
  if (studentIds.length > 50) return Response.json({ error: groupPayErrorMessage('too_many_students') }, { status: 400 });

  const admin = serviceClient();
  try {
    const price = await priceGroupPayment(admin, auth.userId, classroomId);
    if ('error' in price) return Response.json({ error: groupPayErrorMessage(price.error) }, { status: 400 });
    const { data, error } = await admin.rpc('create_group_payment', {
      p_payer: auth.userId,
      p_classroom: classroomId,
      p_students: studentIds,
      p_unit_amount: price.unitAmount,
      p_full_unit_amount: price.unitAmount,
      p_deal: false,
    });
    if (error) {
      const known = KNOWN_ERRORS.test(error.message);
      if (!known) console.error('group start: create failed', error);
      return Response.json({ error: groupPayErrorMessage(error.message) }, { status: known ? 409 : 500 });
    }
    const row = (data as { reference: string; total: number; student_count: number }[] | null)?.[0];
    if (!row) return Response.json({ error: 'Could not start the checkout. Please try again.' }, { status: 500 });
    return Response.json({ reference: row.reference, amount: row.total, count: row.student_count, unitAmount: price.unitAmount });
  } catch (err) {
    console.error('group start error:', err);
    return Response.json({ error: 'Could not start the checkout. Please try again.' }, { status: 500 });
  }
}

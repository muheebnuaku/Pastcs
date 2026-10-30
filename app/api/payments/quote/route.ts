import { requireUser, serviceClient } from '@/lib/apiAuth';
import { unlockPriceFor } from '@/lib/coursePricing';

// GET /api/payments/quote — what this student pays to unlock their current
// level+semester (or ?level=&semester=, e.g. a classroom's course), with
// any Level Rep discount taken off. The paywall charges exactly this, and
// /api/payments/verify checks the charge against the same rule.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const { data: profile } = await auth.supabase
    .from('user_public')
    .select('program_id, selected_level, selected_semester')
    .eq('id', auth.userId)
    .single();
  const p = profile as { program_id: string | null; selected_level: number | null; selected_semester: number | null } | null;
  const params = new URL(request.url).searchParams;
  const level = Number(params.get('level') ?? p?.selected_level);
  const semester = Number(params.get('semester') ?? p?.selected_semester);
  if (!p?.program_id || ![100, 200, 300, 400].includes(level) || ![1, 2].includes(semester)) {
    return Response.json({ error: 'Pick your level and program first.' }, { status: 400 });
  }

  try {
    const price = await unlockPriceFor(serviceClient(), auth.userId, p.program_id, level);
    return Response.json({ amount: price.amount, fullAmount: price.full, discountPct: price.discountPct, level, semester });
  } catch (err) {
    console.error('quote error:', err);
    return Response.json({ error: 'Could not load the price. Please try again.' }, { status: 500 });
  }
}

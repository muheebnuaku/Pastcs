import { requireUser, serviceClient } from '@/lib/apiAuth';
import { coursePriceFor } from '@/lib/coursePricing';

// GET /api/payments/quote — what this student pays to unlock their current
// level+semester, including any class deal. The paywall charges exactly
// this, and /api/payments/verify checks the charge against the same rule.
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const { data: profile } = await auth.supabase
    .from('user_public')
    .select('program_id, selected_level, selected_semester')
    .eq('id', auth.userId)
    .single();
  const p = profile as { program_id: string | null; selected_level: number | null; selected_semester: number | null } | null;
  if (!p?.program_id || !p.selected_level || !p.selected_semester) {
    return Response.json({ error: 'Pick your level and program first.' }, { status: 400 });
  }

  try {
    const price = await coursePriceFor(serviceClient(), auth.userId, p.program_id, p.selected_level, p.selected_semester);
    return Response.json({ ...price, level: p.selected_level, semester: p.selected_semester });
  } catch (err) {
    console.error('quote error:', err);
    return Response.json({ error: 'Could not load the price. Please try again.' }, { status: 500 });
  }
}

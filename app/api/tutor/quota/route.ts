import { requireUser } from '@/lib/apiAuth';
import { getTutorQuota } from '@/lib/tutorCredits';

// GET /api/tutor/quota — the student's AI Tutor lesson balance, computed
// server-side so the page shows exactly what the server will enforce.
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getTutorQuota(auth.userId, auth.supabase));
  } catch (err) {
    console.error('tutor quota error:', err);
    return Response.json({ error: 'Could not load your lesson balance' }, { status: 500 });
  }
}

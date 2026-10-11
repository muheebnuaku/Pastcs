import { requireUser } from '@/lib/apiAuth';
import { getTutorQuota, createLessonToken } from '@/lib/tutorCredits';

// POST /api/tutor/lesson-start — checks the balance and hands out a signed
// pass that generate-lesson (and parse-pdf's vision step) require. Nothing
// is charged here: the credit is only used once part of the lesson is
// actually delivered (see markLessonUsed).
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  try {
    const quota = await getTutorQuota(auth.userId, auth.supabase);
    if (quota.remaining <= 0) {
      return Response.json(
        { error: 'You have no AI Tutor lessons left. Top up to keep going.', code: 'no_credits', quota },
        { status: 402 }
      );
    }
    return Response.json({ token: createLessonToken(auth.userId), quota });
  } catch (err) {
    console.error('lesson-start error:', err);
    return Response.json({ error: 'Could not start the lesson. Please try again.' }, { status: 500 });
  }
}

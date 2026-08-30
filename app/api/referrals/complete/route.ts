import { createClient } from '@/lib/supabase/server';
import { rewardReferralOnFirstTest } from '@/lib/referralReward';

// Fire-and-forget from the client right after a test is submitted
// (practice or exam). Cheap to call every time — it only ever does
// anything on the user's first-ever test, and is a no-op otherwise.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    await rewardReferralOnFirstTest(authUser.id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Error completing referral reward:', error);
    // Never block the student's flow over a reward-crediting failure.
    return Response.json({ success: true });
  }
}

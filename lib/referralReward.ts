import { createClient } from '@supabase/supabase-js';

// Server-only — needs the service role to write to `subscriptions`,
// which has no insert policy for regular users (grants are always
// programmatic: payment webhook, admin free-pass, or this).
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function grantReferralFreePass(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  level: number,
  semester: number
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('level', level)
    .eq('semester', semester)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return true; // already has access one way or another — treat as granted

  const ref = `free_pass_referral_${userId}_${level}_${semester}`;
  const { error } = await supabase.from('subscriptions').insert({
    user_id: userId,
    level,
    semester,
    payment_reference: ref,
    amount: 0,
    status: 'active',
    paid_at: new Date().toISOString(),
  });
  return !error;
}

async function notify(supabase: ReturnType<typeof serviceClient>, userId: string, message: string) {
  try {
    await supabase.from('notifications').insert({ user_id: userId, type: 'referral_reward', message });
  } catch {
    // notifications table not migrated on this environment yet — non-critical
  }
}

/**
 * Call after a user's test is inserted (practice or exam, either code
 * path). Only takes effect on their first-ever test. Rewards the
 * referred user immediately — they always have a level/semester by the
 * time they can complete a test — and the referrer too if their own
 * level/semester is already known. If not, the referrer's side is left
 * pending and granted later by maybeRewardPendingReferrer() once they
 * pick one.
 */
export async function rewardReferralOnFirstTest(userId: string): Promise<void> {
  const supabase = serviceClient();

  const { count } = await supabase
    .from('tests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if ((count ?? 0) !== 1) return; // not their first test

  // referred_id is UNIQUE on this table, so at most one row can match.
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_id', userId)
    .is('referred_rewarded_at', null)
    .maybeSingle();
  if (!referral) return;

  const { data: referredUser } = await supabase
    .from('users').select('selected_level, selected_semester').eq('id', userId).single();
  if (!referredUser?.selected_level || !referredUser?.selected_semester) return;

  const referredOk = await grantReferralFreePass(supabase, userId, referredUser.selected_level, referredUser.selected_semester);
  if (!referredOk) return; // don't mark rewarded if the grant itself failed

  const updates: { referred_rewarded_at: string; referrer_rewarded_at?: string } = {
    referred_rewarded_at: new Date().toISOString(),
  };

  const { data: referrerUser } = await supabase
    .from('users').select('selected_level, selected_semester').eq('id', referral.referrer_id).single();
  if (referrerUser?.selected_level && referrerUser?.selected_semester) {
    const referrerOk = await grantReferralFreePass(supabase, referral.referrer_id, referrerUser.selected_level, referrerUser.selected_semester);
    if (referrerOk) updates.referrer_rewarded_at = new Date().toISOString();
  }

  await supabase.from('referrals').update(updates).eq('id', referral.id);

  await notify(supabase, userId, "🎉 You joined with a referral code and finished your first test — enjoy your free pass!");
  if (updates.referrer_rewarded_at) {
    await notify(supabase, referral.referrer_id, "🎉 Your referral finished their first test — you both got a free pass!");
  }
}

/**
 * Call whenever a user sets or changes their level+semester (see
 * api/user/selection). If they're the referrer on one or more
 * referrals whose referred side is already rewarded but whose own
 * reward is still pending — because they hadn't picked a level yet
 * when their friend finished — grant it now.
 */
export async function maybeRewardPendingReferrer(userId: string, level: number, semester: number): Promise<void> {
  const supabase = serviceClient();

  // Not unique per referrer — someone can refer more than one friend —
  // so this can legitimately return several rows, not just one.
  const { data: pending } = await supabase
    .from('referrals')
    .select('id')
    .eq('referrer_id', userId)
    .not('referred_rewarded_at', 'is', null)
    .is('referrer_rewarded_at', null);
  if (!pending || pending.length === 0) return;

  const ok = await grantReferralFreePass(supabase, userId, level, semester);
  if (!ok) return;

  const rewardedAt = new Date().toISOString();
  await supabase.from('referrals').update({ referrer_rewarded_at: rewardedAt }).in('id', pending.map(p => p.id));

  await notify(supabase, userId, '🎉 Your referral bonus just kicked in — you got a free pass for the level you picked!');
}

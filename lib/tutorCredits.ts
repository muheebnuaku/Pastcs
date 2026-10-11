import crypto from 'crypto';
import { serviceClient } from '@/lib/apiAuth';
import { isSubscriptionCurrentlyActive } from '@/lib/subscriptionAccess';
import type { createClient } from '@/lib/supabase/server';

type UserClient = Awaited<ReturnType<typeof createClient>>;

// AI Tutor document lessons. Free accounts get FREE_LESSONS, students with
// an active course subscription get PAID_LESSONS, and purchased credit
// packs are added on top of either (they used to replace the free 5).
export const FREE_LESSONS = 5;
export const PAID_LESSONS = 100;

// Usage is recorded server-side only. 'document_upload' rows were written
// by the browser before this existed and still count, so existing
// balances carry over unchanged.
const USED_EVENTS = ['document_upload', 'tutor_lesson_used'];

// One lesson = one signed pass. A long document legitimately needs one
// generate-lesson call per batch plus a final summary call (and the odd
// retry); these caps stop a single pass being reused indefinitely.
export const MAX_LESSON_CALLS = 30;
export const MAX_VISION_BATCHES = 20;
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

export interface TutorQuota {
  used: number;
  purchased: number;
  isPaid: boolean;
  limit: number;
  remaining: number;
}

export async function getTutorQuota(userId: string, supabase: UserClient): Promise<TutorQuota> {
  const svc = serviceClient();
  const [usedRes, creditsRes, profileRes] = await Promise.all([
    svc.from('feature_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('event', USED_EVENTS),
    svc.from('ai_tutor_credits').select('total_credits').eq('user_id', userId),
    supabase.from('user_public')
      .select('selected_level, selected_semester, program_id')
      .eq('id', userId)
      .single(),
  ]);

  const used = usedRes.count ?? 0;
  const purchased = ((creditsRes.data ?? []) as { total_credits: number }[])
    .reduce((sum, r) => sum + (r.total_credits ?? 0), 0);

  let isPaid = false;
  const profile = profileRes.data as { selected_level: number | null; selected_semester: number | null; program_id: string | null } | null;
  if (profile?.selected_level && profile.selected_semester && profile.program_id) {
    const [{ data: sub }, { data: terms }] = await Promise.all([
      supabase.from('subscriptions')
        .select('status, paid_at, program_id, semester')
        .eq('user_id', userId)
        .eq('level', profile.selected_level)
        .eq('semester', profile.selected_semester)
        .eq('program_id', profile.program_id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      supabase.from('semester_end_dates')
        .select('program_id, semester, start_date, end_date, grace_days')
        .eq('program_id', profile.program_id),
    ]);
    isPaid = !!sub && isSubscriptionCurrentlyActive(sub, terms ?? []);
  }

  const limit = (isPaid ? PAID_LESSONS : FREE_LESSONS) + purchased;
  return { used, purchased, isPaid, limit, remaining: Math.max(0, limit - used) };
}

// ── Lesson pass (signed, stateless) ──────────────────────────────────────

function tokenSecret(): string {
  return process.env.TUTOR_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
}

export function createLessonToken(userId: string): string {
  const lessonId = crypto.randomUUID();
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${lessonId}.${exp}.${sign(`${userId}.${lessonId}.${exp}`)}`;
}

/** Returns the lesson id if the token is valid for this user, else null. */
export function verifyLessonToken(token: unknown, userId: string): string | null {
  if (typeof token !== 'string' || !tokenSecret()) return null;
  const [lessonId, expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!lessonId || !sig || !Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = Buffer.from(sign(`${userId}.${lessonId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return lessonId;
}

// ── Per-lesson event bookkeeping (feature_events, service role) ──────────

export async function countLessonEvents(lessonId: string, event: string): Promise<number> {
  const { count } = await serviceClient()
    .from('feature_events')
    .select('id', { count: 'exact', head: true })
    .eq('event', event)
    .eq('metadata->>lessonId', lessonId);
  return count ?? 0;
}

export async function recordLessonEvent(
  userId: string,
  lessonId: string,
  event: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await serviceClient().from('feature_events').insert({
    user_id: userId,
    event,
    metadata: { lessonId, ...extra },
  });
}

/** Charges the lesson's credit once — the first time any part of it is
 * actually delivered. Later parts and retries of the same lesson are free. */
export async function markLessonUsed(userId: string, lessonId: string): Promise<void> {
  if (await countLessonEvents(lessonId, 'tutor_lesson_used') > 0) return;
  await recordLessonEvent(userId, lessonId, 'tutor_lesson_used');
}

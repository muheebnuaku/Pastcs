import crypto from 'crypto';
import { serviceClient } from '@/lib/apiAuth';
import { isSubscriptionCurrentlyActive } from '@/lib/subscriptionAccess';
import type { createClient } from '@/lib/supabase/server';

type UserClient = Awaited<ReturnType<typeof createClient>>;

// AI Tutor document lessons (one uploaded document = one lesson).
// Students with an active course subscription get PAID_LESSONS. Free
// accounts get FREE_WINDOW_UPLOADS at a time: each one comes back
// FREE_WINDOW_HOURS after it was used. Purchased credit packs work as
// before on top (a lifetime pool of FREE_LESSONS + the packs, which is what
// they bought into), and are only drawn on once the free uploads are used.
export const FREE_LESSONS = 5;
export const PAID_LESSONS = 100;
export const FREE_WINDOW_UPLOADS = 3;
export const FREE_WINDOW_HOURS = 3;
const FREE_WINDOW_EVENT = 'tutor_free_upload';

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
  /** Free accounts only: the rolling allowance. */
  freeWindow: { limit: number; used: number; nextAt: string | null } | null;
}

export async function getTutorQuota(userId: string, supabase: UserClient): Promise<TutorQuota> {
  const svc = serviceClient();
  const windowStart = new Date(Date.now() - FREE_WINDOW_HOURS * 3600 * 1000).toISOString();
  const [usedRes, windowRes, creditsRes, profileRes] = await Promise.all([
    svc.from('feature_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('event', USED_EVENTS),
    svc.from('feature_events')
      .select('created_at')
      .eq('user_id', userId)
      .eq('event', FREE_WINDOW_EVENT)
      .gt('created_at', windowStart)
      .order('created_at', { ascending: true }),
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

  if (isPaid) {
    const limit = PAID_LESSONS + purchased;
    return { used, purchased, isPaid, limit, remaining: Math.max(0, limit - used), freeWindow: null };
  }

  const windowUses = ((windowRes.data ?? []) as { created_at: string }[]).map(r => r.created_at);
  const windowLeft = Math.max(0, FREE_WINDOW_UPLOADS - windowUses.length);
  // The oldest upload in the window is the next one to come back.
  const nextAt = windowUses.length > 0
    ? new Date(new Date(windowUses[0]).getTime() + FREE_WINDOW_HOURS * 3600 * 1000).toISOString()
    : null;
  const packLeft = purchased > 0 ? Math.max(0, FREE_LESSONS + purchased - used) : 0;
  return {
    used,
    purchased,
    isPaid,
    limit: FREE_WINDOW_UPLOADS + packLeft,
    remaining: windowLeft + packLeft,
    freeWindow: { limit: FREE_WINDOW_UPLOADS, used: windowUses.length, nextAt },
  };
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

/** Has this lesson been charged yet (from either pool)? */
export async function isLessonCharged(lessonId: string): Promise<boolean> {
  return await countLessonEvents(lessonId, 'tutor_lesson_used') > 0
    || await countLessonEvents(lessonId, FREE_WINDOW_EVENT) > 0;
}

/** Charges the lesson once — the first time any part of it is actually
 * delivered. Later parts and retries of the same lesson are free. A free
 * account uses one of its rolling uploads if it has one left, and only
 * then its purchased pack. */
export async function markLessonUsed(userId: string, lessonId: string, supabase: UserClient): Promise<void> {
  if (await isLessonCharged(lessonId)) return;
  const quota = await getTutorQuota(userId, supabase);
  const fromWindow = !!quota.freeWindow && quota.freeWindow.used < quota.freeWindow.limit;
  await recordLessonEvent(userId, lessonId, fromWindow ? FREE_WINDOW_EVENT : 'tutor_lesson_used');
}

import { timingSafeEqual } from 'crypto';
import webpush from 'web-push';
import { serviceClient } from '@/lib/apiAuth';

// Sends every queued notification as a phone notification (migration
// 046). The database calls this through pg_net as soon as a notification
// is created for a student with push switched on; the queue itself, who
// gets what and the once-only claim are all decided there
// (claim_push_batch). Classroom calls and @mentions go through
// /api/classrooms/push instead.
//
// Needs PUSH_DRAIN_SECRET (the same value as push_settings.secret), plus
// the VAPID keys the classroom push uses. Without them this sends nothing.

export const maxDuration = 30;

interface Item {
  notification_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  type: string;
  message: string;
  link: string | null;
  unread: number;
  /** The daily nudge's own headline (migration 050). */
  push_title?: string | null;
}

const TITLES: Record<string, string> = {
  admin_message: 'Message from PastCS',
  free_pass: 'Free pass unlocked',
  group_payment: 'Your class rep paid for you',
  referral_reward: 'Referral reward',
  streak_risk: 'Keep your streak',
  streak_lost: 'Streak ended',
  milestone: 'Milestone reached',
  inactivity: 'Time for a quick quiz',
  daily_nudge: 'PastCS',
  rep_payout: 'Level Rep payout',
  push_test: 'PastCS',
};

function secretMatches(given: string | null): boolean {
  const expected = process.env.PUSH_DRAIN_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where tapping it should land, matching the bell's own links. */
function pushUrl(type: string, link: string | null): string {
  if (type === 'admin_message') return '/messages';
  return link?.startsWith('/') && !link.startsWith('//') ? link : '/dashboard';
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-push-secret'))) {
    return Response.json({ error: 'Not allowed' }, { status: 401 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return Response.json({ sent: 0 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@pastcs.com', publicKey, privateKey);

  const db = serviceClient();
  let sent = 0;
  // Keep going while there's time, so a big batch (the daily nudge to
  // everyone at once) and anything arriving meanwhile all go out.
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const { data, error } = await db.rpc('claim_push_batch', { p_limit: 100 });
    if (error) {
      console.error('[push drain] claim failed', error.message);
      break;
    }
    const items = (data ?? []) as Item[];
    if (items.length === 0) break;

    await Promise.all(items.map(async (t) => {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify({
            title: t.push_title || TITLES[t.type] || 'PastCS',
            body: t.message,
            url: pushUrl(t.type, t.link),
            tag: t.notification_id,
            badgeCount: t.unread,
          }),
          // High urgency is what wakes a sleeping phone straight away.
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Gone: the student unsubscribed or cleared the site's data.
        if (status === 404 || status === 410) await db.rpc('drop_push_subscription', { p_endpoint: t.endpoint });
        else console.error('[push drain] send failed', status ?? err);
      }
    }));

    const ids = [...new Set(items.map(t => t.notification_id))];
    await db.rpc('finish_push_batch', { p_ids: ids });
  }

  return Response.json({ sent });
}

import webpush from 'web-push';
import { requireUser, serviceClient } from '@/lib/apiAuth';

// Sends the web push for a classroom call or @mention the signed-in
// student just posted. Who gets pinged is decided by the database
// (classroom_push_targets, migration 033): only the sender of a message
// under 10 minutes old can trigger it, each message is pushed once, and
// only classmates with alerts on for that classroom are included.
//
// Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT
// (a mailto: or https: contact). Without them this quietly sends nothing.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Target {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const { messageId } = await request.json().catch(() => ({}));
  if (typeof messageId !== 'string' || !UUID.test(messageId)) {
    return Response.json({ error: 'messageId is required' }, { status: 400 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return Response.json({ sent: 0 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@pastcs.com', publicKey, privateKey);

  const db = serviceClient();
  const { data, error } = await db.rpc('classroom_push_targets', { p_message: messageId, p_sender: auth.userId });
  if (error) {
    console.error('[classroom push] targets failed', error.message);
    return Response.json({ sent: 0 });
  }

  const targets = (data ?? []) as Target[];
  let sent = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify({
          title: t.title,
          body: t.body,
          url: t.link?.startsWith('/') ? t.link : '/classrooms',
          // One notification per classroom call: a second ping replaces it.
          tag: `${t.kind}-${messageId}`,
        }),
        { TTL: t.kind === 'classroom_call' ? 60 * 30 : 60 * 60 * 24, urgency: t.kind === 'classroom_call' ? 'high' : 'normal' }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Gone: the student unsubscribed or cleared the site's data.
      if (status === 404 || status === 410) await db.rpc('drop_push_subscription', { p_endpoint: t.endpoint });
      else console.error('[classroom push] send failed', status ?? err);
    }
  }));

  return Response.json({ sent });
}

import { requireUser, serviceClient } from '@/lib/apiAuth';

// "Send a test" on the profile page. It goes through the real path (a
// notification row, the database queue, pg_net, /api/push/drain), so a
// test that arrives proves the whole set-up works. Once a minute per
// student: the minute is the dedupe key.

export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const minute = new Date().toISOString().slice(0, 16);
  const { error } = await serviceClient().from('notifications').insert({
    user_id: auth.userId,
    type: 'push_test',
    message: 'Notifications are working. PastCS alerts will show here even when the app is closed.',
    link: '/profile',
    dedupe_key: `push_test:${minute}`,
  });

  if (error?.code === '23505') return Response.json({ error: 'You just sent one. Try again in a minute.' }, { status: 429 });
  if (error) {
    console.error('[push test] insert failed', error.message);
    return Response.json({ error: 'Couldn’t send a test. Try again.' }, { status: 500 });
  }
  return Response.json({ ok: true });
}

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_MESSAGE_LENGTH = 500;

// A real two-way thread with a single student, stored in admin_messages
// (see migration 025) rather than the one-way notifications table the
// first version of this feature used. The bell icon still gets a
// generic ping on a new admin message (see POST below) so the student
// notices, but the actual conversation — and their ability to reply —
// lives here.

// Fetch the full thread with one student, and mark their messages read
// now that an admin is looking at them.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  await supabaseAdmin
    .from('admin_messages')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('sender_id', userId)
    .eq('is_read', false);

  const { data, error } = await supabaseAdmin
    .from('admin_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ messages: data ?? [] });
}

// Reply in a student's thread.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { userId, message } = await req.json();

  if (!userId || typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'userId and message are required' }, { status: 400 });
  }
  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  if (!target) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('admin_messages')
    .insert({ user_id: userId, sender_id: auth.userId, body: message.trim() })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Generic ping only — the real content lives in admin_messages, not
  // duplicated into the notification itself.
  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: 'admin_message',
    message: 'You have a new message from the PastCS team.',
  });

  logAudit(supabaseAdmin, 'user.message', target.email, { userId, message: message.trim() }, auth.userId).catch(() => {});

  return Response.json({ message: inserted });
}

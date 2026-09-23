import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_MESSAGE_LENGTH = 500;

// Send a one-off message from an admin to a single student. Rides on the
// existing `notifications` table/bell-icon UI (lib/hooks/useNotifications.ts,
// StudentSidebar) rather than a new inbox — same storage, same read/dismiss
// behavior, just a distinct `type` so the sidebar can style it differently.
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

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: 'admin_message',
    message: message.trim(),
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  logAudit(supabaseAdmin, 'user.message', target.email, { userId, message: message.trim() }, auth.userId).catch(() => {});

  return Response.json({ success: true });
}

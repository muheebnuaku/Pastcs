import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Excludes visually ambiguous characters (0/O, 1/l/I) — this password
// gets relayed through a chat message and typed back in by hand.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length = 10): string {
  let pw = '';
  for (let i = 0; i < length; i++) {
    pw += TEMP_PASSWORD_CHARS[Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length)];
  }
  return pw;
}

// Sets a student's password directly (bypasses email entirely) and hands
// it to them via the admin_messages thread — the reliable path when a
// student can't get a reset email (spam-filtered, mistyped address, or
// simply locked out and reachable only in person/by phone with an admin
// who can read them the password over the thread).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { userId } = await req.json();
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  if (!target) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const tempPassword = generateTempPassword();

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from('admin_messages').insert({
    user_id: userId,
    sender_id: auth.userId,
    body: `Your password has been reset by the PastCS team.\n\nTemporary password: ${tempPassword}\n\nLog in with this, then change it right away from Profile → Change Password.`,
  });

  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    type: 'admin_message',
    message: 'You have a new message from the PastCS team.',
  });

  // Deliberately not logging the password itself.
  logAudit(supabaseAdmin, 'user.reset_password', target.email, { userId }, auth.userId).catch(() => {});

  return Response.json({ success: true });
}

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/admin/users/suspend — admin suspends or reactivates an
// account. A suspended account isn't deleted or altered otherwise; it's
// just treated as "not found" at login (see AuthProvider.signIn) so a
// student who was flagged for abuse (e.g. multiple fake accounts each
// claiming a different free course) can't tell whether they were caught
// or just mistyped their password.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { userId, suspended } = await req.json() as { userId?: string; suspended?: boolean };

  if (!userId || typeof suspended !== 'boolean') {
    return Response.json({ error: 'userId and suspended (boolean) are required' }, { status: 400 });
  }

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('email, role')
    .eq('id', userId)
    .single();

  if (!target) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  // A super admin (and admins generally, to be safe) can't be locked out
  // by another admin through this path — avoids an accidental or
  // malicious lockout of platform staff.
  if (target.role === 'admin' || target.role === 'super_admin') {
    return Response.json({ error: "Admin accounts can't be suspended from here" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_suspended: suspended })
    .eq('id', userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  logAudit(
    supabaseAdmin,
    suspended ? 'user.suspend' : 'user.unsuspend',
    target.email,
    { userId },
    auth.userId
  ).catch(() => {});

  return Response.json({ success: true });
}

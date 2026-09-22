import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  // Includes every account — students and admins alike — so admin access
  // can be reviewed and managed from the same place as student access.
  const { data: users, error } = await supabaseAdmin
    .from('user_public')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const userIds = (users ?? []).map((s: { id: string }) => s.id);

  const [{ data: subscriptions }, { data: recentTests }, { data: recentEvents }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').in('user_id', userIds).eq('status', 'active'),
    supabaseAdmin.from('tests').select('user_id, completed_at').in('user_id', userIds).order('completed_at', { ascending: false }),
    supabaseAdmin.from('feature_events').select('user_id, created_at').in('user_id', userIds).order('created_at', { ascending: false }),
  ]);

  // Last activity = most recent of "took a test" or "used a tracked feature".
  // Each result set is already sorted newest-first, so the first row seen
  // per user is their latest timestamp from that source.
  const lastActive: Record<string, string> = {};
  const considerActivity = (uid: string | null, ts: string | null) => {
    if (!uid || !ts) return;
    if (!lastActive[uid] || ts > lastActive[uid]) lastActive[uid] = ts;
  };
  for (const t of (recentTests ?? []) as { user_id: string; completed_at: string | null }[]) {
    considerActivity(t.user_id, t.completed_at);
  }
  for (const e of (recentEvents ?? []) as { user_id: string | null; created_at: string }[]) {
    considerActivity(e.user_id, e.created_at);
  }

  return Response.json({
    users: users ?? [],
    subscriptions: subscriptions ?? [],
    lastActive,
  });
}

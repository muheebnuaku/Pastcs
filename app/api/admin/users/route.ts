import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
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

  const { data: subscriptions } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .in('user_id', userIds)
    .eq('status', 'active');

  return Response.json({
    users: users ?? [],
    subscriptions: subscriptions ?? [],
  });
}

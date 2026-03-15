import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: students, error } = await supabaseAdmin
    .from('user_public')
    .select('*')
    .eq('role', 'student')
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const userIds = (students ?? []).map((s: { id: string }) => s.id);

  const { data: subscriptions } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .in('user_id', userIds)
    .eq('status', 'active');

  return Response.json({
    students: students ?? [],
    subscriptions: subscriptions ?? [],
  });
}

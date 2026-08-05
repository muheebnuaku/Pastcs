import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Change a user's role (student <-> admin)
export async function POST(req: Request) {
  const { userId, role } = await req.json();

  if (!userId || !role) {
    return Response.json({ error: 'userId and role required' }, { status: 400 });
  }

  if (role !== 'student' && role !== 'admin') {
    return Response.json({ error: "role must be 'student' or 'admin'" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

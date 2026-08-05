import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Permanently delete a user account (auth + profile + all related rows via cascade)
export async function DELETE(req: Request) {
  const { userId } = await req.json();

  if (!userId) {
    return Response.json({ error: 'userId required' }, { status: 400 });
  }

  // Deleting the auth user cascades to public.users and everything that
  // references it (subscriptions, tests, test_answers, etc — see schema.sql).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

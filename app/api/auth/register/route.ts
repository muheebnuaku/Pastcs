import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password || !fullName) {
      return Response.json({ error: 'email, password and fullName are required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create the auth user with email pre-confirmed.
    // The DB trigger (on_auth_user_created → handle_new_user) runs synchronously
    // inside the same transaction and auto-creates the public.users profile row
    // from user_metadata. No manual insert needed — that caused duplicate-key
    // errors and silent rollbacks of the auth user.
    const { error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      return Response.json({ error: authError.message }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

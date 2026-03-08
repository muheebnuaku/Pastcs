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
    // NOTE: The database has an AFTER INSERT trigger (on_auth_user_created →
    // handle_new_user) that automatically inserts the public.users profile row
    // using the user_metadata. Do NOT insert manually — that causes a duplicate
    // key error which would trigger the rollback and delete the auth user.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      return Response.json({ error: authError.message }, { status: 400 });
    }

    // Verify the trigger created the profile row (it runs synchronously inside
    // the same transaction, so it should be available immediately).
    const { data: profile, error: profileCheckError } = await supabase
      .from('users')
      .select('id')
      .eq('id', authData.user.id)
      .single();

    if (profileCheckError || !profile) {
      // Trigger didn't fire or failed — clean up and report the error
      await supabase.auth.admin.deleteUser(authData.user.id);
      return Response.json(
        { error: 'Profile creation failed. Please try again.' },
        { status: 500 }
      );
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

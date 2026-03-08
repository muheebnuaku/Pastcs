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

    // Create the auth user with email pre-confirmed (no email verification needed)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      return Response.json({ error: authError.message }, { status: 400 });
    }

    // Insert the user profile row
    const { error: profileError } = await supabase.from('users').insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role: 'student',
    });

    if (profileError) {
      // Roll back the auth user if profile creation fails
      await supabase.auth.admin.deleteUser(authData.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

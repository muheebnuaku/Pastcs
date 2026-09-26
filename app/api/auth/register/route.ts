import { createClient } from '@supabase/supabase-js';

// Best-effort client IP for the shared-IP abuse signal (see admin Users
// page) — never blocks signup if it can't be determined. Checks the
// standard proxy headers a platform like Vercel sets; x-forwarded-for
// can carry a comma-separated chain when there are multiple proxies, so
// the first entry is the original client.
function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

export async function POST(request: Request) {
  try {
    const { email, password, fullName, referralCode, programId, customProgram } = await request.json();

    if (!email || !password || !fullName) {
      return Response.json({ error: 'email, password and fullName are required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create the auth user UNCONFIRMED — anyone could previously sign up
    // with an email they don't own (or a made-up one) and get a fully
    // working account instantly, which is also what let one person farm
    // several free-course slots behind different fake addresses. The DB
    // trigger (on_auth_user_created → handle_new_user) runs synchronously
    // inside the same transaction and auto-creates the public.users profile
    // row from user_metadata regardless of confirmation status — no manual
    // insert needed here, and no change to that part of the flow.
    const { error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: fullName,
        // referral_code here is the CODE THEY WERE INVITED WITH (their
        // referrer's code) — handle_new_user() resolves it to the
        // referrer's user id. An invalid/typo'd code is silently
        // ignored, not blocking.
        referral_code: referralCode || null,
        // A real program picked from the list sets program_id (the FK
        // the rest of the app scopes course access by). A custom-typed
        // "my program isn't listed" entry has no matching row yet, so it
        // only fills the free-text `program` column — that student won't
        // see any courses until an admin creates the real program and
        // sets their program_id, same as any pre-registration-redesign
        // account with a program name but no program_id.
        program_id: programId || null,
        program: !programId && customProgram ? customProgram : null,
        registration_ip: getClientIp(request),
      },
    });

    if (authError) {
      return Response.json({ error: authError.message }, { status: 400 });
    }

    // The admin API's createUser deliberately skips every automatic email
    // flow (that's the whole point of an admin-provisioned account), so
    // the actual "confirm your email" send has to be requested explicitly
    // through the public auth API — a separate anon-key client, since
    // resend() isn't an admin action and the service-role client above
    // has session persistence disabled.
    const origin = request.headers.get('origin') || 'https://www.pastcs.com';
    const supabasePublic = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error: resendError } = await supabasePublic.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${origin}/dashboard` },
    });

    return Response.json({ success: true, emailSent: !resendError });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

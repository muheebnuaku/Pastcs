import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      return Response.redirect(`${origin}${next}`);
    }
  }

  // Return the user to an error page with instructions
  return Response.redirect(`${origin}/login?error=auth`);
}

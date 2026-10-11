import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Verifies the request comes from a logged-in user. The AI routes used to
 * skip this entirely, so anyone who found the URL could run OpenAI calls
 * on the platform's key without an account. Same calling convention as
 * requireAdmin:
 *   const auth = await requireUser();
 *   if (auth instanceof Response) return auth;
 */
export async function requireUser(): Promise<
  { userId: string; supabase: Awaited<ReturnType<typeof createClient>> } | Response
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Please log in again to use the AI tutor.' }, { status: 401 });
  return { userId: user.id, supabase };
}

export function serviceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * How many logged AI calls of the given features a user has made since
 * midnight UTC. Fails open (returns 0) if ai_usage_log isn't available,
 * so a logging problem never locks students out.
 */
export async function aiCallsToday(userId: string, features: string[]): Promise<number> {
  try {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count, error } = await serviceClient()
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('feature', features)
      .gte('created_at', start.toISOString());
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
